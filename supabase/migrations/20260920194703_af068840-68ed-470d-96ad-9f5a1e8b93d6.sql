create or replace function public.locacao_balcao_registrar(
  p_cliente_id uuid,
  p_itens jsonb,
  p_inicio date default current_date,
  p_dias integer default 1,
  p_obra_id uuid default null,
  p_caucao numeric default 0,
  p_observacoes text default null,
  p_forma public.forma_pagamento default 'dinheiro',
  p_parcelas integer default 1,
  p_vencimento date default null,
  p_caixa_id uuid default null,
  p_entregar boolean default true,
  p_gerar_nfse boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_perfil record; v_loc_id uuid; v_dias integer := greatest(coalesce(p_dias, 1), 1);
  v_item jsonb; v_eq record; v_qtd numeric; v_diaria numeric; v_total numeric := 0;
  v_nfse uuid; v_num integer; v_conta uuid;
begin
  if p_cliente_id is null then raise exception 'Escolha o cliente'; end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha pelo menos um equipamento'; end if;

  select tenant_id, empresa_id, filial_id into v_perfil from public.profiles where id = auth.uid();
  if v_perfil.tenant_id is null then raise exception 'Usuário sem empresa vinculada'; end if;

  insert into public.locacoes (
    tenant_id, empresa_id, filial_id, cliente_id, obra_id, equipamento_id,
    inicio, previsao_devolucao, valor_diaria, dias, valor_total, caucao,
    situacao, aprovada, aprovado_em, observacoes
  ) values (
    v_perfil.tenant_id, v_perfil.empresa_id, v_perfil.filial_id, p_cliente_id, p_obra_id,
    ((p_itens -> 0) ->> 'equipamento_id')::uuid,
    p_inicio, p_inicio + v_dias, 0, v_dias, 0, coalesce(p_caucao, 0),
    'reservada'::public.locacao_situacao, true, now(), p_observacoes
  ) returning id, numero into v_loc_id, v_num;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_eq from public.locacao_equipamentos
     where id = (v_item ->> 'equipamento_id')::uuid and tenant_id = v_perfil.tenant_id;
    if v_eq is null then raise exception 'Equipamento não encontrado'; end if;
    v_qtd := greatest(coalesce((v_item ->> 'quantidade')::numeric, 1), 1);
    v_diaria := coalesce((v_item ->> 'valor_diaria')::numeric, v_eq.valor_diaria, 0);

    insert into public.locacao_itens (
      tenant_id, locacao_id, equipamento_id, quantidade, dias, valor_diaria, total
    ) values (
      v_perfil.tenant_id, v_loc_id, v_eq.id, v_qtd, v_dias, v_diaria,
      round(v_diaria * v_qtd * v_dias, 2)
    );
    v_total := v_total + round(v_diaria * v_qtd * v_dias, 2);
  end loop;

  update public.locacoes
     set valor_total = v_total,
         valor_diaria = case when v_dias > 0 then round(v_total / v_dias, 2) else v_total end,
         situacao = (case when p_entregar then 'em_andamento' else 'reservada' end)::public.locacao_situacao,
         entregue_em = case when p_entregar then p_inicio else null end
   where id = v_loc_id;

  update public.locacao_equipamentos set situacao = 'locado'
   where id in (select equipamento_id from public.locacao_itens where locacao_id = v_loc_id)
     and situacao = 'disponivel';

  if v_total > 0 then
    v_conta := public.locacao_faturar(v_loc_id, p_forma, greatest(coalesce(p_parcelas,1),1),
                                      coalesce(p_vencimento, current_date), p_caixa_id);
  end if;

  if p_gerar_nfse then
    begin
      v_nfse := public.locacao_gerar_nfse(v_loc_id);
    exception when others then
      v_nfse := null;
    end;
  end if;

  return jsonb_build_object(
    'locacao_id', v_loc_id, 'numero', v_num, 'total', v_total,
    'conta_receber_id', v_conta, 'nfse_id', v_nfse
  );
end; $$;
revoke all on function public.locacao_balcao_registrar(uuid, jsonb, date, integer, uuid, numeric, text, public.forma_pagamento, integer, date, uuid, boolean, boolean) from public, anon;
grant execute on function public.locacao_balcao_registrar(uuid, jsonb, date, integer, uuid, numeric, text, public.forma_pagamento, integer, date, uuid, boolean, boolean) to authenticated;