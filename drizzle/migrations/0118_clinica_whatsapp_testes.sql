CREATE TABLE public.clinica_wa_testes (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id), criado_por uuid NOT NULL,
 numero text NOT NULL CHECK (numero ~ '^55[0-9]{10,11}$'),
 modelo text NOT NULL CHECK (modelo IN ('vacina_antes','vacina_atrasada','consulta_antes')), texto text NOT NULL,
 situacao text NOT NULL DEFAULT 'enviando' CHECK (situacao IN ('enviando','enviada','entregue','lida','falhou','incerto')),
 id_externo text, erro text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.clinica_wa_testes TO authenticated;
GRANT ALL ON public.clinica_wa_testes TO service_role;
ALTER TABLE public.clinica_wa_testes ENABLE ROW LEVEL SECURITY;
CREATE POLICY testes_ler ON public.clinica_wa_testes FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() AND public.clinica_liberada() AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor') OR public.has_role(auth.uid(), 'veterinario')));
CREATE POLICY salao_restrito ON public.clinica_wa_testes AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY contador_restrito ON public.clinica_wa_testes AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_contador_restrito()));
CREATE INDEX clinica_wa_testes_externo ON public.clinica_wa_testes (tenant_id,id_externo) WHERE id_externo IS NOT NULL;
CREATE TABLE public.clinica_wa_teste_status (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), id_externo text NOT NULL,
 status text NOT NULL CHECK (status IN ('entregue','lida','erro')), recebido_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,id_externo,status)
);
GRANT ALL ON public.clinica_wa_teste_status TO service_role;
ALTER TABLE public.clinica_wa_teste_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.clinica_wa_teste_status AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY contador_restrito ON public.clinica_wa_teste_status AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_contador_restrito()));
CREATE FUNCTION public.clinica_wa_teste_status(p_instancia text,p_id_externo text,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
 IF p_status NOT IN ('entregue','lida','erro') THEN RETURN; END IF;
 SELECT tenant_id INTO v_tenant FROM public.wa_config WHERE instancia = p_instancia;
 IF v_tenant IS NULL THEN RETURN; END IF;
 INSERT INTO public.clinica_wa_teste_status(tenant_id,id_externo,status) VALUES (v_tenant,p_id_externo,p_status) ON CONFLICT DO NOTHING;
 UPDATE public.clinica_wa_testes t SET situacao = CASE
 WHEN EXISTS(SELECT 1 FROM public.clinica_wa_teste_status s WHERE s.tenant_id=t.tenant_id AND s.id_externo=t.id_externo AND s.status='lida') THEN 'lida'
 WHEN EXISTS(SELECT 1 FROM public.clinica_wa_teste_status s WHERE s.tenant_id=t.tenant_id AND s.id_externo=t.id_externo AND s.status='entregue') THEN 'entregue'
 ELSE 'falhou' END, updated_at=now()
 WHERE t.tenant_id=v_tenant AND t.id_externo=p_id_externo;
END $$;
REVOKE ALL ON FUNCTION public.clinica_wa_teste_status(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinica_wa_teste_status(text,text,text) TO service_role;