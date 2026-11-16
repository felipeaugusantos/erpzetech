-- Aceite dos Termos de Uso e da Política de Privacidade (LGPD). Cada pessoa aceita a versão vigente dos dois documentos uma vez;
-- quando a versão muda (src/lib/legal.ts), o aceite é pedido de novo. O registro só cresce: nada se edita nem se apaga, e fica como
-- prova de quem aceitou, quando e qual versão. A tabela não tem acesso direto (só funções, e o serviço para exportar a prova).
CREATE TABLE IF NOT EXISTS public.aceites_legais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  versao text NOT NULL CHECK (versao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  aceito_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, versao)
);
CREATE INDEX IF NOT EXISTS aceites_legais_tenant_idx ON public.aceites_legais (tenant_id);
ALTER TABLE public.aceites_legais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aceites_legais FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.aceites_legais TO service_role;
CREATE POLICY salao_restrito ON public.aceites_legais AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY contador_restrito ON public.aceites_legais AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));

-- A pessoa logada já aceitou esta versão? Vale para qualquer perfil (salão e contador também aceitam).
CREATE OR REPLACE FUNCTION public.aceite_legal_meu(p_versao text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.aceites_legais a WHERE a.user_id = auth.uid() AND a.versao = p_versao)
$fn$;
REVOKE ALL ON FUNCTION public.aceite_legal_meu(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceite_legal_meu(text) TO authenticated;

-- Registra o aceite da pessoa logada (repetir não duplica nem muda a data do primeiro aceite). Só a própria pessoa aceita por si.
CREATE OR REPLACE FUNCTION public.aceite_legal_registrar(p_versao text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_em timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Entre para aceitar os termos'; END IF;
  IF p_versao IS NULL OR p_versao !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Versão dos termos inválida';
  END IF;
  INSERT INTO public.aceites_legais (user_id, tenant_id, versao)
  VALUES (v_user, (SELECT p.tenant_id FROM public.profiles p WHERE p.id = v_user), p_versao)
  ON CONFLICT (user_id, versao) DO NOTHING;
  SELECT a.aceito_em INTO v_em FROM public.aceites_legais a WHERE a.user_id = v_user AND a.versao = p_versao;
  RETURN v_em;
END
$fn$;
REVOKE ALL ON FUNCTION public.aceite_legal_registrar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceite_legal_registrar(text) TO authenticated;
