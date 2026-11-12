CREATE TABLE public.pet_exame_agenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  veterinario_id uuid REFERENCES public.pet_profissionais(id) ON DELETE SET NULL,
  exame text NOT NULL CHECK (length(btrim(exame)) BETWEEN 2 AND 160),
  agendado_para timestamptz NOT NULL,
  situacao text NOT NULL DEFAULT 'agendado' CHECK (situacao IN ('agendado','coletado','resultado','cancelado','faltou')),
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 1000),
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pet_exame_agenda_tenant_data ON public.pet_exame_agenda (tenant_id, agendado_para);
GRANT ALL ON public.pet_exame_agenda TO service_role;
ALTER TABLE public.pet_exame_agenda ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.pet_exame_agenda AS RESTRICTIVE TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.clinica_exame_agenda(p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public._clinica_vet();
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 92 THEN
    RAISE EXCEPTION 'Período inválido (até 92 dias)'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'pet_id', a.pet_id, 'pet', p.nome, 'tutor', c.nome,
             'exame', a.exame, 'agendado_para', a.agendado_para, 'situacao', a.situacao,
             'observacao', a.observacao, 'veterinario', v.nome) ORDER BY a.agendado_para)
      FROM public.pet_exame_agenda a
      JOIN public.pets p ON p.id = a.pet_id
      LEFT JOIN public.clientes c ON c.id = p.cliente_id
      LEFT JOIN public.pet_profissionais v ON v.id = a.veterinario_id
     WHERE a.tenant_id = v_tenant
       AND (a.agendado_para AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.clinica_exame_agendar(p_dados jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_vet uuid; v_id uuid; v_pet uuid := (p_dados->>'pet_id')::uuid;
BEGIN
  PERFORM public.exige_nao_contador();
  v_vet := public._clinica_vet();
  IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  INSERT INTO public.pet_exame_agenda (tenant_id, pet_id, veterinario_id, exame, agendado_para, observacao)
  VALUES (v_tenant, v_pet, v_vet, btrim(p_dados->>'exame'), (p_dados->>'agendado_para')::timestamptz,
          nullif(btrim(coalesce(p_dados->>'observacao','')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.clinica_exame_agenda_situacao(p_id uuid, p_situacao text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public._clinica_vet();
  IF p_situacao NOT IN ('agendado','coletado','resultado','cancelado','faltou') THEN
    RAISE EXCEPTION 'Situação inválida'; END IF;
  UPDATE public.pet_exame_agenda SET situacao = p_situacao, updated_at = now()
   WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.clinica_receitas(p_de date, p_ate date, p_pet_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public._clinica_vet();
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 366 THEN
    RAISE EXCEPTION 'Período inválido (até 366 dias)'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', d.id, 'ano', d.ano, 'numero', d.numero, 'titulo', d.titulo,
             'situacao', d.situacao, 'emitido_em', d.emitido_em, 'pet_id', d.pet_id, 'pet', p.nome,
             'tutor', c.nome, 'veterinario', v.nome, 'itens', d.itens) ORDER BY d.emitido_em DESC)
      FROM public.pet_documentos d
      JOIN public.pets p ON p.id = d.pet_id
      LEFT JOIN public.clientes c ON c.id = p.cliente_id
      LEFT JOIN public.pet_profissionais v ON v.id = d.veterinario_id
     WHERE d.tenant_id = v_tenant AND d.tipo = 'receita'
       AND (p_pet_id IS NULL OR d.pet_id = p_pet_id)
       AND (d.emitido_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.clinica_exame_agenda(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clinica_exame_agendar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clinica_exame_agenda_situacao(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clinica_receitas(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_agenda(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clinica_exame_agendar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clinica_exame_agenda_situacao(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clinica_receitas(date, date, uuid) TO authenticated;