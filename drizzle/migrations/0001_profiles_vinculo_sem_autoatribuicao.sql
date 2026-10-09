-- Complementa 20260925000000: com o signup criando perfis sem tenant, a exceção
-- "OLD.tenant_id IS NULL AND NEW.id = auth.uid()" de profiles_protege_vinculo deixava o
-- próprio usuário se atribuir a qualquer tenant (ex.: o de demonstração) via profiles_update_self.
--
-- Regras agora:
--  * tenant_id só muda por operador Ze Tech ou sem sessão de usuário (service role / provisionamento);
--  * empresa_id/filial_id continuam editáveis por operador ou administrador (onboarding da empresa).
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
