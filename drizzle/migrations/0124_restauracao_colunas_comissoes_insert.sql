DROP POLICY IF EXISTS comissoes_insert ON public.comissoes;
CREATE POLICY comissoes_insert ON public.comissoes FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'administrador'::public.app_role)
    OR public.has_role(auth.uid(), 'gestor'::public.app_role)
    OR (situacao = 'a_aprovar' AND pago_em IS NULL)
  )
);

CREATE OR REPLACE FUNCTION public._backup_restauracao_colunas_ok(p_tabela text, p_linhas jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  chaves text[];
BEGIN
  SELECT array_agg(k ORDER BY k) INTO chaves FROM jsonb_object_keys(p_linhas -> 0) k;
  IF EXISTS (
    SELECT 1 FROM unnest(chaves) k
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = format('public.%I', p_tabela)::regclass
          AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attname = k)
  ) THEN
    RAISE EXCEPTION 'O arquivo traz campo que não existe neste cadastro.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_linhas) r
     WHERE jsonb_typeof(r) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) IS DISTINCT FROM chaves
  ) THEN
    RAISE EXCEPTION 'Todas as linhas devem trazer os mesmos campos.' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._backup_restauracao_colunas_ok(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
   WHERE p.proname = 'backup_restaurar_tabela' AND p.pronamespace = 'public'::regnamespace;
  IF src IS NOT NULL AND position('_backup_restauracao_colunas_ok' IN src) = 0 THEN
    src := replace(src,
      '  -- colunas do arquivo que existem na tabela e não são geradas',
      '  PERFORM public._backup_restauracao_colunas_ok(p_tabela, p_linhas);' || chr(10) || '  -- colunas do arquivo que existem na tabela e não são geradas');
    IF position('_backup_restauracao_colunas_ok' IN src) = 0 THEN
      RAISE EXCEPTION 'Não foi possível atualizar backup_restaurar_tabela';
    END IF;
    EXECUTE src;
  END IF;
END $do$;