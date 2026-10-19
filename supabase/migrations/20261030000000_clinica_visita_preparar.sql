-- Clínica (Fase 4, PR 5a): "preparar visita" para o trabalho sem internet. O veterinário baixa, antes de sair, a cópia do que a visita precisa:
-- a própria agenda dos próximos dias (paciente, tutor e serviços), o catálogo de vacinas com os lotes que têm saldo, os modelos de exame e
-- os aplicadores. A cópia fica criptografada no notebook (cofre da clínica) e tem validade; nada sai daqui sem registro em clinica_acessos.
-- Só o veterinário (perfil Veterinário, clínica liberada, cadastro com CRMV); a recepção e a gestão não baixam cópia clínica.

ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check
  CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao', 'exame', 'anexo', 'visita'));

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

  -- levar dado do paciente para o notebook é acesso: um registro por paciente da agenda
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao)
  SELECT DISTINCT v_tenant, (x -> 'pet' ->> 'id')::uuid, 'visita' FROM jsonb_array_elements(v_agenda) x;

  RETURN jsonb_build_object(
    'gerada_em', now(), 'de', v_hoje, 'ate', v_hoje + p_dias - 1,
    'veterinario', v_vetinfo,
    'agenda', v_agenda,
    'catalogo_vacinas', v_catalogo,
    'modelos_exame', v_modelos,
    'aplicadores', public.clinica_aplicadores());
END $$;
REVOKE ALL ON FUNCTION public.clinica_visita_preparar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_visita_preparar(integer) TO authenticated;
