DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.frente_cancelar_venda(uuid, uuid, text)'::regprocedure);
  IF position('nfce:' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $q$v_gestor := public.consumir_autorizacao(p_autorizacao, 'cancelar_venda');$q$,
    $q$v_gestor := public.consumir_autorizacao(p_autorizacao, 'cancelar_venda');
  PERFORM pg_advisory_xact_lock(hashtextextended('nfce:' || p_pedido_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.nfe n JOIN public.nfe_pedidos np ON np.nfe_id = n.id
              WHERE np.pedido_id = p_pedido_id AND n.modelo = 'nfce'
                AND n.situacao IN ('transmitida', 'autorizada', 'contingencia')) THEN
    RAISE EXCEPTION 'Esta venda tem NFC-e enviada à Sefaz. Cancele a nota fiscal antes de cancelar a venda';
  END IF;
  DELETE FROM public.nfe WHERE modelo = 'nfce' AND situacao = 'rascunho'
     AND id IN (SELECT nfe_id FROM public.nfe_pedidos WHERE pedido_id = p_pedido_id);
  UPDATE public.nfe SET situacao = 'cancelada', cancelada_em = now(),
         motivo_cancelamento = 'Venda cancelada antes da transmissão',
         mensagem = 'NFC-e cancelada porque a venda foi cancelada antes de ser transmitida.'
   WHERE modelo = 'nfce' AND situacao IN ('pronta', 'rejeitada')
     AND id IN (SELECT nfe_id FROM public.nfe_pedidos WHERE pedido_id = p_pedido_id);$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar frente_cancelar_venda'; END IF;
  EXECUTE novo;
END $$;

DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.nfce_criar(uuid, text)'::regprocedure);
  IF position('nfce:' IN split_part(def, 'FROM public.pedidos WHERE id = p_pedido_id', 1)) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $q$SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;$q$,
    $q$PERFORM pg_advisory_xact_lock(hashtextextended('nfce:' || p_pedido_id::text, 0));
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar o bloqueio de nfce_criar'; END IF;
  EXECUTE novo;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estoque_grade_movimentos', 'estoque_grade', 'pedido_personalizacao', 'compra_ctes'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
      EXECUTE format($f$CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING ((SELECT NOT public.eh_salao_restrito()))$f$, t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  f record;
  def text;
  novo text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, l.lanname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND p.proname IN ('nfe_entrada_vincular_cte', 'compra_avancar_status', 'produto_proximo_codigo',
                         'estoque_grade_ajustar', 'nfe_entrada_completar_impostos', 'empresa_zerar_dados')
       AND pg_get_functiondef(p.oid) NOT LIKE '%exige_nao_salao%'
  LOOP
    IF f.lanname <> 'plpgsql' THEN
      RAISE EXCEPTION 'A função % não é plpgsql; ajuste a trava do salão à mão', f.proname;
    END IF;
    def := pg_get_functiondef(f.oid);
    novo := regexp_replace(def, '\mbegin\M', E'begin\n  perform public.exige_nao_salao();', 'i');
    IF novo = def THEN RAISE EXCEPTION 'Não foi possível pôr a trava do salão em %', f.proname; END IF;
    EXECUTE novo;
  END LOOP;
END $$;

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS show_ao_vivo boolean NOT NULL DEFAULT false;