CREATE OR REPLACE FUNCTION public._sngpc_exige_periodo_livre(p_data date)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE e record;
BEGIN
  SELECT * INTO e FROM public.sngpc_envios
   WHERE tenant_id = public.current_tenant_id() AND tipo = 'movimentacao' AND situacao <> 'cancelado' AND p_data BETWEEN inicio AND fim LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Há um arquivo % do SNGPC cobrindo % (de % a %): %',
      CASE e.situacao WHEN 'transmitido' THEN 'transmitido' ELSE 'gerado' END, to_char(p_data, 'DD/MM/YYYY'), to_char(e.inicio, 'DD/MM/YYYY'), to_char(e.fim, 'DD/MM/YYYY'),
      CASE e.situacao WHEN 'transmitido' THEN 'o livro dessa data está fechado' ELSE 'cancele o arquivo gerado para alterar o livro e gere de novo' END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._sngpc_exige_periodo_livre(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sngpc_assinatura(p_inicio date, p_fim date)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT md5(coalesce(string_agg(d.id::text || ':' || (d.cancelado_em IS NOT NULL)::text, ',' ORDER BY d.id), ''))
    FROM public.sngpc_documentos d
   WHERE d.tenant_id = public.current_tenant_id() AND d.tipo <> 'saldo_inicial' AND d.data BETWEEN p_inicio AND p_fim
$$;
REVOKE ALL ON FUNCTION public._sngpc_assinatura(date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_prescrever(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  i public.pet_internacoes;
  v_med text := btrim(coalesce(p_dados ->> 'medicamento', ''));
  v_dose text := btrim(coalesce(p_dados ->> 'dose', ''));
  v_via text := nullif(btrim(coalesce(p_dados ->> 'via', '')), '');
  v_freq integer := nullif(p_dados ->> 'frequencia_horas', '')::integer;
  v_dias integer := nullif(p_dados ->> 'dias', '')::integer;
  v_ini timestamptz := coalesce(nullif(p_dados ->> 'inicio', '')::timestamptz, now());
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  v_n integer;
  v_id uuid;
BEGIN
  IF v_med = '' OR length(v_med) > 120 THEN RAISE EXCEPTION 'Informe o medicamento (até 120 letras)'; END IF;
  IF v_dose = '' OR length(v_dose) > 80 THEN RAISE EXCEPTION 'Informe a dose (até 80 letras)'; END IF;
  IF v_via IS NOT NULL AND length(v_via) > 40 THEN RAISE EXCEPTION 'A via aceita até 40 letras'; END IF;
  IF v_obs IS NOT NULL AND length(v_obs) > 300 THEN RAISE EXCEPTION 'A observação aceita até 300 letras'; END IF;
  IF (v_freq IS NULL) <> (v_dias IS NULL) THEN
    RAISE EXCEPTION 'Informe a frequência e a duração, ou deixe as duas vazias para dose única';
  END IF;
  IF v_freq IS NOT NULL AND (v_freq NOT BETWEEN 1 AND 48 OR v_dias NOT BETWEEN 1 AND 14) THEN
    RAISE EXCEPTION 'A frequência vai de 1 a 48 horas e a duração de 1 a 14 dias';
  END IF;
  i := public._internacao_aberta(p_id);
  IF v_ini < i.admitido_em THEN RAISE EXCEPTION 'O início não pode ser anterior à admissão'; END IF;
  IF v_ini > now() + interval '24 hours' THEN RAISE EXCEPTION 'O início pode ser até 24 horas à frente'; END IF;
  v_n := CASE WHEN v_freq IS NULL THEN 1 ELSE greatest(1, ceil(v_dias * 24.0 / v_freq))::integer END;

  INSERT INTO public.pet_internacao_prescricoes (tenant_id, internacao_id, veterinario_id, crmv, crmv_uf, medicamento, dose, via, frequencia_horas, dias, inicio, observacao)
  VALUES (i.tenant_id, i.id, (a ->> 'id')::uuid, a ->> 'crmv', a ->> 'crmv_uf', v_med, v_dose, v_via, v_freq, v_dias, v_ini, v_obs)
  RETURNING id INTO v_id;
  INSERT INTO public.pet_internacao_execucoes (tenant_id, prescricao_id, internacao_id, previsto_em)
  SELECT i.tenant_id, v_id, i.id, v_ini + (g * coalesce(v_freq, 0)) * interval '1 hour' FROM generate_series(0, v_n - 1) g;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_prescrever(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_prescrever(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_registrar(p_tipo text, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  v_tenant uuid := public.current_tenant_id();
  v_data date := coalesce(nullif(p_dados ->> 'data', '')::date, current_date);
  v_fechado date;
  v_id uuid;
  v_pet uuid := nullif(p_dados ->> 'pet_id', '')::uuid;
  v_pac_nome text := nullif(btrim(coalesce(p_dados ->> 'paciente_nome', '')), '');
  it jsonb;
  v_med uuid; v_lote text; v_qtd integer; v_val date;
  r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sngpc_livro:' || public.current_tenant_id()::text, 0));
  v_fechado := public._sngpc_fechado_ate();
  IF p_tipo NOT IN ('saldo_inicial', 'entrada', 'venda', 'perda') THEN RAISE EXCEPTION 'Tipo de lançamento inválido'; END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'A data não pode ser futura'; END IF;
  IF v_fechado IS NOT NULL AND v_data <= v_fechado THEN
    RAISE EXCEPTION 'O período até % já foi transmitido ao SNGPC: lance com data posterior', to_char(v_fechado, 'DD/MM/YYYY');
  END IF;
  IF jsonb_typeof(p_dados -> 'itens') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'itens') NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Informe de 1 a 30 itens (medicamento, lote e quantidade)';
  END IF;
  PERFORM public._sngpc_exige_periodo_livre(v_data);
  IF v_pet IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Animal não encontrado'; END IF;
  IF p_tipo = 'venda' AND v_pac_nome IS NULL AND v_pet IS NOT NULL THEN
    RAISE EXCEPTION 'Informe os dados do animal (nome, idade, sexo)';
  END IF;

  INSERT INTO public.sngpc_documentos (tenant_id, tipo, data, registrado_nome, observacao,
      nf_numero, nf_data, cnpj_origem,
      tipo_receituario, numero_notificacao, data_prescricao, prescritor_nome, prescritor_registro, prescritor_uf,
      comprador_nome, comprador_tipo_documento, comprador_documento, comprador_orgao, comprador_uf,
      pet_id, paciente_nome, paciente_idade, paciente_unidade_idade, paciente_sexo, motivo_perda)
  VALUES (v_tenant, p_tipo, v_data, a, nullif(btrim(coalesce(p_dados ->> 'observacao', '')), ''),
      CASE WHEN p_tipo = 'entrada' THEN nullif(p_dados ->> 'nf_numero', '')::bigint END,
      CASE WHEN p_tipo = 'entrada' THEN nullif(p_dados ->> 'nf_data', '')::date END,
      CASE WHEN p_tipo = 'entrada' THEN regexp_replace(coalesce(p_dados ->> 'cnpj_origem', ''), '\D', '', 'g') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(p_dados ->> 'tipo_receituario', '')::smallint END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'numero_notificacao', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(p_dados ->> 'data_prescricao', '')::date END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'prescritor_nome', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(upper(regexp_replace(coalesce(p_dados ->> 'prescritor_registro', ''), '[^0-9A-Za-z]', '', 'g')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(upper(btrim(coalesce(p_dados ->> 'prescritor_uf', ''))), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'comprador_nome', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(p_dados ->> 'comprador_tipo_documento', '')::smallint END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'comprador_documento', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'comprador_orgao', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(upper(btrim(coalesce(p_dados ->> 'comprador_uf', ''))), '') END,
      CASE WHEN p_tipo = 'venda' THEN v_pet END,
      CASE WHEN p_tipo = 'venda' THEN v_pac_nome END,
      CASE WHEN p_tipo = 'venda' AND v_pac_nome IS NOT NULL THEN nullif(p_dados ->> 'paciente_idade', '')::integer END,
      CASE WHEN p_tipo = 'venda' AND v_pac_nome IS NOT NULL THEN nullif(p_dados ->> 'paciente_unidade_idade', '')::smallint END,
      CASE WHEN p_tipo = 'venda' AND v_pac_nome IS NOT NULL THEN nullif(p_dados ->> 'paciente_sexo', '')::smallint END,
      CASE WHEN p_tipo = 'perda' THEN nullif(p_dados ->> 'motivo_perda', '')::smallint END)
  RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_dados -> 'itens') LOOP
    v_med := nullif(it ->> 'medicamento_id', '')::uuid;
    v_lote := upper(btrim(coalesce(it ->> 'lote', '')));
    v_qtd := nullif(it ->> 'quantidade', '')::integer;
    v_val := nullif(it ->> 'validade', '')::date;
    IF v_med IS NULL OR NOT EXISTS (SELECT 1 FROM public.sngpc_medicamentos WHERE id = v_med AND tenant_id = v_tenant AND (ativo OR p_tipo = 'perda')) THEN
      RAISE EXCEPTION 'Medicamento controlado não encontrado ou inativo';
    END IF;
    IF v_lote !~ '^[A-Z0-9._/-]{1,20}$' THEN RAISE EXCEPTION 'Informe o lote (letras, números, ponto, barra ou hífen; até 20)'; END IF;
    IF v_qtd IS NULL OR v_qtd NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'A quantidade vai de 1 a 999'; END IF;
    INSERT INTO public.sngpc_itens (tenant_id, documento_id, medicamento_id, lote, validade, quantidade)
    VALUES (v_tenant, v_id, v_med, v_lote, CASE WHEN p_tipo IN ('entrada', 'saldo_inicial') THEN v_val END, v_qtd);
  END LOOP;

  FOR r IN SELECT DISTINCT medicamento_id, lote FROM public.sngpc_itens WHERE documento_id = v_id LOOP
    IF NOT public._sngpc_lote_ok(r.medicamento_id, r.lote) THEN
      RAISE EXCEPTION 'Saldo insuficiente: o lote % ficaria negativo', r.lote;
    END IF;
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_registrar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_registrar(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  d public.sngpc_documentos;
  v_fechado date;
  r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sngpc_livro:' || public.current_tenant_id()::text, 0));
  v_fechado := public._sngpc_fechado_ate();
  IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO d FROM public.sngpc_documentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  IF d.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Lançamento já cancelado'; END IF;
  IF v_fechado IS NOT NULL AND d.data <= v_fechado THEN
    RAISE EXCEPTION 'O período deste lançamento já foi transmitido ao SNGPC: não dá para cancelar';
  END IF;
  PERFORM public._sngpc_exige_periodo_livre(d.data);
  UPDATE public.sngpc_documentos SET cancelado_em = now(), cancelado_por_nome = a, cancelado_motivo = btrim(p_motivo) WHERE id = d.id;
  FOR r IN SELECT DISTINCT medicamento_id, lote FROM public.sngpc_itens WHERE documento_id = d.id LOOP
    IF NOT public._sngpc_lote_ok(r.medicamento_id, r.lote) THEN
      RAISE EXCEPTION 'Não dá para cancelar: o lote % ficaria com saldo negativo em alguma data', r.lote;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_cancelar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_livro(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  RETURN jsonb_build_object('fechado_ate', public._sngpc_fechado_ate(), 'periodos_travados', coalesce((SELECT jsonb_agg(jsonb_build_object('inicio', e.inicio, 'fim', e.fim, 'situacao', e.situacao) ORDER BY e.inicio) FROM public.sngpc_envios e WHERE e.tenant_id = public.current_tenant_id() AND e.tipo = 'movimentacao' AND e.situacao <> 'cancelado'), '[]'::jsonb), 'documentos', coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'data') DESC, (x ->> 'created_at') DESC)
      FROM (
        SELECT jsonb_build_object('id', d.id, 'tipo', d.tipo, 'data', d.data, 'created_at', d.created_at, 'registrado_nome', d.registrado_nome,
                 'observacao', d.observacao, 'nf_numero', d.nf_numero, 'nf_data', d.nf_data, 'cnpj_origem', d.cnpj_origem,
                 'tipo_receituario', d.tipo_receituario, 'numero_notificacao', d.numero_notificacao, 'data_prescricao', d.data_prescricao,
                 'prescritor_nome', d.prescritor_nome, 'prescritor_registro', d.prescritor_registro, 'prescritor_uf', d.prescritor_uf,
                 'comprador_nome', d.comprador_nome, 'paciente_nome', d.paciente_nome, 'motivo_perda', d.motivo_perda,
                 'cancelado_em', d.cancelado_em, 'cancelado_por_nome', d.cancelado_por_nome, 'cancelado_motivo', d.cancelado_motivo,
                 'itens', (SELECT jsonb_agg(jsonb_build_object('produto', p.descricao, 'lote', i.lote, 'validade', i.validade, 'quantidade', i.quantidade,
                                   'unidade_medida', m.unidade_medida) ORDER BY i.created_at)
                             FROM public.sngpc_itens i JOIN public.sngpc_medicamentos m ON m.id = i.medicamento_id JOIN public.produtos p ON p.id = m.produto_id
                            WHERE i.documento_id = d.id)) AS x
          FROM public.sngpc_documentos d
         WHERE d.tenant_id = public.current_tenant_id() AND (p_inicio IS NULL OR d.data >= p_inicio) AND (p_fim IS NULL OR d.data <= p_fim)
         ORDER BY d.data DESC, d.created_at DESC LIMIT 300
      ) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.sngpc_livro(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_livro(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_periodo(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN RAISE EXCEPTION 'Informe o período (início e fim)'; END IF;
  IF p_fim > current_date THEN RAISE EXCEPTION 'O período não pode terminar no futuro'; END IF;
  IF p_fim - p_inicio > 30 THEN RAISE EXCEPTION 'O período pode ter até 31 dias'; END IF;
  RETURN jsonb_build_object('cnpj', public._sngpc_cnpj(), 'inicio', p_inicio, 'fim', p_fim, 'assinatura', public._sngpc_assinatura(p_inicio, p_fim), 'documentos', coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'data'), (x ->> 'created_at'))
      FROM (
        SELECT jsonb_build_object('id', d.id, 'tipo', d.tipo, 'data', d.data, 'created_at', d.created_at,
                 'nf_numero', d.nf_numero, 'nf_data', d.nf_data, 'cnpj_origem', d.cnpj_origem,
                 'tipo_receituario', d.tipo_receituario, 'numero_notificacao', d.numero_notificacao, 'data_prescricao', d.data_prescricao,
                 'prescritor_nome', d.prescritor_nome, 'prescritor_registro', d.prescritor_registro, 'prescritor_uf', d.prescritor_uf,
                 'comprador_nome', d.comprador_nome, 'comprador_tipo_documento', d.comprador_tipo_documento, 'comprador_documento', d.comprador_documento,
                 'comprador_orgao', d.comprador_orgao, 'comprador_uf', d.comprador_uf,
                 'paciente_nome', d.paciente_nome, 'paciente_idade', d.paciente_idade, 'paciente_unidade_idade', d.paciente_unidade_idade,
                 'paciente_sexo', d.paciente_sexo, 'motivo_perda', d.motivo_perda,
                 'itens', (SELECT jsonb_agg(jsonb_build_object('registro_ms', m.registro_ms, 'lote', i.lote, 'quantidade', i.quantidade,
                                   'unidade_medida', m.unidade_medida) ORDER BY i.created_at)
                             FROM public.sngpc_itens i JOIN public.sngpc_medicamentos m ON m.id = i.medicamento_id WHERE i.documento_id = d.id)) AS x
          FROM public.sngpc_documentos d
         WHERE d.tenant_id = public.current_tenant_id() AND d.cancelado_em IS NULL AND d.tipo <> 'saldo_inicial' AND d.data BETWEEN p_inicio AND p_fim
      ) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.sngpc_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_periodo(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_inventario(p_data date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  IF p_data IS NULL OR p_data > current_date OR p_data < current_date - 7 THEN RAISE EXCEPTION 'A data do inventário vai de 7 dias atrás até hoje'; END IF;
  RETURN jsonb_build_object('cnpj', public._sngpc_cnpj(), 'data', p_data, 'assinatura', md5(public.sngpc_saldo(p_data)::text), 'itens', coalesce((
    SELECT jsonb_agg(jsonb_build_object('registro_ms', s ->> 'registro_ms', 'lote', s ->> 'lote', 'quantidade', (s ->> 'saldo')::integer,
                     'unidade_medida', (s ->> 'unidade_medida')::integer))
      FROM jsonb_array_elements(public.sngpc_saldo(p_data)) s), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.sngpc_inventario(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_inventario(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_envio_registrar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  v_tenant uuid := public.current_tenant_id();
  v_tipo text := coalesce(p_dados ->> 'tipo', '');
  v_ini date := nullif(p_dados ->> 'inicio', '')::date;
  v_fim date := nullif(p_dados ->> 'fim', '')::date;
  v_resp uuid := nullif(p_dados ->> 'farmaceutico_id', '')::uuid;
  v_xml text := coalesce(p_dados ->> 'xml', '');
  v_assinatura text := coalesce(p_dados ->> 'assinatura', '');
  v_esperada text;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sngpc_livro:' || v_tenant::text, 0));
  IF v_tipo NOT IN ('movimentacao', 'inventario') THEN RAISE EXCEPTION 'Tipo de envio inválido'; END IF;
  IF v_ini IS NULL OR v_fim IS NULL OR v_ini > v_fim THEN RAISE EXCEPTION 'Informe o período'; END IF;
  IF v_fim > current_date THEN RAISE EXCEPTION 'O período não pode terminar no futuro'; END IF;
  IF v_xml NOT LIKE '<?xml%' OR length(v_xml) < 50 THEN RAISE EXCEPTION 'Arquivo XML inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_profissionais WHERE id = v_resp AND tenant_id = v_tenant AND ativo AND funcao = 'farmaceutico' AND public._cpf_valido(cpf)) THEN
    RAISE EXCEPTION 'Escolha o farmacêutico responsável (ativo, com CRF e CPF válido)';
  END IF;
  IF v_tipo = 'movimentacao' THEN
    IF v_fim - v_ini > 30 THEN RAISE EXCEPTION 'O período pode ter até 31 dias'; END IF;
    IF EXISTS (SELECT 1 FROM public.sngpc_envios WHERE tenant_id = v_tenant AND tipo = 'movimentacao' AND situacao <> 'cancelado' AND daterange(inicio, fim, '[]') && daterange(v_ini, v_fim, '[]')) THEN
      RAISE EXCEPTION 'Já existe um arquivo gerado ou transmitido que cobre parte deste período: cancele o arquivo gerado ou escolha outro período';
    END IF;
  ELSE
    IF v_ini <> v_fim OR v_fim < current_date - 7 THEN RAISE EXCEPTION 'A data do inventário vai de 7 dias atrás até hoje'; END IF;
  END IF;
  v_esperada := CASE WHEN v_tipo = 'movimentacao' THEN public._sngpc_assinatura(v_ini, v_fim) ELSE md5(public.sngpc_saldo(v_fim)::text) END;
  IF v_assinatura <> v_esperada THEN
    RAISE EXCEPTION 'O livro mudou depois que o arquivo foi montado: monte o arquivo de novo';
  END IF;
  INSERT INTO public.sngpc_envios (tenant_id, tipo, inicio, fim, farmaceutico_id, xml, sha256, gerado_por_nome)
  VALUES (v_tenant, v_tipo, v_ini, v_fim, v_resp, v_xml, encode(sha256(convert_to(v_xml, 'UTF8')), 'hex'), a)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_envio_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_envio_registrar(jsonb) TO authenticated;