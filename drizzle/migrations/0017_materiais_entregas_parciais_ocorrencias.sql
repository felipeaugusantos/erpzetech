ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'entrega',
  ADD COLUMN IF NOT EXISTS chave_idempotencia text,
  ADD COLUMN IF NOT EXISTS endereco_entrega text,
  ADD COLUMN IF NOT EXISTS responsavel text,
  ADD COLUMN IF NOT EXISTS reagendamentos integer NOT NULL DEFAULT 0;
ALTER TABLE public.entregas ADD CONSTRAINT entregas_tipo_check CHECK (tipo IN ('entrega','retirada'));
CREATE UNIQUE INDEX IF NOT EXISTS entregas_chave_idem_uk ON public.entregas (tenant_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

CREATE TABLE public.pedido_ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  pedido_item_id uuid NOT NULL REFERENCES public.pedido_itens(id) ON DELETE CASCADE,
  etapa text NOT NULL DEFAULT 'separacao' CHECK (etapa IN ('separacao','conferencia','entrega')),
  tipo text NOT NULL CHECK (tipo IN ('falta','sobra','avaria','substituicao')),
  quantidade numeric NOT NULL CHECK (quantidade > 0),
  produto_substituto_id uuid REFERENCES public.produtos(id),
  observacao text,
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pedido_ocorrencias TO authenticated;
GRANT ALL ON public.pedido_ocorrencias TO service_role;
ALTER TABLE public.pedido_ocorrencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY pedido_ocorrencias_read ON public.pedido_ocorrencias FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND NOT public.eh_salao_restrito());
CREATE INDEX pedido_ocorrencias_pedido_idx ON public.pedido_ocorrencias (pedido_id);

CREATE TABLE public.entrega_reagendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  entrega_id uuid NOT NULL REFERENCES public.entregas(id) ON DELETE CASCADE,
  data_anterior date,
  data_nova date,
  motivo text NOT NULL,
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.entrega_reagendamentos TO authenticated;
GRANT ALL ON public.entrega_reagendamentos TO service_role;
ALTER TABLE public.entrega_reagendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY entrega_reagendamentos_read ON public.entrega_reagendamentos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND NOT public.eh_salao_restrito());

-- Retirada no balcão ou entrega concluída, com trava e chave para reenvio offline não duplicar.
CREATE OR REPLACE FUNCTION public.pedido_registrar_saida(
  p_pedido_id uuid, p_itens jsonb, p_tipo text DEFAULT 'entrega',
  p_recebedor text DEFAULT NULL, p_observacao text DEFAULT NULL, p_chave text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  v_id uuid;
  r record;
  v_item public.pedido_itens;
  v_planejado numeric;
  v_pendentes numeric;
begin
  PERFORM public.exige_nao_salao();
  if p_tipo not in ('entrega','retirada') then raise exception 'Tipo de saída inválido'; end if;
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant for update;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;

  if p_chave is not null then
    select id into v_id from public.entregas where tenant_id = v_tenant and chave_idempotencia = p_chave;
    if v_id is not null then return v_id; end if;
  end if;

  if p.situacao not in ('pronto_entrega','em_rota') then
    raise exception 'O pedido precisa estar pronto para entrega/retirada ou em rota';
  end if;

  insert into public.entregas (tenant_id, pedido_id, situacao, tipo, recebedor, observacao, usuario_id, chave_idempotencia, data_entrega)
  values (v_tenant, p.id, 'entregue', p_tipo, p_recebedor, p_observacao, auth.uid(), p_chave, now())
  returning id into v_id;

  for r in select (x->>'pedido_item_id')::uuid item_id, (x->>'quantidade')::numeric q
           from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) x loop
    if r.q is null or r.q <= 0 then continue; end if;
    select * into v_item from public.pedido_itens where id = r.item_id and pedido_id = p.id for update;
    if v_item.id is null then raise exception 'Item do pedido não encontrado'; end if;
    select coalesce(sum(ei.quantidade),0) into v_planejado
      from public.entrega_itens ei join public.entregas e on e.id = ei.entrega_id
      where ei.pedido_item_id = v_item.id and e.situacao in ('planejada','em_rota');
    if v_item.quantidade_entregue + v_planejado + r.q > v_item.quantidade then
      raise exception 'Quantidade acima do saldo pendente do item (pendente: %)',
        greatest(v_item.quantidade - v_item.quantidade_entregue - v_planejado, 0);
    end if;
    perform public.registrar_movimentacao(v_item.produto_id, p.deposito_id, 'liberacao_reserva'::mov_tipo, r.q,
      case when p_tipo = 'retirada' then 'Baixa de reserva na retirada' else 'Baixa de reserva na entrega' end, 'PED-' || p.numero, null);
    perform public.registrar_movimentacao(v_item.produto_id, p.deposito_id, 'saida'::mov_tipo, r.q,
      case when p_tipo = 'retirada' then 'Retirada do pedido' else 'Entrega do pedido' end, 'PED-' || p.numero, null);
    update public.pedido_itens set quantidade_entregue = quantidade_entregue + r.q where id = v_item.id;
    insert into public.entrega_itens (tenant_id, entrega_id, pedido_item_id, produto_id, quantidade)
    values (v_tenant, v_id, v_item.id, v_item.produto_id, r.q);
  end loop;

  if not exists (select 1 from public.entrega_itens where entrega_id = v_id) then
    raise exception 'Informe ao menos um produto';
  end if;

  select coalesce(sum(quantidade - quantidade_entregue),0) into v_pendentes from public.pedido_itens where pedido_id = p.id;
  if v_pendentes <= 0 then
    update public.pedidos set situacao = 'entregue', estoque_reservado = false where id = p.id;
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, 'entregue', coalesce(p_observacao, 'Pedido atendido por completo'), auth.uid());
  elsif p.situacao <> 'em_rota' then
    update public.pedidos set situacao = 'em_rota' where id = p.id;
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, 'em_rota',
      case when p_tipo = 'retirada' then 'Retirada parcial registrada' else 'Entrega parcial registrada' end, auth.uid());
  end if;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.pedido_registrar_entrega(p_pedido_id uuid, p_itens jsonb, p_recebedor text DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  select public.pedido_registrar_saida(p_pedido_id, p_itens, 'entrega', p_recebedor, p_observacao, null)
$$;

CREATE OR REPLACE FUNCTION public.pedido_registrar_ocorrencia(
  p_pedido_item_id uuid, p_tipo text, p_quantidade numeric, p_etapa text DEFAULT 'separacao',
  p_produto_substituto_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_item public.pedido_itens;
  v_id uuid;
begin
  PERFORM public.exige_nao_salao();
  select * into v_item from public.pedido_itens where id = p_pedido_item_id and tenant_id = v_tenant;
  if v_item.id is null then raise exception 'Item do pedido não encontrado nesta empresa'; end if;
  if p_tipo = 'substituicao' and p_produto_substituto_id is null then
    raise exception 'Informe o produto que substitui o item';
  end if;
  if p_produto_substituto_id is not null and not exists (
    select 1 from public.produtos where id = p_produto_substituto_id and tenant_id = v_tenant) then
    raise exception 'Produto substituto não encontrado nesta empresa';
  end if;
  if p_tipo in ('falta','avaria') and coalesce(length(trim(p_observacao)),0) = 0 then
    raise exception 'Descreva a ocorrência';
  end if;
  insert into public.pedido_ocorrencias (tenant_id, pedido_id, pedido_item_id, etapa, tipo, quantidade, produto_substituto_id, observacao, usuario_id)
  values (v_tenant, v_item.pedido_id, v_item.id, coalesce(p_etapa,'separacao'), p_tipo, p_quantidade, p_produto_substituto_id, nullif(trim(p_observacao),''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.entrega_agendar(
  p_entrega_id uuid, p_previsao date, p_endereco text DEFAULT NULL, p_responsavel text DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  e public.entregas;
begin
  PERFORM public.exige_nao_salao();
  select * into e from public.entregas where id = p_entrega_id and tenant_id = v_tenant for update;
  if e.id is null then raise exception 'Entrega não encontrada nesta empresa'; end if;
  if e.situacao not in ('planejada','em_rota','insucesso') then
    raise exception 'Só entregas em aberto podem ser agendadas';
  end if;
  if e.previsao_data is not null and p_previsao is distinct from e.previsao_data then
    if coalesce(length(trim(p_motivo)),0) = 0 then raise exception 'Informe o motivo do reagendamento'; end if;
    insert into public.entrega_reagendamentos (tenant_id, entrega_id, data_anterior, data_nova, motivo, usuario_id)
    values (v_tenant, e.id, e.previsao_data, p_previsao, trim(p_motivo), auth.uid());
    update public.entregas set reagendamentos = reagendamentos + 1 where id = e.id;
  end if;
  update public.entregas set previsao_data = p_previsao,
    endereco_entrega = coalesce(nullif(trim(p_endereco),''), endereco_entrega),
    responsavel = coalesce(nullif(trim(p_responsavel),''), responsavel),
    situacao = case when situacao = 'insucesso' then 'planejada' else situacao end
  where id = e.id;
end $$;

REVOKE EXECUTE ON FUNCTION public.pedido_registrar_saida(uuid, jsonb, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pedido_registrar_ocorrencia(uuid, text, numeric, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.entrega_agendar(uuid, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_registrar_saida(uuid, jsonb, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_registrar_ocorrencia(uuid, text, numeric, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.entrega_agendar(uuid, date, text, text, text) TO authenticated;