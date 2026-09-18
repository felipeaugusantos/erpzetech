CREATE TABLE public.transferencias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  numero bigint,
  empresa_origem_id uuid references public.empresas(id),
  filial_origem_id uuid references public.filiais(id),
  deposito_origem_id uuid not null references public.depositos(id),
  empresa_destino_id uuid references public.empresas(id),
  filial_destino_id uuid references public.filiais(id),
  deposito_destino_id uuid not null references public.depositos(id),
  situacao text not null default 'rascunho',
  observacao text,
  valor_total numeric(14,2) not null default 0,
  enviado_em timestamptz,
  recebido_em timestamptz,
  enviado_por uuid,
  recebido_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE public.transferencia_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  transferencia_id uuid not null references public.transferencias(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null,
  quantidade_recebida numeric(14,3),
  custo_unitario numeric(14,4) not null default 0,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE ON public.transferencias TO authenticated;
GRANT ALL ON public.transferencias TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.transferencia_itens TO authenticated;
GRANT ALL ON public.transferencia_itens TO service_role;

ALTER TABLE public.transferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transferencias_select" ON public.transferencias FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "transferencias_insert" ON public.transferencias FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
         or public.has_role(auth.uid(),'estoquista')));
CREATE POLICY "transferencias_update" ON public.transferencias FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
         or public.has_role(auth.uid(),'estoquista')));

CREATE POLICY "transferencia_itens_select" ON public.transferencia_itens FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "transferencia_itens_insert" ON public.transferencia_itens FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
         or public.has_role(auth.uid(),'estoquista')));
CREATE POLICY "transferencia_itens_update" ON public.transferencia_itens FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
         or public.has_role(auth.uid(),'estoquista')));

CREATE TRIGGER trg_transferencias_numero BEFORE INSERT ON public.transferencias
  FOR EACH ROW EXECUTE FUNCTION public.set_numero_sequencial();
CREATE TRIGGER trg_transferencias_touch BEFORE UPDATE ON public.transferencias
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_transferencia_itens_touch BEFORE UPDATE ON public.transferencia_itens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_transferencias_tenant ON public.transferencias(tenant_id, situacao);
CREATE INDEX idx_transferencia_itens_transf ON public.transferencia_itens(transferencia_id);

-- Criar transferência (rascunho) com vários produtos
CREATE OR REPLACE FUNCTION public.transferencia_criar(
  p_deposito_origem_id uuid,
  p_deposito_destino_id uuid,
  p_itens jsonb,
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_of record; v_df record;
  it jsonb;
  v_custo numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'estoquista')) then
    raise exception 'Sem permissão para transferir mercadoria';
  end if;
  if p_deposito_origem_id = p_deposito_destino_id then
    raise exception 'Escolha depósitos diferentes para origem e destino';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe ao menos um produto';
  end if;

  select d.id, d.filial_id, f.empresa_id into v_of
  from public.depositos d left join public.filiais f on f.id = d.filial_id
  where d.id = p_deposito_origem_id and d.tenant_id = v_tenant;
  if v_of.id is null then raise exception 'Depósito de origem não encontrado nesta empresa'; end if;

  select d.id, d.filial_id, f.empresa_id into v_df
  from public.depositos d left join public.filiais f on f.id = d.filial_id
  where d.id = p_deposito_destino_id and d.tenant_id = v_tenant;
  if v_df.id is null then raise exception 'Depósito de destino não encontrado nesta empresa'; end if;

  insert into public.transferencias (tenant_id, empresa_origem_id, filial_origem_id, deposito_origem_id,
    empresa_destino_id, filial_destino_id, deposito_destino_id, situacao, observacao)
  values (v_tenant, v_of.empresa_id, v_of.filial_id, p_deposito_origem_id,
    v_df.empresa_id, v_df.filial_id, p_deposito_destino_id, 'rascunho', p_observacao)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_itens) loop
    select greatest(coalesce(e.custo_medio,0), 0) into v_custo
    from public.estoques e
    where e.produto_id = (it->>'produto_id')::uuid and e.deposito_id = p_deposito_origem_id;
    if coalesce(v_custo,0) <= 0 then
      select coalesce(custo,0) into v_custo from public.produtos where id = (it->>'produto_id')::uuid;
    end if;

    insert into public.transferencia_itens (tenant_id, transferencia_id, produto_id, quantidade, custo_unitario, observacao)
    values (v_tenant, v_id, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric,
      round(coalesce(v_custo,0),4), nullif(it->>'observacao',''));
  end loop;

  update public.transferencias t set valor_total = (
    select coalesce(sum(i.quantidade * i.custo_unitario),0) from public.transferencia_itens i
    where i.transferencia_id = v_id)
  where t.id = v_id;

  return v_id;
end $$;

-- Enviar: baixa o estoque da origem e coloca em trânsito
CREATE OR REPLACE FUNCTION public.transferencia_enviar(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  t public.transferencias;
  it record;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'estoquista')) then
    raise exception 'Sem permissão para transferir mercadoria';
  end if;
  select * into t from public.transferencias where id = p_id and tenant_id = v_tenant;
  if t.id is null then raise exception 'Transferência não encontrada'; end if;
  if t.situacao <> 'rascunho' then raise exception 'Só é possível enviar uma transferência em rascunho'; end if;

  for it in select produto_id, sum(quantidade) q from public.transferencia_itens
            where transferencia_id = p_id group by produto_id loop
    perform public.registrar_movimentacao(it.produto_id, t.deposito_origem_id,
      'transferencia_saida'::mov_tipo, it.q, 'Transferência entre lojas',
      'TRANSF-' || t.numero, null, null);
  end loop;

  update public.transferencias
    set situacao = 'em_transito', enviado_em = now(), enviado_por = auth.uid()
  where id = p_id;
end $$;

-- Receber: entrada no destino pela quantidade conferida
CREATE OR REPLACE FUNCTION public.transferencia_receber(p_id uuid, p_itens jsonb DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  t public.transferencias;
  it record;
  v_qtd numeric;
  v_falta numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'estoquista')) then
    raise exception 'Sem permissão para receber transferência';
  end if;
  select * into t from public.transferencias where id = p_id and tenant_id = v_tenant;
  if t.id is null then raise exception 'Transferência não encontrada'; end if;
  if t.situacao <> 'em_transito' then raise exception 'Só é possível receber uma transferência em trânsito'; end if;

  if p_itens is not null then
    update public.transferencia_itens i
      set quantidade_recebida = least((x->>'quantidade_recebida')::numeric, i.quantidade)
    from jsonb_array_elements(p_itens) x
    where i.transferencia_id = p_id and i.id = (x->>'id')::uuid;
  end if;

  update public.transferencia_itens set quantidade_recebida = quantidade
   where transferencia_id = p_id and quantidade_recebida is null;

  for it in select id, produto_id, quantidade, quantidade_recebida, custo_unitario
            from public.transferencia_itens where transferencia_id = p_id loop
    v_qtd := coalesce(it.quantidade_recebida, 0);
    if v_qtd > 0 then
      perform public.registrar_movimentacao(it.produto_id, t.deposito_destino_id,
        'transferencia_entrada'::mov_tipo, v_qtd, 'Recebimento de transferência entre lojas',
        'TRANSF-' || t.numero, t.deposito_origem_id,
        case when it.custo_unitario > 0 then it.custo_unitario else null end);
    end if;
    v_falta := it.quantidade - v_qtd;
    if v_falta > 0 then
      perform public.registrar_movimentacao(it.produto_id, t.deposito_origem_id,
        'entrada'::mov_tipo, v_falta, 'Divergência na transferência: item não recebido no destino',
        'TRANSF-' || t.numero, null,
        case when it.custo_unitario > 0 then it.custo_unitario else null end);
    end if;
  end loop;

  update public.transferencias
    set situacao = 'recebida', recebido_em = now(), recebido_por = auth.uid(),
        observacao = coalesce(nullif(p_observacao,''), observacao),
        valor_total = (select coalesce(sum(coalesce(i.quantidade_recebida, i.quantidade) * i.custo_unitario),0)
                       from public.transferencia_itens i where i.transferencia_id = p_id)
  where id = p_id;
end $$;

-- Cancelar: rascunho encerra; em trânsito devolve ao depósito de origem
CREATE OR REPLACE FUNCTION public.transferencia_cancelar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  t public.transferencias;
  it record;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'estoquista')) then
    raise exception 'Sem permissão para cancelar transferência';
  end if;
  select * into t from public.transferencias where id = p_id and tenant_id = v_tenant;
  if t.id is null then raise exception 'Transferência não encontrada'; end if;
  if t.situacao = 'recebida' then raise exception 'Transferência já recebida não pode ser cancelada'; end if;
  if t.situacao = 'cancelada' then return; end if;

  if t.situacao = 'em_transito' then
    for it in select produto_id, sum(quantidade) q, max(custo_unitario) c
              from public.transferencia_itens where transferencia_id = p_id group by produto_id loop
      perform public.registrar_movimentacao(it.produto_id, t.deposito_origem_id,
        'entrada'::mov_tipo, it.q, coalesce(nullif(p_motivo,''),'Transferência cancelada — devolução ao depósito de origem'),
        'TRANSF-' || t.numero, null, case when it.c > 0 then it.c else null end);
    end loop;
  end if;

  update public.transferencias
    set situacao = 'cancelada', observacao = coalesce(nullif(p_motivo,''), observacao)
  where id = p_id;
end $$;

REVOKE ALL ON FUNCTION public.transferencia_criar(uuid, uuid, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.transferencia_enviar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.transferencia_receber(uuid, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.transferencia_cancelar(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transferencia_criar(uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_enviar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_receber(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_cancelar(uuid, text) TO authenticated;