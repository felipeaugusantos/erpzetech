ALTER TABLE public.pet_vacinacoes DROP CONSTRAINT pet_vacinacoes_check1;
ALTER TABLE public.pet_vacinacoes ADD CONSTRAINT pet_vacinacoes_check1 CHECK (origem <> 'clinica' OR (agendamento_id IS NOT NULL AND veterinario_id IS NOT NULL AND lote IS NOT NULL AND (estoque_lote_id IS NOT NULL OR validade_lote IS NOT NULL)));

CREATE OR REPLACE FUNCTION public.clinica_vacina_aplicar(p_agendamento_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ag public.pet_agendamentos%ROWTYPE;
  c public.pet_vacinas_catalogo%ROWTYPE;
  pt public.pets%ROWTYPE;
  l public.estoque_lotes%ROWTYPE;
  v_cat uuid := nullif(p_dados ->> 'catalogo_id', '')::uuid;
  v_lote uuid := nullif(p_dados ->> 'estoque_lote_id', '')::uuid;
  v_aplicador uuid := nullif(p_dados ->> 'aplicador_id', '')::uuid;
  v_em date := coalesce(nullif(p_dados ->> 'aplicada_em', '')::date, v_hoje);
  v_lote_texto text;
  v_validade date;
  v_prox date;
  v_dose jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_id uuid;
  v_idade integer;
BEGIN
  PERFORM public.exige_nao_contador();
  SELECT * INTO ag FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant AND profissional_id = v_vet FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado na sua agenda'; END IF;
  IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN
    RAISE EXCEPTION 'Este atendimento está "%": não dá para registrar vacina', ag.situacao;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id WHERE i.agendamento_id = ag.id AND s.categoria = 'vacina') THEN
    RAISE EXCEPTION 'Este agendamento não tem serviço de vacina';
  END IF;
  IF v_em > v_hoje THEN RAISE EXCEPTION 'A aplicação não pode ser no futuro'; END IF;
  IF v_em < v_hoje - 7 THEN RAISE EXCEPTION 'Para vacina de outra data use o registro de vacina aplicada em outro local'; END IF;
  SELECT * INTO c FROM public.pet_vacinas_catalogo WHERE id = v_cat AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha a vacina ou o vermífugo do catálogo'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = ag.pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF c.especie <> 'todas' AND c.especie <> pt.especie THEN RAISE EXCEPTION '% não é indicada para esta espécie', c.nome; END IF;
  IF v_aplicador IS NOT NULL THEN
    PERFORM 1 FROM public.pet_profissionais WHERE id = v_aplicador AND tenant_id = v_tenant AND ativo AND funcao IN ('veterinario', 'auxiliar');
    IF NOT FOUND THEN RAISE EXCEPTION 'Aplicador não encontrado (veterinário ou auxiliar ativo)'; END IF;
  END IF;
  -- Compatibilidade com aplicações e operações offline que já usavam estoque.
  IF v_lote IS NOT NULL THEN
    SELECT * INTO l FROM public.estoque_lotes WHERE id = v_lote AND tenant_id = v_tenant AND produto_id = c.produto_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um lote deste produto'; END IF;
    IF l.validade IS NULL THEN RAISE EXCEPTION 'O lote % não tem validade registrada: corrija o lote no estoque', l.lote; END IF;
    PERFORM 1 FROM public.depositos d WHERE d.id = l.deposito_id AND d.tenant_id = v_tenant AND public.pode_filial(d.filial_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'O lote % está em depósito de outra filial', l.lote; END IF;
    IF l.quantidade < 1 THEN RAISE EXCEPTION 'O lote % não tem saldo', l.lote; END IF;
    v_lote_texto := l.lote;
    v_validade := l.validade;
  ELSE
    v_lote_texto := nullif(btrim(coalesce(p_dados ->> 'lote', '')), '');
    IF v_lote_texto IS NULL THEN RAISE EXCEPTION 'Informe o lote da vacina'; END IF;
    IF length(v_lote_texto) > 120 THEN RAISE EXCEPTION 'O lote deve ter até 120 caracteres'; END IF;
    BEGIN
      v_validade := nullif(btrim(coalesce(p_dados ->> 'validade_lote', '')), '')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Vencimento do lote inválido';
    END;
    IF v_validade IS NULL THEN RAISE EXCEPTION 'Informe o vencimento do lote'; END IF;
  END IF;
  IF v_validade < v_em THEN RAISE EXCEPTION 'O lote % está vencido na data da aplicação', v_lote_texto; END IF;
  v_dose := public._clinica_proxima_dose(pt.id, c.id);
  IF v_dose ->> 'dose_tipo' = 'serie' AND (v_dose ->> 'dose_numero')::int < c.doses_serie THEN v_prox := v_em + c.intervalo_serie_dias;
  ELSE v_prox := v_em + c.reforco_dias; END IF;
  IF p_dados ? 'proxima_dose_em' THEN
    BEGIN
      v_prox := nullif(btrim(coalesce(p_dados ->> 'proxima_dose_em', '')), '')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Data da próxima dose inválida';
    END;
    IF v_prox IS NOT NULL AND v_prox <= v_em THEN RAISE EXCEPTION 'A próxima dose precisa ser depois da aplicação'; END IF;
  END IF;
  IF c.idade_minima_dias IS NOT NULL AND pt.nascimento IS NOT NULL THEN
    v_idade := v_em - pt.nascimento;
    IF v_idade < c.idade_minima_dias THEN
      v_avisos := v_avisos || to_jsonb(format('O pet tem %s dias e a idade mínima do item é %s dias: confirme a indicação.', v_idade, c.idade_minima_dias));
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_vacinacoes v WHERE v.pet_id = pt.id AND v.catalogo_id = c.id AND v.situacao = 'ativa' AND v.aplicada_em = v_em) THEN
    v_avisos := v_avisos || to_jsonb('Já existe uma aplicação deste item para o pet nesta data.'::text);
  END IF;
  IF v_lote IS NOT NULL THEN
    UPDATE public.estoque_lotes SET quantidade = quantidade - 1, updated_at = now() WHERE id = l.id;
    INSERT INTO public.estoque_lote_movimentos (tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
    VALUES (v_tenant, l.id, 'saida', 1, l.quantidade - 1, 'Vacinação ' || pt.nome, 'Aplicação na clínica');
    PERFORM public._clinica_movimentar_dose(c.produto_id, l.deposito_id, 'saida'::public.mov_tipo, 'Aplicação na clínica', 'Vacinação ' || pt.nome);
  END IF;
  INSERT INTO public.pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em,
    agendamento_id, veterinario_id, aplicador_id, estoque_lote_id, deposito_id, lote, validade_lote, local_aplicacao, observacoes)
  VALUES (v_tenant, pt.id, c.id, c.nome, c.tipo, 'clinica', v_dose ->> 'dose_tipo', (v_dose ->> 'dose_numero')::int, v_em, v_prox,
    ag.id, v_vet, coalesce(v_aplicador, v_vet), l.id, l.deposito_id, v_lote_texto, v_validade,
    nullif(btrim(coalesce(p_dados ->> 'local_aplicacao', '')), ''), nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''))
  RETURNING id INTO v_id;
  IF ag.situacao <> 'em_atendimento' THEN UPDATE public.pet_agendamentos SET situacao = 'em_atendimento' WHERE id = ag.id; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'vacinacao');
  RETURN jsonb_build_object('id', v_id, 'dose_tipo', v_dose ->> 'dose_tipo', 'dose_numero', (v_dose ->> 'dose_numero')::int,
    'proxima_dose_em', v_prox, 'avisos', v_avisos);
END $function$;
REVOKE ALL ON FUNCTION public.clinica_vacina_aplicar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_aplicar(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_vacina_cancelar(p_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  a public.pet_vacinacoes%ROWTYPE;
  l public.estoque_lotes%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_contador();
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO a FROM public.pet_vacinacoes WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aplicação não encontrada'; END IF;
  IF a.situacao <> 'ativa' THEN RAISE EXCEPTION 'Esta aplicação já está cancelada'; END IF;
  IF a.origem = 'clinica' AND a.estoque_lote_id IS NOT NULL THEN
    SELECT * INTO l FROM public.estoque_lotes WHERE id = a.estoque_lote_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lote da aplicação não encontrado'; END IF;
    UPDATE public.estoque_lotes SET quantidade = quantidade + 1, updated_at = now() WHERE id = l.id;
    INSERT INTO public.estoque_lote_movimentos (tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
    VALUES (v_tenant, l.id, 'entrada', 1, l.quantidade + 1, 'Cancelamento de vacinação', v_motivo);
    PERFORM public._clinica_movimentar_dose(l.produto_id, a.deposito_id, 'entrada'::public.mov_tipo, 'Cancelamento de vacinação: ' || v_motivo, 'Cancelamento de vacinação');
  END IF;
  UPDATE public.pet_vacinacoes SET situacao = 'cancelada', cancelada_em = now(), cancelada_motivo = v_motivo, cancelada_por = auth.uid() WHERE id = a.id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, a.pet_id, 'vacinacao');
END $function$;
REVOKE ALL ON FUNCTION public.clinica_vacina_cancelar(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_cancelar(uuid,text) TO authenticated;