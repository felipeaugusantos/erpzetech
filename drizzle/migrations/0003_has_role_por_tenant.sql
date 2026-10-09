-- has_role passa a considerar o tenant: o papel só vale se a linha de user_roles pertence ao
-- mesmo tenant do perfil do usuário. Antes, um papel gravado em outro tenant (ou deixado para
-- trás após troca de tenant) continuava valendo em qualquer lugar.
--
-- ANTES DE APLICAR, confira se há papéis em tenant diferente do perfil (eles deixam de valer):
--   SELECT u.email, r.role, r.tenant_id AS tenant_do_papel, p.tenant_id AS tenant_do_perfil
--   FROM public.user_roles r
--   JOIN auth.users u ON u.id = r.user_id
--   LEFT JOIN public.profiles p ON p.id = r.user_id
--   WHERE r.tenant_id IS DISTINCT FROM p.tenant_id;

-- 1. Papéis antigos gravados sem tenant (ex.: login de motorista) herdam o tenant do perfil.
UPDATE public.user_roles r
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = r.user_id
   AND r.tenant_id IS NULL
   AND p.tenant_id IS NOT NULL;

-- 2. Papéis novos sem tenant herdam o tenant do perfil, para nenhum fluxo gravar papel "solto".
CREATE OR REPLACE FUNCTION public.user_roles_define_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.profiles WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_roles_define_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_define_tenant ON public.user_roles;
CREATE TRIGGER user_roles_define_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, user_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_define_tenant();

-- 3. has_role considera o tenant do perfil.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
     WHERE r.user_id = _user_id
       AND r.role = _role
       AND p.tenant_id IS NOT NULL
       AND r.tenant_id = p.tenant_id
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
