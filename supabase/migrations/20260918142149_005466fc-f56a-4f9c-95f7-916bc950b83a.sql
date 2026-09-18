-- 1) custo real nas movimentações
ALTER TABLE public.estoque_movimentacoes
  ADD COLUMN IF NOT EXISTS custo_unitario numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_total numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.registrar_movimentacao(
  p_produto_id uuid,
  p_deposito_id uuid,
  p_tipo mov_tipo,
  p_quantidade numeric,
  p_motivo text DEFAULT NULL::text,
  p_documento text DEFAULT NULL::text,
  p_deposito_destino_id uuid DEFAULT NULL::uuid,
  p_custo numeric DEFAULT NULL::numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_unidade text;
  v_custo_prod numeric;
  v_permite_negativo boolean;
  v_qtd numeric; v_res numeric;
  v_disp numeric;
  v_novo numeric;
  v_mov_id uuid;
  v_qtd_dest numeric;
  v_custo numeric;
  v_custo_dest numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe uma quantidade maior que zero'; end if;

  select p.unidade, p.custo into v_unidade, v_custo_prod from public.produtos p
   where p.id = p_produto_id and p.tenant_id = v_tenant;
  if v_unidade is null then raise exception 'Produto não encontrado nesta empresa'; end if;

  select d.permite_negativo into v_permite_negativo from public.depositos d
   where d.id = p_deposito_id and d.tenant_id = v_tenant;
  if v_permite_negativo is null then raise exception 'Depósito não encontrado nesta empresa'; end if;

  insert into public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
  values (v_tenant, p_produto_id, p_deposito_id, 0, 0)
  on conflict (produto_id, deposito_id) do nothing;

  select quantidade, reservado, custo_medio into v_qtd, v_res, v_custo from public.estoques
   where produto_id = p_produto_id and deposito_id = p_deposito_id for update;
  v_disp := v_qtd - v_res;

  -- custo real do movimento: informado na entrada, senão o custo médio do depósito, senão o do produto
  if p_tipo in ('entrada','transferencia_entrada') and coalesce(p_custo, 0) > 0 then
    v_custo := p_custo;
  elsif coalesce(v_custo, 0) <= 0 then
    v_custo := coalesce(v_custo_prod, 0);
  end if;

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

  -- entrada com custo informado recalcula o custo médio do depósito
  if p_tipo in ('entrada','transferencia_entrada') and coalesce(p_custo, 0) > 0 then
    perform public.atualizar_custo_medio(p_produto_id, p_deposito_id, p_quantidade, p_custo);
  end if;

  insert into public.estoque_movimentacoes
    (tenant_id, produto_id, deposito_id, deposito_destino_id, tipo, quantidade,
     saldo_anterior, saldo_posterior, unidade, documento, motivo, usuario_id,
     custo_unitario, valor_total)
  values (v_tenant, p_produto_id, p_deposito_id, p_deposito_destino_id, p_tipo, p_quantidade,
     v_qtd, v_novo, v_unidade, p_documento, p_motivo, auth.uid(),
     round(coalesce(v_custo,0), 4), round(p_quantidade * coalesce(v_custo,0), 2))
  returning id into v_mov_id;

  -- transferência: entrada automática no depósito destino, pelo custo de saída
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

    v_custo_dest := coalesce(v_custo, 0);
    if v_custo_dest > 0 then
      perform public.atualizar_custo_medio(p_produto_id, p_deposito_destino_id, p_quantidade, v_custo_dest);
    end if;

    insert into public.estoque_movimentacoes
      (tenant_id, produto_id, deposito_id, deposito_destino_id, tipo, quantidade,
       saldo_anterior, saldo_posterior, unidade, documento, motivo, usuario_id,
       custo_unitario, valor_total)
    values (v_tenant, p_produto_id, p_deposito_destino_id, p_deposito_id, 'transferencia_entrada', p_quantidade,
       v_qtd_dest, v_qtd_dest + p_quantidade, v_unidade, p_documento,
       coalesce(p_motivo,'Transferência entre depósitos'), auth.uid(),
       round(v_custo_dest, 4), round(p_quantidade * v_custo_dest, 2));
  end if;

  return v_mov_id;
end $function$;

-- 2) balanço de estoque (contagem)
CREATE TABLE IF NOT EXISTS public.inventarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  deposito_id uuid NOT NULL REFERENCES public.depositos(id),
  descricao text,
  situacao text NOT NULL DEFAULT 'contando',
  observacao text,
  usuario_id uuid,
  aplicado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventario_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  quantidade_sistema numeric NOT NULL DEFAULT 0,
  quantidade_contada numeric,
  custo_unitario numeric NOT NULL DEFAULT 0,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inventario_id, produto_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventarios TO authenticated;
GRANT ALL ON public.inventarios TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventario_itens TO authenticated;
GRANT ALL ON public.inventario_itens TO service_role;

ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventarios_tenant_select" ON public.inventarios
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "inventarios_tenant_insert" ON public.inventarios
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "inventarios_tenant_update" ON public.inventarios
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "inventarios_tenant_delete" ON public.inventarios
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id() AND situacao <> 'aplicado');

CREATE POLICY "inventario_itens_tenant_select" ON public.inventario_itens
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "inventario_itens_tenant_insert" ON public.inventario_itens
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "inventario_itens_tenant_update" ON public.inventario_itens
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "inventario_itens_tenant_delete" ON public.inventario_itens
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER inventarios_touch BEFORE UPDATE ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER inventario_itens_touch BEFORE UPDATE ON public.inventario_itens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.inventario_abrir(p_deposito_id uuid, p_descricao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;
  if exists (select 1 from public.inventarios where deposito_id = p_deposito_id and tenant_id = v_tenant and situacao = 'contando') then
    raise exception 'Já existe uma contagem em aberto neste depósito';
  end if;

  insert into public.inventarios (tenant_id, deposito_id, descricao, usuario_id)
  values (v_tenant, p_deposito_id, nullif(trim(coalesce(p_descricao,'')),''), auth.uid())
  returning id into v_id;

  insert into public.inventario_itens (tenant_id, inventario_id, produto_id, quantidade_sistema, custo_unitario)
  select v_tenant, v_id, e.produto_id, e.quantidade,
         case when coalesce(e.custo_medio,0) > 0 then e.custo_medio else coalesce(p.custo,0) end
    from public.estoques e
    join public.produtos p on p.id = e.produto_id
   where e.deposito_id = p_deposito_id and e.tenant_id = v_tenant and p.ativo;

  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.inventario_contar(p_item_id uuid, p_contada numeric, p_observacao text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_situacao text;
begin
  select i.situacao into v_situacao from public.inventario_itens it
    join public.inventarios i on i.id = it.inventario_id
   where it.id = p_item_id and it.tenant_id = v_tenant;
  if v_situacao is null then raise exception 'Item de contagem não encontrado'; end if;
  if v_situacao <> 'contando' then raise exception 'Esta contagem já foi encerrada'; end if;
  if p_contada is not null and p_contada < 0 then raise exception 'A quantidade contada não pode ser negativa'; end if;

  update public.inventario_itens
     set quantidade_contada = p_contada,
         observacao = nullif(trim(coalesce(p_observacao,'')),''),
         updated_at = now()
   where id = p_item_id and tenant_id = v_tenant;
end $$;

CREATE OR REPLACE FUNCTION public.inventario_aplicar(p_inventario_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_inv record;
  v_item record;
  v_qtd_atual numeric;
  v_total integer := 0;
begin
  select * into v_inv from public.inventarios
   where id = p_inventario_id and tenant_id = v_tenant for update;
  if v_inv is null then raise exception 'Contagem não encontrada'; end if;
  if v_inv.situacao <> 'contando' then raise exception 'Esta contagem já foi encerrada'; end if;

  for v_item in
    select it.* from public.inventario_itens it
     where it.inventario_id = p_inventario_id and it.tenant_id = v_tenant
       and it.quantidade_contada is not null
  loop
    select quantidade into v_qtd_atual from public.estoques
     where produto_id = v_item.produto_id and deposito_id = v_inv.deposito_id and tenant_id = v_tenant;

    if coalesce(v_qtd_atual, 0) <> v_item.quantidade_contada then
      perform public.registrar_movimentacao(
        v_item.produto_id, v_inv.deposito_id, 'inventario'::mov_tipo,
        v_item.quantidade_contada,
        'Balanço de estoque' || coalesce(' — ' || v_inv.descricao, ''),
        'BAL-' || left(replace(p_inventario_id::text,'-',''), 8),
        null, nullif(v_item.custo_unitario, 0)
      );
      v_total := v_total + 1;
    end if;
  end loop;

  update public.inventarios
     set situacao = 'aplicado', aplicado_em = now(), updated_at = now()
   where id = p_inventario_id and tenant_id = v_tenant;

  return v_total;
end $$;

CREATE OR REPLACE FUNCTION public.inventario_cancelar(p_inventario_id uuid, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare v_tenant uuid := public.current_tenant_id();
begin
  update public.inventarios
     set situacao = 'cancelado',
         observacao = coalesce(nullif(trim(coalesce(p_motivo,'')),''), observacao),
         updated_at = now()
   where id = p_inventario_id and tenant_id = v_tenant and situacao = 'contando';
  if not found then raise exception 'Contagem não encontrada ou já encerrada'; end if;
end $$;
