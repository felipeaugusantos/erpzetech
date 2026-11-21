CREATE TABLE public.wa_assistente_preferencias (
 tenant_id uuid PRIMARY KEY REFERENCES public.empresas(id),
 nome text NOT NULL DEFAULT 'Assistente',
 boas_vindas text NOT NULL DEFAULT 'Olá! Como podemos ajudar?',
 responsavel_numero text NOT NULL DEFAULT '',
 orcamentos boolean NOT NULL DEFAULT true,
 agendamentos boolean NOT NULL DEFAULT true,
 atualizado_em timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT wa_assistente_nome CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
 CONSTRAINT wa_assistente_mensagem CHECK (length(btrim(boas_vindas)) BETWEEN 1 AND 1000),
 CONSTRAINT wa_assistente_numero CHECK (responsavel_numero = '' OR responsavel_numero ~ '^[0-9]{10,15}$')
);
GRANT ALL ON public.wa_assistente_preferencias TO service_role;
ALTER TABLE public.wa_assistente_preferencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.wa_assistente_preferencias AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.eh_salao_restrito()) WITH CHECK (NOT public.eh_salao_restrito());

CREATE FUNCTION public.wa_assistente_preferencias_ler() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); r jsonb;
BEGIN
 PERFORM public.exige_nao_contador(); PERFORM public.exige_nao_salao(); PERFORM public.exige_papel(ARRAY['administrador','gestor']);
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
 SELECT jsonb_build_object('nome',nome,'boas_vindas',boas_vindas,'responsavel_numero',responsavel_numero,'orcamentos',orcamentos,'agendamentos',agendamentos) INTO r FROM public.wa_assistente_preferencias WHERE tenant_id=v_tenant;
 RETURN coalesce(r,jsonb_build_object('nome','Assistente','boas_vindas','Olá! Como podemos ajudar?','responsavel_numero','','orcamentos',true,'agendamentos',true));
END $$;
REVOKE ALL ON FUNCTION public.wa_assistente_preferencias_ler() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_assistente_preferencias_ler() TO authenticated;

CREATE FUNCTION public.wa_assistente_preferencias_salvar(p_dados jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
 PERFORM public.exige_nao_contador(); PERFORM public.exige_nao_salao(); PERFORM public.exige_papel(ARRAY['administrador','gestor']);
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
 IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' OR (p_dados - ARRAY['nome','boas_vindas','responsavel_numero','orcamentos','agendamentos']) <> '{}'::jsonb THEN RAISE EXCEPTION 'Preferências inválidas'; END IF;
 IF jsonb_typeof(p_dados->'nome') IS DISTINCT FROM 'string' OR jsonb_typeof(p_dados->'boas_vindas') IS DISTINCT FROM 'string' OR jsonb_typeof(p_dados->'responsavel_numero') IS DISTINCT FROM 'string' OR jsonb_typeof(p_dados->'orcamentos') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_dados->'agendamentos') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Preencha as preferências'; END IF;
 INSERT INTO public.wa_assistente_preferencias (tenant_id,nome,boas_vindas,responsavel_numero,orcamentos,agendamentos)
 VALUES(v_tenant,btrim(p_dados->>'nome'),btrim(p_dados->>'boas_vindas'),p_dados->>'responsavel_numero',(p_dados->>'orcamentos')::boolean,(p_dados->>'agendamentos')::boolean)
 ON CONFLICT(tenant_id) DO UPDATE SET nome=EXCLUDED.nome,boas_vindas=EXCLUDED.boas_vindas,responsavel_numero=EXCLUDED.responsavel_numero,orcamentos=EXCLUDED.orcamentos,agendamentos=EXCLUDED.agendamentos,atualizado_em=now();
END $$;
REVOKE ALL ON FUNCTION public.wa_assistente_preferencias_salvar(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_assistente_preferencias_salvar(jsonb) TO authenticated;