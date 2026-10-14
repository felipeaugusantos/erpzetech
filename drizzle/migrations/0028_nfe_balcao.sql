DO $$
DECLARE
  sig text;
  def text;
  novo text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.gerar_nfe(uuid, text)',
    'public.gerar_nfe_agrupada(uuid[], text)',
    'public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean)'
  ] LOOP
    def := pg_get_functiondef(sig::regprocedure);
    novo := replace(replace(def,
      $q$'gestor', 'financeiro']::text[]$q$, $q$'gestor', 'financeiro', 'vendedor', 'caixa']::text[]$q$),
      $q$'gestor','financeiro']$q$, $q$'gestor','financeiro','vendedor','caixa']$q$);
    IF novo = def THEN RAISE EXCEPTION 'Não foi possível ampliar o papel em %', sig; END IF;
    EXECUTE novo;
  END LOOP;
END $$;