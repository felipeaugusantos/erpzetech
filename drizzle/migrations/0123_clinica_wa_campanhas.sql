CREATE TABLE public.clinica_wa_campanha_envios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campanha_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 criado_por uuid NOT NULL,
 cliente_id uuid NOT NULL REFERENCES public.clientes(id),
 tutor text NOT NULL,
 numero text NOT NULL CHECK (numero ~ '^55[0-9]{10,11}$'),
 texto text NOT NULL,
 situacao text NOT NULL DEFAULT 'enviando' CHECK (situacao IN ('enviando','enviada','falhou','incerto')),
 id_externo text, erro text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, campanha_id, cliente_id)
);
REVOKE ALL ON public.clinica_wa_campanha_envios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clinica_wa_campanha_envios TO authenticated;
GRANT ALL ON public.clinica_wa_campanha_envios TO service_role;
ALTER TABLE public.clinica_wa_campanha_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY campanhas_ler ON public.clinica_wa_campanha_envios FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() AND public.clinica_liberada() AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor') OR public.has_role(auth.uid(), 'veterinario')));
CREATE POLICY salao_restrito ON public.clinica_wa_campanha_envios AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY contador_restrito ON public.clinica_wa_campanha_envios AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_contador_restrito()));
CREATE INDEX clinica_wa_campanha_envios_data ON public.clinica_wa_campanha_envios (tenant_id, created_at DESC);