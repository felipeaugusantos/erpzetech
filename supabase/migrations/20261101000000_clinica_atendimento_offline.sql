-- Clínica (Fase 4, PR 5c): atendimento sem internet. A visita rural nasce sem consulta marcada: uma função única cria a consulta (já "em atendimento")
-- e o atendimento de uma vez, com o identificador que nasceu no notebook; consulta já marcada na agenda do veterinário também abre com o id do
-- notebook. Preencher e fechar passam por uma função que aceita repetição: cada operação da fila leva uma chave, e reenviar a mesma chave devolve
-- o mesmo resultado sem refazer nada (inclusive o fechamento, que por si só recusaria uma segunda vez). Atendimento fechado continua imutável.
-- A visita avulsa não passa pela regra de horário livre da agenda: o atendimento já aconteceu.

-- ============ chaves de repetição das operações feitas sem internet ============
CREATE TABLE IF NOT EXISTS public.clinica_operacoes_offline (
  chave uuid PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  profile_id uuid NOT NULL DEFAULT auth.uid(),
  tipo text NOT NULL,
  resultado jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clinica_operacoes_offline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinica_operacoes_offline FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinica_operacoes_offline TO service_role;
CREATE POLICY salao_restrito ON public.clinica_operacoes_offline AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- O resultado já guardado da chave (reenvio) ou nulo; a chave de outra empresa, de outro usuário ou de outro tipo de operação é recusada.
CREATE OR REPLACE FUNCTION public._clinica_op_repetida(p_chave uuid, p_tipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE o public.clinica_operacoes_offline%ROWTYPE;
BEGIN
  IF p_chave IS NULL THEN RAISE EXCEPTION 'Operação sem chave de repetição'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_op_offline:' || p_chave::text, 0));
  SELECT * INTO o FROM public.clinica_operacoes_offline WHERE chave = p_chave;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF o.tenant_id <> public.current_tenant_id() OR o.profile_id <> auth.uid() OR o.tipo <> p_tipo THEN RAISE EXCEPTION 'Chave de repetição já usada'; END IF;
  RETURN o.resultado || jsonb_build_object('repetido', true);
END $$;
REVOKE ALL ON FUNCTION public._clinica_op_repetida(uuid, text) FROM PUBLIC, anon, authenticated;

-- ============ registrar a visita (cria a consulta e o atendimento, ou abre a consulta marcada) ============
-- p_dados: atendimento_id (nasce no notebook), pet_id, aberto_em (hora do aparelho) e, ou agendamento_id (consulta já marcada deste veterinário),
-- ou servico_id (serviço de consulta, para a visita avulsa).
CREATE OR REPLACE FUNCTION public.clinica_visita_registrar(p_chave uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_rep jsonb;
  v_atend uuid;
  v_pet uuid;
  v_agend uuid;
  v_serv uuid;
  v_aberto timestamptz;
  pt public.pets%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  ag public.pet_agendamentos%ROWTYPE;
  sv public.pet_servicos%ROWTYPE;
  v_preco numeric;
  v_modo text;
  v_resultado jsonb;
BEGIN
  v_rep := public._clinica_op_repetida(p_chave, 'visita');
  IF v_rep IS NOT NULL THEN RETURN v_rep; END IF;
  BEGIN
    v_atend := nullif(btrim(coalesce(p_dados ->> 'atendimento_id', '')), '')::uuid;
    v_pet := nullif(btrim(coalesce(p_dados ->> 'pet_id', '')), '')::uuid;
    v_agend := nullif(btrim(coalesce(p_dados ->> 'agendamento_id', '')), '')::uuid;
    v_serv := nullif(btrim(coalesce(p_dados ->> 'servico_id', '')), '')::uuid;
    v_aberto := coalesce(nullif(btrim(coalesce(p_dados ->> 'aberto_em', '')), '')::timestamptz, now());
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira os identificadores e a hora do atendimento';
  END;
  IF v_atend IS NULL THEN RAISE EXCEPTION 'O atendimento precisa de um identificador'; END IF;
  IF v_pet IS NULL THEN RAISE EXCEPTION 'Informe o paciente'; END IF;
  IF (v_agend IS NULL) = (v_serv IS NULL) THEN RAISE EXCEPTION 'Informe a consulta marcada ou o serviço de consulta (só um dos dois)'; END IF;
  IF v_aberto > now() + interval '10 minutes' OR v_aberto < now() - interval '30 days' THEN
    RAISE EXCEPTION 'A hora do atendimento está fora do esperado (até 30 dias atrás, e não no futuro): confira o relógio do notebook';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_atendimentos_clinicos WHERE id = v_atend) THEN RAISE EXCEPTION 'Identificador do atendimento já usado'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = v_vet;

  IF v_agend IS NOT NULL THEN
    v_modo := 'consulta_marcada';
    SELECT * INTO ag FROM public.pet_agendamentos WHERE id = v_agend AND tenant_id = v_tenant AND profissional_id = v_vet FOR UPDATE;
    IF NOT FOUND OR ag.pet_id <> pt.id THEN RAISE EXCEPTION 'Consulta não encontrada na sua agenda para este paciente'; END IF;
    IF EXISTS (SELECT 1 FROM public.pet_atendimentos_clinicos WHERE agendamento_id = ag.id) THEN
      RAISE EXCEPTION 'Esta consulta já foi aberta em outro aparelho: o atendimento feito aqui fica guardado para conferência';
    END IF;
    IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN RAISE EXCEPTION 'Esta consulta está "%": não dá para abrir o prontuário', ag.situacao; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id WHERE i.agendamento_id = ag.id AND s.categoria = 'consulta') THEN
      RAISE EXCEPTION 'Este agendamento não tem serviço de consulta';
    END IF;
    IF ag.situacao <> 'em_atendimento' THEN UPDATE public.pet_agendamentos SET situacao = 'em_atendimento' WHERE id = ag.id; END IF;
  ELSE
    v_modo := 'visita_avulsa';
    SELECT * INTO sv FROM public.pet_servicos WHERE id = v_serv AND tenant_id = v_tenant AND ativo AND categoria = 'consulta';
    IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um serviço de consulta ativo'; END IF;
    -- o mesmo preço que a agenda calcularia (o veterinário é perfil restrito e não chama a função de preço da agenda)
    SELECT p.preco INTO v_preco FROM public.pet_servico_precos p
     WHERE p.servico_id = sv.id AND p.tenant_id = v_tenant
       AND (p.porte IS NULL OR p.porte = pt.porte)
       AND (p.raca IS NULL OR lower(btrim(p.raca)) = lower(btrim(coalesce(pt.raca, ''))))
       AND (p.pelagem IS NULL OR p.pelagem = pt.pelagem)
     ORDER BY (CASE WHEN p.raca IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.pelagem IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN p.porte IS NOT NULL THEN 1 ELSE 0 END) DESC
     LIMIT 1;
    IF v_preco IS NULL THEN RAISE EXCEPTION 'A consulta "%" não tem preço cadastrado para este paciente: peça à gestão e reenvie', sv.nome; END IF;
    INSERT INTO public.pet_agendamentos (tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao, observacoes)
    VALUES (v_tenant, pf.filial_id, pt.id, pt.cliente_id, v_vet, v_aberto, v_aberto + make_interval(mins => sv.duracao_min), 'em_atendimento',
            'Visita registrada pela clínica, sem consulta marcada')
    RETURNING id INTO v_agend;
    INSERT INTO public.pet_agendamento_itens (tenant_id, agendamento_id, servico_id, preco_aplicado, duracao_min)
    VALUES (v_tenant, v_agend, sv.id, round(v_preco, 2), sv.duracao_min);
  END IF;

  INSERT INTO public.pet_atendimentos_clinicos (id, tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf, aberto_em)
  VALUES (v_atend, v_tenant, pt.id, pt.cliente_id, v_agend, v_vet, pf.crmv, pf.crmv_uf, v_aberto);
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, pt.id, v_atend, 'atendimento');

  v_resultado := jsonb_build_object('atendimento_id', v_atend, 'agendamento_id', v_agend, 'modo', v_modo, 'repetido', false);
  INSERT INTO public.clinica_operacoes_offline (chave, tenant_id, tipo, resultado) VALUES (p_chave, v_tenant, 'visita', v_resultado - 'repetido');
  RETURN v_resultado;
END $$;
REVOKE ALL ON FUNCTION public.clinica_visita_registrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_visita_registrar(uuid, jsonb) TO authenticated;

-- ============ preencher e fechar o atendimento, aceitando repetição ============
CREATE OR REPLACE FUNCTION public.clinica_atendimento_offline(p_chave uuid, p_acao text, p_id uuid, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rep jsonb;
  r jsonb;
  v_resultado jsonb;
BEGIN
  PERFORM public._clinica_vet();
  IF p_acao IS NULL OR p_acao NOT IN ('salvar', 'fechar') THEN RAISE EXCEPTION 'Ação inválida: salvar ou fechar'; END IF;
  v_rep := public._clinica_op_repetida(p_chave, 'atendimento_' || p_acao);
  IF v_rep IS NOT NULL THEN RETURN v_rep; END IF;
  IF p_acao = 'salvar' THEN r := public.clinica_atendimento_salvar(p_id, coalesce(p_dados, '{}'::jsonb));
  ELSE r := public.clinica_atendimento_fechar(p_id); END IF;
  v_resultado := jsonb_build_object('atendimento_id', p_id, 'situacao', r ->> 'situacao');
  INSERT INTO public.clinica_operacoes_offline (chave, tenant_id, tipo, resultado) VALUES (p_chave, public.current_tenant_id(), 'atendimento_' || p_acao, v_resultado);
  RETURN v_resultado || jsonb_build_object('repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_offline(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_offline(uuid, text, uuid, jsonb) TO authenticated;

-- ============ a cópia da visita passa a levar os serviços de consulta ============
CREATE OR REPLACE FUNCTION public.clinica_visita_preparar(p_dias integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ini timestamptz;
  v_fim timestamptz;
  v_agenda jsonb;
  v_catalogo jsonb;
  v_modelos jsonb;
  v_vetinfo jsonb;
  v_servicos jsonb;
BEGIN
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 7 THEN RAISE EXCEPTION 'Escolha de 1 a 7 dias de agenda para levar'; END IF;
  v_ini := v_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (v_hoje + p_dias)::timestamp AT TIME ZONE 'America/Sao_Paulo';

  SELECT jsonb_build_object('id', p.id, 'nome', p.nome, 'crmv', p.crmv, 'crmv_uf', p.crmv_uf) INTO v_vetinfo
    FROM public.pet_profissionais p WHERE p.id = v_vet;

  -- só a agenda do próprio veterinário, sem cancelados nem faltas
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'inicio', a.inicio, 'fim', a.fim, 'situacao', a.situacao,
           'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'porte', pt.porte,
                                     'pelagem', pt.pelagem, 'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado,
                                     'alergias', pt.alergias),
           'tutor', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone),
           'servicos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'categoria', s.categoria) ORDER BY s.nome), '[]'::jsonb)
                          FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id WHERE i.agendamento_id = a.id)
         ) ORDER BY a.inicio), '[]'::jsonb) INTO v_agenda
    FROM public.pet_agendamentos a
    JOIN public.pets pt ON pt.id = a.pet_id
    JOIN public.clientes c ON c.id = a.cliente_id
   WHERE a.tenant_id = v_tenant AND a.profissional_id = v_vet AND a.inicio >= v_ini AND a.inicio < v_fim
     AND a.situacao NOT IN ('cancelado', 'faltou');

  -- catálogo ativo de vacinas e vermífugos, cada item com os lotes que têm saldo e validade (os mesmos que a aplicação mostraria)
  SELECT coalesce(jsonb_agg(item || jsonb_build_object('lotes', public.clinica_lotes_vacina((item ->> 'id')::uuid)) ORDER BY item ->> 'nome'), '[]'::jsonb)
    INTO v_catalogo
    FROM jsonb_array_elements(public.clinica_vacinas_catalogo()) item
   WHERE (item ->> 'ativo')::boolean;

  SELECT coalesce(jsonb_agg(m), '[]'::jsonb) INTO v_modelos
    FROM jsonb_array_elements(public.clinica_exame_modelos()) m
   WHERE (m ->> 'ativo')::boolean;

  -- serviços de consulta ativos, para a visita sem consulta marcada (o preço é conferido na hora de enviar)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', sv.id, 'nome', sv.nome, 'duracao_min', sv.duracao_min) ORDER BY sv.nome), '[]'::jsonb) INTO v_servicos
    FROM public.pet_servicos sv WHERE sv.tenant_id = v_tenant AND sv.ativo AND sv.categoria = 'consulta';

  -- levar dado do paciente para o notebook é acesso: um registro por paciente da agenda
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao)
  SELECT DISTINCT v_tenant, (x -> 'pet' ->> 'id')::uuid, 'visita' FROM jsonb_array_elements(v_agenda) x;

  RETURN jsonb_build_object(
    'gerada_em', now(), 'de', v_hoje, 'ate', v_hoje + p_dias - 1,
    'veterinario', v_vetinfo,
    'agenda', v_agenda,
    'catalogo_vacinas', v_catalogo,
    'modelos_exame', v_modelos,
    'aplicadores', public.clinica_aplicadores(),
    'servicos_consulta', v_servicos);
END $$;

REVOKE ALL ON FUNCTION public.clinica_visita_preparar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_visita_preparar(integer) TO authenticated;
