CREATE OR REPLACE FUNCTION public.exige_entrega_propria(p_entrega_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
     OR public.has_role(auth.uid(), 'logistica') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entregas e
                  WHERE e.id = p_entrega_id AND e.tenant_id = public.current_tenant_id()
                    AND e.motorista_id IS NOT NULL AND e.motorista_id = public.current_motorista_id()) THEN
    RAISE EXCEPTION 'Esta entrega não é sua';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.exige_entrega_propria(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._fase0_injetar(p_assinatura text, p_papeis text[], p_extra text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  def text := pg_get_functiondef(p_assinatura::regprocedure);
  lista text := 'ARRAY[' || (SELECT string_agg(quote_literal(x), ', ') FROM unnest(p_papeis) x) || ']::text[]';
  novo text;
BEGIN
  IF def LIKE '%PERFORM public.exige_nao_salao();%' THEN
    novo := replace(def, 'PERFORM public.exige_nao_salao();',
      'PERFORM public.exige_nao_salao();' || E'\n  PERFORM public.exige_papel(' || lista || ');'
      || coalesce(E'\n  PERFORM ' || p_extra || ';', ''));
  ELSIF def LIKE '%SELECT public.exige_nao_salao();%' THEN
    novo := replace(def, 'SELECT public.exige_nao_salao();',
      'SELECT public.exige_nao_salao();' || E'\n  SELECT public.exige_papel(' || lista || ');');
  ELSE
    RAISE EXCEPTION 'Sem a trava do salão para ancorar a conferência de papel em %', p_assinatura;
  END IF;
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível proteger %', p_assinatura; END IF;
  EXECUTE novo;
END $$;

CREATE FUNCTION public._fase0_dividir(p_assinatura text, p_guarda text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_oid oid := p_assinatura::regprocedure::oid;
  v_nome text; v_args text; v_ident text; v_res text; v_chamada text; v_novo text;
  c record;
  def text;
BEGIN
  SELECT p.proname, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
         pg_get_function_result(p.oid),
         (SELECT string_agg(n, ', ') FROM unnest(p.proargnames) n)
    INTO v_nome, v_args, v_ident, v_res, v_chamada
    FROM pg_proc p WHERE p.oid = v_oid;
  FOR c IN
    SELECT p.oid, p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.oid <> v_oid
       AND pg_get_functiondef(p.oid) ~ ('(^|[^a-z_])' || v_nome || '\(')
  LOOP
    IF NOT c.prosecdef THEN RAISE EXCEPTION '% chama % mas não roda como dono do banco', c.proname, v_nome; END IF;
    def := pg_get_functiondef(c.oid);
    EXECUTE regexp_replace(def, '(^|[^a-z_])(public\.)?' || v_nome || '\(', '\1\2' || v_nome || '_interno(', 'g');
  END LOOP;
  EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', v_nome, v_ident, v_nome || '_interno');
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', v_nome || '_interno', v_ident);
  v_novo := 'CREATE FUNCTION public.' || quote_ident(v_nome) || '(' || v_args || ') RETURNS ' || v_res
    || ' LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $corpo$ BEGIN'
    || ' PERFORM public.exige_nao_salao(); ' || p_guarda || ' '
    || CASE WHEN v_res = 'void' THEN 'PERFORM' ELSE 'RETURN' END
    || ' public.' || quote_ident(v_nome || '_interno') || '(' || v_chamada || '); END $corpo$';
  EXECUTE v_novo;
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', v_nome, v_ident);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', v_nome, v_ident);
END $$;

SELECT public._fase0_dividir('public.pedido_avancar_status(uuid, public.pedido_situacao, text)',
  $g$PERFORM public.exige_papel(CASE p_situacao::text
       WHEN 'separacao' THEN ARRAY['administrador','gestor','estoquista']
       WHEN 'separado' THEN ARRAY['administrador','gestor','estoquista']
       WHEN 'conferencia' THEN ARRAY['administrador','gestor','estoquista']
       WHEN 'pronto_entrega' THEN ARRAY['administrador','gestor','estoquista']
       WHEN 'em_rota' THEN ARRAY['administrador','gestor','logistica']
       WHEN 'entregue' THEN ARRAY['administrador','gestor','logistica']
       ELSE ARRAY['administrador','gestor'] END);$g$);
SELECT public._fase0_dividir('public.gerar_contas_receber(uuid, integer, date, public.forma_pagamento)',
  $g$PERFORM public.exige_papel(ARRAY['administrador','gestor','financeiro','caixa']);$g$);
SELECT public._fase0_dividir('public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean)',
  $g$PERFORM public.exige_papel(ARRAY['administrador','gestor','financeiro']);$g$);
SELECT public._fase0_dividir('public.registrar_movimentacao(uuid, uuid, public.mov_tipo, numeric, text, text, uuid, numeric)',
  $g$PERFORM public.exige_papel(ARRAY['administrador','gestor','estoquista']);$g$);

SELECT public._fase0_injetar('public.gerar_nfe_agrupada(uuid[], text)', ARRAY['administrador','gestor','financeiro']);
SELECT public._fase0_injetar('public.gerar_nfe(uuid, text)', ARRAY['administrador','gestor','financeiro']);
SELECT public._fase0_injetar('public.pedido_checkout(uuid, numeric, public.forma_pagamento, integer, date, text)',
  ARRAY['administrador','gestor','financeiro','caixa']);
SELECT public._fase0_injetar('public.abrir_caixa(uuid, numeric)', ARRAY['administrador','gestor','caixa']);
SELECT public._fase0_injetar('public.fechar_caixa(uuid, numeric, text)', ARRAY['administrador','gestor','caixa']);
SELECT public._fase0_injetar('public.inventario_aplicar(uuid)', ARRAY['administrador','gestor','estoquista']);
SELECT public._fase0_injetar('public.converter_orcamentos_em_pedido(uuid[], uuid)',
  ARRAY['administrador','gestor','vendedor','caixa']);
SELECT public._fase0_injetar('public.planejar_entrega(uuid, jsonb, uuid, uuid, date, integer, text)',
  ARRAY['administrador','gestor','logistica']);
SELECT public._fase0_injetar('public.entrega_agendar(uuid, date, text, text, text)',
  ARRAY['administrador','gestor','logistica']);
SELECT public._fase0_injetar('public.entrega_iniciar_rota(uuid)',
  ARRAY['administrador','gestor','logistica','motorista'], 'public.exige_entrega_propria(p_entrega_id)');
SELECT public._fase0_injetar('public.entrega_concluir(uuid, text, text, text, text, text, jsonb, numeric, numeric)',
  ARRAY['administrador','gestor','logistica','motorista'], 'public.exige_entrega_propria(p_entrega_id)');
SELECT public._fase0_injetar('public.entrega_insucesso(uuid, text, text)',
  ARRAY['administrador','gestor','logistica','motorista'], 'public.exige_entrega_propria(p_entrega_id)');

REVOKE INSERT, UPDATE, DELETE ON public.pedidos FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.pedido_historico FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.entregas FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.entrega_itens FROM authenticated, anon;

REVOKE INSERT, UPDATE, DELETE ON public.pedido_itens FROM authenticated, anon;
GRANT UPDATE (quantidade_separada, quantidade_conferida, divergencia) ON public.pedido_itens TO authenticated;
DROP POLICY IF EXISTS pedido_itens_tenant ON public.pedido_itens;
CREATE POLICY pedido_itens_leitura ON public.pedido_itens FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY pedido_itens_separacao ON public.pedido_itens FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'estoquista')))
  WITH CHECK (tenant_id = public.current_tenant_id());

REVOKE DELETE ON public.contas_receber FROM authenticated, anon;
DROP POLICY IF EXISTS contas_receber_tenant ON public.contas_receber;
CREATE POLICY contas_receber_leitura ON public.contas_receber FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY contas_receber_insere ON public.contas_receber FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa')));
CREATE POLICY contas_receber_altera ON public.contas_receber FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa')))
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.preco_protege()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT (
       public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')) THEN
    IF TG_TABLE_NAME = 'produtos' AND (NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
                                       OR NEW.custo IS DISTINCT FROM OLD.custo) THEN
      RAISE EXCEPTION 'Preço e custo de produto só pelo administrador ou gestor';
    ELSIF TG_TABLE_NAME = 'produto_variacoes' AND NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN
      RAISE EXCEPTION 'Preço de produto só pelo administrador ou gestor';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS produtos_preco_protege_trg ON public.produtos;
CREATE TRIGGER produtos_preco_protege_trg BEFORE UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.preco_protege();
DROP TRIGGER IF EXISTS variacoes_preco_protege_trg ON public.produto_variacoes;
CREATE TRIGGER variacoes_preco_protege_trg BEFORE UPDATE ON public.produto_variacoes
  FOR EACH ROW EXECUTE FUNCTION public.preco_protege();

DROP POLICY IF EXISTS tenant_insert_empresas ON public.empresas;
DROP POLICY IF EXISTS tenant_update_empresas ON public.empresas;
CREATE POLICY empresas_altera_admin ON public.empresas FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_insert_filiais ON public.filiais;
DROP POLICY IF EXISTS tenant_update_filiais ON public.filiais;
CREATE POLICY filiais_insere_admin ON public.filiais FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'));
CREATE POLICY filiais_altera_admin ON public.filiais FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_nfe ON public.nfe;
DROP POLICY IF EXISTS tenant_update_nfe ON public.nfe;
CREATE POLICY nfe_insere_fiscal ON public.nfe FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'financeiro')));
CREATE POLICY nfe_altera_fiscal ON public.nfe FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro')))
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_insert_nfe_itens ON public.nfe_itens;
DROP POLICY IF EXISTS tenant_update_nfe_itens ON public.nfe_itens;
CREATE POLICY nfe_itens_insere_fiscal ON public.nfe_itens FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'financeiro')));
CREATE POLICY nfe_itens_altera_fiscal ON public.nfe_itens FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro')))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_role_permissoes ON public.role_permissoes;
DROP POLICY IF EXISTS tenant_update_role_permissoes ON public.role_permissoes;
CREATE POLICY role_permissoes_insere_admin ON public.role_permissoes FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'));
CREATE POLICY role_permissoes_altera_admin ON public.role_permissoes FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS orcamentos_tenant ON public.orcamentos;
CREATE POLICY orcamentos_leitura ON public.orcamentos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY orcamentos_escrita_venda ON public.orcamentos FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'vendedor') OR public.has_role(auth.uid(), 'caixa')))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'vendedor') OR public.has_role(auth.uid(), 'caixa')));
DROP POLICY IF EXISTS orcamento_itens_tenant ON public.orcamento_itens;
CREATE POLICY orcamento_itens_leitura ON public.orcamento_itens FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY orcamento_itens_escrita_venda ON public.orcamento_itens FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'vendedor') OR public.has_role(auth.uid(), 'caixa')))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'vendedor') OR public.has_role(auth.uid(), 'caixa')));

DROP FUNCTION public._fase0_injetar(text, text[], text);
DROP FUNCTION public._fase0_dividir(text, text);