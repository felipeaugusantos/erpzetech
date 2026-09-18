-- 1. contatos: leitura/alteração somente para operadores Ze Tech
DROP POLICY IF EXISTS contatos_select ON public.contatos;
DROP POLICY IF EXISTS contatos_update ON public.contatos;

CREATE POLICY contatos_select ON public.contatos
  FOR SELECT TO authenticated
  USING (public.eh_saas_operador());

CREATE POLICY contatos_update ON public.contatos
  FOR UPDATE TO authenticated
  USING (public.eh_saas_operador())
  WITH CHECK (public.eh_saas_operador());

-- 2. profiles: impedir que o próprio usuário mude tenant_id/empresa_id/filial_id
CREATE OR REPLACE FUNCTION public.profiles_protege_vinculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
      OR NEW.filial_id IS DISTINCT FROM OLD.filial_id)
     AND NOT (
       public.eh_saas_operador()
       OR public.has_role(auth.uid(), 'administrador')
       OR (OLD.tenant_id IS NULL AND NEW.id = auth.uid())
     )
  THEN
    RAISE EXCEPTION 'Alteração de empresa, filial ou rede não permitida';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_protege_vinculo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_protege_vinculo ON public.profiles;
CREATE TRIGGER profiles_protege_vinculo
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protege_vinculo();

-- 3. user_roles: leitura própria sempre; lista do tenant apenas para admin/gestor
DROP POLICY IF EXISTS roles_read ON public.user_roles;
CREATE POLICY roles_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_role(auth.uid(), 'administrador')
        OR public.has_role(auth.uid(), 'gestor')
      )
    )
  );

-- 4. storage: escopo por tenant (primeiro nível do caminho é o tenant_id)
DROP POLICY IF EXISTS produtos_img_read ON storage.objects;
DROP POLICY IF EXISTS produtos_img_insert ON storage.objects;
DROP POLICY IF EXISTS produtos_img_update ON storage.objects;
DROP POLICY IF EXISTS produtos_img_delete ON storage.objects;
DROP POLICY IF EXISTS entregas_fotos_read ON storage.objects;
DROP POLICY IF EXISTS entregas_fotos_insert ON storage.objects;

CREATE POLICY produtos_img_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY produtos_img_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY produtos_img_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY produtos_img_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY entregas_fotos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'entregas'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY entregas_fotos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'entregas'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- 5. Funções SECURITY DEFINER: remover execução de visitantes não autenticados
--    e remover execução direta das funções de gatilho.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, pg_get_function_result(p.oid) AS ret
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.ret = 'trigger' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig);
    END IF;
  END LOOP;
END;
$$;
