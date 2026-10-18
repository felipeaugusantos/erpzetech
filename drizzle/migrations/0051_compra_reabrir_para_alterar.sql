create or replace function public.compra_avancar_status(p_compra_id uuid, p_situacao public.compra_situacao, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras;
  v_permitido public.compra_situacao[];
  v_itens int;
  v_receb int;
begin
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant;
  if c.id is null then raise exception 'Compra não encontrada nesta empresa'; end if;
  if c.situacao = p_situacao then return; end if;
  if c.situacao in ('recebido','cancelado') then raise exception 'Compra já finalizada'; end if;

  v_permitido := case c.situacao
    when 'rascunho' then array['cotacao','aprovado','cancelado']::public.compra_situacao[]
    when 'cotacao' then array['aprovado','rascunho','cancelado']::public.compra_situacao[]
    when 'aprovado' then array['pedido_enviado','rascunho','cancelado']::public.compra_situacao[]
    when 'pedido_enviado' then array['rascunho','cancelado']::public.compra_situacao[]
    when 'parcialmente_recebido' then array['cancelado']::public.compra_situacao[]
    else array[]::public.compra_situacao[] end;

  if not (p_situacao = any(v_permitido)) then raise exception 'Mudança de situação não permitida'; end if;

  if p_situacao in ('aprovado','pedido_enviado') then
    select count(*) into v_itens from public.compra_itens where compra_id = c.id;
    if v_itens = 0 then raise exception 'Inclua itens antes de aprovar a compra'; end if;
    if c.fornecedor_id is null then raise exception 'Selecione o fornecedor antes de aprovar a compra'; end if;
  end if;

  if p_situacao = 'cancelado' then
    update public.compras set situacao = p_situacao, motivo_cancelamento = p_observacao where id = c.id;
  elsif p_situacao = 'aprovado' then
    update public.compras set situacao = p_situacao, aprovado_por = auth.uid(), aprovado_em = now() where id = c.id;
  elsif p_situacao = 'rascunho' and c.situacao in ('aprovado','pedido_enviado') then
    -- reabrir para alterar: só sem nada recebido, com motivo, e exige nova aprovação
    select count(*) into v_receb from public.compra_recebimentos where compra_id = c.id;
    if v_receb > 0 then raise exception 'Compra com recebimento não pode ser alterada'; end if;
    if coalesce(trim(p_observacao), '') = '' then raise exception 'Informe o motivo da alteração'; end if;
    update public.compras set situacao = 'rascunho', aprovado_por = null, aprovado_em = null,
      observacoes = concat_ws(E'\n', nullif(observacoes, ''),
        '[' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '] Reaberta para alteração: ' || trim(p_observacao))
    where id = c.id;
  else
    update public.compras set situacao = p_situacao where id = c.id;
  end if;
end; $$;
revoke all on function public.compra_avancar_status(uuid, public.compra_situacao, text) from anon, public;
grant execute on function public.compra_avancar_status(uuid, public.compra_situacao, text) to authenticated;