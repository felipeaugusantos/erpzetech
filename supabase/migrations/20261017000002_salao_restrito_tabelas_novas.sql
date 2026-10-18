-- O CI (bloco 16 do smoke) reprova tabela com RLS sem a política restritiva do salão. Estas tabelas chegaram pelo Lovable
-- (grade de estoque, personalização do pedido e CT-e da compra) sem ela; garçom e cozinha não devem ler nenhuma delas.
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

-- Funções chamáveis que chegaram sem a trava do salão (CI: bloco 16 do smoke). A trava entra na primeira linha da função;
-- nada mais muda nelas.
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
