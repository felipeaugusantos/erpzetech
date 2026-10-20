-- Login por usuário: cada pessoa entra com o nome de usuário dela dentro da empresa (o mesmo usuário pode existir em empresas diferentes), e
-- o e-mail passa a ser só contato, que pode se repetir entre vários usuários. Quem já existe continua entrando por e-mail e ganha um usuário
-- sugerido (parte do e-mail antes do @), que o administrador pode trocar. O login em si (usuário e senha) é feito por função do servidor.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS usuario text;

-- usuário sugerido para quem já existe: a parte do e-mail antes do @, só com letras minúsculas, números, ponto, hífen e sublinhado;
-- se já houver igual na empresa, ganha um número no fim
DO $$
DECLARE
  r record;
  v_base text;
  v_cand text;
  n integer;
BEGIN
  FOR r IN SELECT id, tenant_id, email FROM public.profiles WHERE tenant_id IS NOT NULL AND usuario IS NULL ORDER BY created_at, id LOOP
    v_base := left(regexp_replace(lower(split_part(coalesce(r.email, ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), 26);
    IF length(v_base) < 3 THEN v_base := 'usuario'; END IF;
    v_cand := v_base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE tenant_id = r.tenant_id AND usuario = v_cand) LOOP
      n := n + 1;
      v_cand := v_base || n::text;
    END LOOP;
    UPDATE public.profiles SET usuario = v_cand WHERE id = r.id;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_usuario_formato' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_usuario_formato CHECK (usuario IS NULL OR usuario ~ '^[a-z0-9._-]{3,30}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_tenant_usuario_uk ON public.profiles (tenant_id, usuario) WHERE usuario IS NOT NULL;

-- só o administrador da empresa (ou a equipe Ze Tech) muda o usuário de acesso de alguém: a própria pessoa não o troca pelo perfil
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

  IF OLD.tenant_id IS NULL
     AND NEW.id = auth.uid()
     AND current_setting('app.onboarding_uid', true) = NEW.id::text THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NOT public.eh_saas_operador() THEN
    RAISE EXCEPTION 'Alteração de empresa, filial ou rede não permitida';
  END IF;

  IF (NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
      OR NEW.filial_id IS DISTINCT FROM OLD.filial_id)
     AND NOT (public.eh_saas_operador() OR public.has_role(auth.uid(), 'administrador'))
  THEN
    RAISE EXCEPTION 'Alteração de empresa, filial ou rede não permitida';
  END IF;

  IF NEW.usuario IS DISTINCT FROM OLD.usuario
     AND NOT (public.eh_saas_operador() OR public.has_role(auth.uid(), 'administrador'))
  THEN
    RAISE EXCEPTION 'Só o administrador altera o usuário de acesso';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_protege_vinculo() FROM PUBLIC, anon, authenticated;
