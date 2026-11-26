CREATE TABLE public.clinica_wa_campanha_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 80),
  texto text NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 1000),
  ativo boolean NOT NULL DEFAULT true,
  aprovado_por uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.clinica_wa_campanha_modelos (tenant_id, ativo);
GRANT SELECT, INSERT, UPDATE ON public.clinica_wa_campanha_modelos TO authenticated;
GRANT ALL ON public.clinica_wa_campanha_modelos TO service_role;
ALTER TABLE public.clinica_wa_campanha_modelos ENABLE ROW LEVEL SECURITY;
CREATE POLICY modelos_ler ON public.clinica_wa_campanha_modelos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY modelos_criar ON public.clinica_wa_campanha_modelos FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND aprovado_por = auth.uid()
    AND (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')));
CREATE POLICY modelos_editar ON public.clinica_wa_campanha_modelos FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')))
  WITH CHECK (tenant_id = public.current_tenant_id() AND aprovado_por = auth.uid());
CREATE POLICY salao_restrito ON public.clinica_wa_campanha_modelos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY contador_restrito ON public.clinica_wa_campanha_modelos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));