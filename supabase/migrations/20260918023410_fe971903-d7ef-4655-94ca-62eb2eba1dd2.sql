
create or replace function public.registrar_movimentacao(
  p_produto_id uuid,
  p_deposito_id uuid,
  p_tipo public.mov_tipo,
  p_quantidade numeric,
  p_motivo text default null,
  p_documento text default null,
  p_deposito_destino_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_unidade text;
  v_permite_negativo boolean;
  v_qtd numeric; v_res numeric;
  v_disp numeric;
  v_novo numeric;
  v_mov_id uuid;
  v_qtd_dest numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe uma quantidade maior que zero'; end if;

  select p.unidade into v_unidade from public.produtos p
   where p.id = p_produto_id and p.tenant_id = v_tenant;
  if v_unidade is null then raise exception 'Produto não encontrado nesta empresa'; end if;

  select d.permite_negativo into v_permite_negativo from public.depositos d
   where d.id = p_deposito_id and d.tenant_id = v_tenant;
  if v_permite_negativo is null then raise exception 'Depósito não encontrado nesta empresa'; end if;

  insert into public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
  values (v_tenant, p_produto_id, p_deposito_id, 0, 0)
  on conflict (produto_id, deposito_id) do nothing;

  select quantidade, reservado into v_qtd, v_res from public.estoques
   where produto_id = p_produto_id and deposito_id = p_deposito_id for update;
  v_disp := v_qtd - v_res;

  if p_tipo in ('entrada','transferencia_entrada') then
    v_novo := v_qtd + p_quantidade;
    update public.estoques set quantidade = v_novo, updated_at = now()
     where produto_id = p_produto_id and deposito_id = p_deposito_id;

  elsif p_tipo in ('saida','transferencia_saida') then
    if p_quantidade > v_disp and not v_permite_negativo then
      raise exception 'Estoque disponível insuficiente (disponível: %)', v_disp;
    end if;
    v_novo := v_qtd - p_quantidade;
    update public.estoques set quantidade = v_novo, updated_at = now()
     where produto_id = p_produto_id and deposito_id = p_deposito_id;

  elsif p_tipo in ('ajuste','inventario') then
    v_novo := p_quantidade;
    if v_novo < v_res and not v_permite_negativo then
      raise exception 'Quantidade menor que o total reservado (%).', v_res;
    end if;
    update public.estoques set quantidade = v_novo, updated_at = now()
     where produto_id = p_produto_id and deposito_id = p_deposito_id;

  elsif p_tipo = 'reserva' then
    if p_quantidade > v_disp and not v_permite_negativo then
      raise exception 'Estoque disponível insuficiente para reserva (disponível: %)', v_disp;
    end if;
    v_novo := v_qtd;
    update public.estoques set reservado = v_res + p_quantidade, updated_at = now()
     where produto_id = p_produto_id and deposito_id = p_deposito_id;

  elsif p_tipo = 'liberacao_reserva' then
    v_novo := v_qtd;
    update public.estoques set reservado = greatest(0, v_res - p_quantidade), updated_at = now()
     where produto_id = p_produto_id and deposito_id = p_deposito_id;
  end if;

  insert into public.estoque_movimentacoes
    (tenant_id, produto_id, deposito_id, deposito_destino_id, tipo, quantidade,
     saldo_anterior, saldo_posterior, unidade, documento, motivo, usuario_id)
  values (v_tenant, p_produto_id, p_deposito_id, p_deposito_destino_id, p_tipo, p_quantidade,
     v_qtd, v_novo, v_unidade, p_documento, p_motivo, auth.uid())
  returning id into v_mov_id;

  -- transferência: entrada automática no depósito destino
  if p_tipo = 'transferencia_saida' then
    if p_deposito_destino_id is null then raise exception 'Informe o depósito de destino'; end if;
    if not exists (select 1 from public.depositos where id = p_deposito_destino_id and tenant_id = v_tenant) then
      raise exception 'Depósito de destino não encontrado nesta empresa';
    end if;

    insert into public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    values (v_tenant, p_produto_id, p_deposito_destino_id, 0, 0)
    on conflict (produto_id, deposito_id) do nothing;

    select quantidade into v_qtd_dest from public.estoques
     where produto_id = p_produto_id and deposito_id = p_deposito_destino_id for update;

    update public.estoques set quantidade = v_qtd_dest + p_quantidade, updated_at = now()
     where produto_id = p_produto_id and deposito_id = p_deposito_destino_id;

    insert into public.estoque_movimentacoes
      (tenant_id, produto_id, deposito_id, deposito_destino_id, tipo, quantidade,
       saldo_anterior, saldo_posterior, unidade, documento, motivo, usuario_id)
    values (v_tenant, p_produto_id, p_deposito_destino_id, p_deposito_id, 'transferencia_entrada', p_quantidade,
       v_qtd_dest, v_qtd_dest + p_quantidade, v_unidade, p_documento,
       coalesce(p_motivo,'Transferência entre depósitos'), auth.uid());
  end if;

  return v_mov_id;
end $$;

revoke all on function public.registrar_movimentacao(uuid,uuid,public.mov_tipo,numeric,text,text,uuid) from anon, public;
grant execute on function public.registrar_movimentacao(uuid,uuid,public.mov_tipo,numeric,text,text,uuid) to authenticated;
