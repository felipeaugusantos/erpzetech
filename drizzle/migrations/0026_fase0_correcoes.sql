REVOKE EXECUTE ON FUNCTION public.comissionar_pedido_id(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS chave_idempotencia uuid;
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_chave_idem_uk
  ON public.pedidos (tenant_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

DROP FUNCTION IF EXISTS public.frente_venda(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, uuid);

CREATE FUNCTION public.frente_venda(
  p_deposito_id uuid, p_itens jsonb, p_forma forma_pagamento, p_cliente_id uuid DEFAULT NULL,
  p_desconto numeric DEFAULT 0, p_parcelas integer DEFAULT 1, p_primeiro_vencimento date DEFAULT NULL,
  p_autorizacao uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_caixa uuid := public.frente_caixa_atual(); v_limite numeric; v_sub numeric := 0; it jsonb;
  v_pedido uuid; v_gestor uuid; v_existente uuid;
begin
  PERFORM public.exige_nao_salao();
  if p_chave is not null then
    perform pg_advisory_xact_lock(hashtextextended(public.current_tenant_id()::text || ':' || p_chave::text, 0));
    select id into v_existente from public.pedidos
     where tenant_id = public.current_tenant_id() and chave_idempotencia = p_chave;
    if v_existente is not null then return v_existente; end if;
  end if;
  if v_caixa is null then raise exception 'Abra o seu caixa antes de vender'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_sub := v_sub + (it->>'quantidade')::numeric * coalesce((it->>'preco_unitario')::numeric,0);
  end loop;
  select coalesce(e.pdv_desconto_limite,5) into v_limite from public.empresas e
    where e.tenant_id = public.current_tenant_id() order by e.created_at limit 1;
  if v_sub > 0 and coalesce(p_desconto,0) > round(v_sub * coalesce(v_limite,5) / 100, 2) then
    if p_autorizacao is null then raise exception 'Desconto acima de %%%: exige senha do gestor', v_limite; end if;
    v_gestor := public.consumir_autorizacao(p_autorizacao, 'desconto');
  end if;
  v_pedido := public.pdv_venda(p_deposito_id, p_itens, p_forma, p_cliente_id, p_desconto, p_parcelas, p_primeiro_vencimento, 'Venda na frente de caixa');
  update public.pedidos set caixa_id = v_caixa, autorizado_por = v_gestor, chave_idempotencia = p_chave where id = v_pedido;
  return v_pedido;
end $function$;

REVOKE ALL ON FUNCTION public.frente_venda(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frente_venda(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.nfe_protege_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.situacao IS DISTINCT FROM OLD.situacao
    OR NEW.chave IS DISTINCT FROM OLD.chave
    OR NEW.protocolo IS DISTINCT FROM OLD.protocolo
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.provider_status IS DISTINCT FROM OLD.provider_status
    OR NEW.retorno IS DISTINCT FROM OLD.retorno
    OR NEW.mensagem IS DISTINCT FROM OLD.mensagem
    OR NEW.transmitida_em IS DISTINCT FROM OLD.transmitida_em
    OR NEW.autorizada_em IS DISTINCT FROM OLD.autorizada_em
    OR NEW.cancelada_em IS DISTINCT FROM OLD.cancelada_em
    OR NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento) THEN
    RAISE EXCEPTION 'O andamento da nota fiscal só muda pela transmissão ou pelo cancelamento na Sefaz';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nfe_protege_estado_trg ON public.nfe;
CREATE TRIGGER nfe_protege_estado_trg BEFORE UPDATE ON public.nfe
  FOR EACH ROW EXECUTE FUNCTION public.nfe_protege_estado();

DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.abrir_caixa(uuid, numeric)'::regprocedure);
  novo := replace(def, $q$  if exists (select 1 from public.caixas where tenant_id = v_tenant and filial_id = p_filial_id and situacao = 'aberto') then$q$,
    $q$  if not exists (select 1 from public.filiais where id = p_filial_id and tenant_id = v_tenant) then
    raise exception 'Filial não encontrada nesta empresa';
  end if;
  if exists (select 1 from public.caixas where tenant_id = v_tenant and filial_id = p_filial_id and situacao = 'aberto') then$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível validar a filial em abrir_caixa'; END IF;
  EXECUTE novo;

  def := pg_get_functiondef('public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text)'::regprocedure);
  novo := replace(def, $q$  select d.filial_id, f.empresa_id into v_fil, v_emp$q$,
    $q$  if p_obra_id is not null and not exists (select 1 from public.obras where id = p_obra_id and tenant_id = v_tenant) then
    raise exception 'Obra não encontrada nesta empresa';
  end if;
  if p_vendedor_id is not null and not exists (select 1 from public.profiles where id = p_vendedor_id and tenant_id = v_tenant) then
    raise exception 'Vendedor não encontrado nesta empresa';
  end if;
  if p_profissional_id is not null and not exists (select 1 from public.profissionais where id = p_profissional_id and tenant_id = v_tenant) then
    raise exception 'Profissional não encontrado nesta empresa';
  end if;
  select d.filial_id, f.empresa_id into v_fil, v_emp$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível validar obra, vendedor e profissional em criar_pedido_direto'; END IF;
  EXECUTE novo;
END $$;

CREATE OR REPLACE FUNCTION public.usuario_definir_papeis(p_user_id uuid, p_papeis public.app_role[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL OR NOT public.has_role(auth.uid(), 'administrador') THEN
    RAISE EXCEPTION 'Somente o administrador da empresa pode gerenciar usuários';
  END IF;
  IF p_papeis IS NULL OR cardinality(p_papeis) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um perfil';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Usuário não pertence à sua empresa';
  END IF;
  IF p_user_id = auth.uid() AND NOT ('administrador'::public.app_role = ANY (p_papeis)) THEN
    RAISE EXCEPTION 'Você não pode remover o seu próprio perfil de administrador';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  SELECT p_user_id, v_tenant, r FROM (SELECT DISTINCT unnest(p_papeis) AS r) x;
END $$;

REVOKE ALL ON FUNCTION public.usuario_definir_papeis(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_definir_papeis(uuid, public.app_role[]) TO authenticated;