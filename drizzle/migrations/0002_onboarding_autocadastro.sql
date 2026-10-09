-- Onboarding de quem se cadastra sozinho: cria o espaço (tenant) próprio e torna a pessoa
-- administradora dele. Só vale para quem ainda não tem tenant nem papéis, e uma única vez.

-- Só onboarding_criar_espaco pode mudar o tenant_id de uma sessão de usuário, e apenas de NULL
-- para um tenant novo: ela marca a transação (set_config local) com o id do próprio usuário.
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

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_protege_vinculo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.onboarding_criar_espaco(p_nome text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text := btrim(coalesce(p_nome, ''));
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF char_length(v_nome) < 2 OR char_length(v_nome) > 120 THEN
    RAISE EXCEPTION 'Informe o nome da empresa (2 a 120 caracteres)';
  END IF;

  -- trava o perfil para evitar dois espaços em chamadas simultâneas
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil não encontrado'; END IF;

  IF public.current_tenant_id() IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid)
     OR public.eh_saas_operador() THEN
    RAISE EXCEPTION 'Esta conta já está vinculada a uma empresa';
  END IF;

  INSERT INTO public.tenants (nome) VALUES (v_nome) RETURNING id INTO v_tenant;

  PERFORM set_config('app.onboarding_uid', v_uid::text, true);
  UPDATE public.profiles SET tenant_id = v_tenant, empresa_id = NULL, filial_id = NULL WHERE id = v_uid;
  PERFORM set_config('app.onboarding_uid', '', true);
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (v_uid, v_tenant, 'administrador');

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.onboarding_criar_espaco(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_criar_espaco(text) TO authenticated;
