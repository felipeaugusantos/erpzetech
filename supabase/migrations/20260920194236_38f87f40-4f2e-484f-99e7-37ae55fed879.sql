-- ===== Itens de locação (vários equipamentos no mesmo contrato) =====
create table if not exists public.locacao_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  locacao_id uuid not null references public.locacoes(id) on delete cascade,
  equipamento_id uuid not null references public.locacao_equipamentos(id),
  quantidade numeric(14,3) not null default 1,
  dias integer not null default 1,
  valor_diaria numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists locacao_itens_loc_idx on public.locacao_itens (locacao_id);

grant select, insert, update, delete on public.locacao_itens to authenticated;
grant all on public.locacao_itens to service_role;
alter table public.locacao_itens enable row level security;

drop policy if exists "Itens de locacao do tenant" on public.locacao_itens;
create policy "Itens de locacao do tenant" on public.locacao_itens
  for select to authenticated using (tenant_id = current_tenant_id());
drop policy if exists "Registrar itens de locacao" on public.locacao_itens;
create policy "Registrar itens de locacao" on public.locacao_itens
  for insert to authenticated with check (tenant_id = current_tenant_id());
drop policy if exists "Alterar itens de locacao" on public.locacao_itens;
create policy "Alterar itens de locacao" on public.locacao_itens
  for update to authenticated using (tenant_id = current_tenant_id());
drop policy if exists "Remover itens de locacao" on public.locacao_itens;
create policy "Remover itens de locacao" on public.locacao_itens
  for delete to authenticated using (tenant_id = current_tenant_id());

-- ===== Campos de nota fiscal de serviço =====
alter table public.nfe
  add column if not exists modelo text not null default 'nfe',
  add column if not exists codigo_servico text,
  add column if not exists iss_retido boolean not null default false,
  add column if not exists municipio_prestacao text;

alter table public.fiscal_config
  add column if not exists codigo_servico text default '0703',
  add column if not exists item_lista_servico text default '3.05',
  add column if not exists serie_nfse integer default 1,
  add column if not exists proximo_numero_nfse integer default 1;

-- ===== NOTA FISCAL DE SERVIÇO DA LOCAÇÃO =====
create or replace function public.locacao_gerar_nfse(p_locacao_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_loc record; v_cli record; v_emp record; v_fil record; v_cfg record;
  v_nfe_id uuid; v_numero integer; v_pend text[] := array[]::text[];
  v_doc text; v_dias integer; v_iss numeric; v_itens integer;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada não emite nota'; end if;
  if exists (select 1 from public.nfe where locacao_id = p_locacao_id and situacao <> 'cancelada') then
    raise exception 'Esta locação já tem nota gerada';
  end if;
  if coalesce(v_loc.valor_total, 0) <= 0 then raise exception 'Locação sem valor para emitir nota'; end if;

  select * into v_cli from public.clientes where id = v_loc.cliente_id;
  select * into v_emp from public.empresas where id = coalesce(v_loc.empresa_id, v_cli.empresa_id);
  select * into v_fil from public.filiais where id = v_loc.filial_id;

  select * into v_cfg from public.fiscal_config
   where tenant_id = current_tenant_id() and (filial_id = v_loc.filial_id or filial_id is null)
     and (empresa_id = v_emp.id or empresa_id is null)
   order by filial_id nulls last, empresa_id nulls last limit 1;
  if v_cfg is null then
    insert into public.fiscal_config (tenant_id, empresa_id) values (current_tenant_id(), v_emp.id)
    returning * into v_cfg;
  end if;

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  if v_doc is null or length(regexp_replace(v_doc, '\D', '', 'g')) not in (11, 14) then
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  end if;
  if coalesce(v_cli.endereco,'') = '' or coalesce(v_cli.cidade,'') = '' then
    v_pend := array_append(v_pend, 'Endereço do cliente incompleto');
  end if;
  if v_emp is null or coalesce(v_emp.cnpj,'') = '' then
    v_pend := array_append(v_pend, 'CNPJ da empresa ausente');
  end if;
  if coalesce(v_emp.inscricao_municipal,'') = '' then
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  end if;
  if coalesce(v_cfg.codigo_servico,'') = '' then
    v_pend := array_append(v_pend, 'Código do serviço municipal não configurado');
  end if;
  if coalesce(v_cfg.aliquota_iss, 0) <= 0 then
    v_pend := array_append(v_pend, 'Alíquota de ISS não configurada');
  end if;
  if coalesce(v_cfg.certificado_nome,'') = '' then
    v_pend := array_append(v_pend, 'Certificado digital A1 não configurado');
  end if;

  if array_length(v_pend, 1) is null then
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    update public.fiscal_config
       set proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 where id = v_cfg.id;
  end if;

  v_dias := greatest(coalesce(v_loc.dias_reais, v_loc.dias, 1), 1);
  v_iss := coalesce(v_cfg.aliquota_iss, 0);

  insert into public.nfe (
    tenant_id, empresa_id, filial_id, cliente_id, locacao_id, numero, serie, situacao, ambiente,
    modelo, codigo_servico, municipio_prestacao,
    natureza_operacao, cfop, valor_produtos, valor_total, valor_iss,
    emitente, destinatario, pendencias, mensagem
  ) values (
    current_tenant_id(), v_emp.id, v_loc.filial_id, v_loc.cliente_id, p_locacao_id,
    v_numero, coalesce(v_cfg.serie_nfse, 1),
    case when array_length(v_pend,1) is null then 'pronta' else 'rascunho' end,
    v_cfg.ambiente, 'nfse', v_cfg.codigo_servico, coalesce(v_emp.cidade, ''),
    'Prestação de serviço — locação de bens móveis', null,
    v_loc.valor_total, v_loc.valor_total, round(v_loc.valor_total * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'inscricao_municipal', v_emp.inscricao_municipal, 'inscricao_estadual', v_emp.inscricao_estadual,
      'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero,
      'bairro', v_cli.bairro, 'cidade', v_cli.cidade, 'estado', v_cli.estado, 'cep', v_cli.cep,
      'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    case when array_length(v_pend,1) is null
      then 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      else 'NFS-e em rascunho: resolva as pendências listadas.' end
  ) returning id into v_nfe_id;

  insert into public.nfe_itens (
    tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total,
    aliquota_iss, valor_iss, cst_csosn
  )
  select current_tenant_id(), v_nfe_id,
         'Locação de ' || e.nome || ' — ' || li.dias || ' dia(s)',
         'DIA', li.dias * li.quantidade,
         case when li.dias > 0 then round(li.total / (li.dias * greatest(li.quantidade,1)), 2) else li.total end,
         li.total, v_iss, round(li.total * v_iss / 100, 2), '400'
    from public.locacao_itens li
    join public.locacao_equipamentos e on e.id = li.equipamento_id
   where li.locacao_id = p_locacao_id;

  select count(*) into v_itens from public.nfe_itens where nfe_id = v_nfe_id;
  if v_itens = 0 then
    insert into public.nfe_itens (
      tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total,
      aliquota_iss, valor_iss, cst_csosn
    ) values (
      current_tenant_id(), v_nfe_id,
      'Locação de ' || coalesce((select nome from public.locacao_equipamentos where id = v_loc.equipamento_id), 'equipamento')
        || ' — ' || v_dias || ' dia(s)',
      'DIA', v_dias,
      round(v_loc.valor_total / v_dias, 2), v_loc.valor_total,
      v_iss, round(v_loc.valor_total * v_iss / 100, 2), '400'
    );
  end if;

  update public.locacoes set nfe_id = v_nfe_id where id = p_locacao_id;
  return v_nfe_id;
end; $$;
revoke all on function public.locacao_gerar_nfse(uuid) from public, anon;
grant execute on function public.locacao_gerar_nfse(uuid) to authenticated;

-- ===== BALCÃO DE LOCAÇÃO =====
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
    'reservada', true, now(), p_observacoes
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
         situacao = case when p_entregar then 'em_andamento' else 'reservada' end,
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