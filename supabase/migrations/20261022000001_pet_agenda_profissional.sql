-- Pet shop, Fase 2 (PR 8): agenda própria do profissional. O perfil "profissional" entra com a própria conta, ligada ao cadastro
-- do profissional (pet_profissionais.profile_id), vê só a agenda dele e avança os atendimentos dele (começar e dar como pronto).
-- Quem só tem esse perfil fica no mesmo isolamento do salão: nenhuma tabela da loja e nenhuma função da loja. Ele lê a agenda
-- só pelas funções abaixo, que devolvem o mínimo (sem preço, sem telefone, sem documento do tutor).

-- ============ isolamento ============
-- "Perfil restrito" = só garçom, cozinha e/ou profissional. Quem acumula outro papel usa o sistema inteiro.
CREATE OR REPLACE FUNCTION public.eh_salao_restrito()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role IN ('garcom', 'cozinha', 'profissional'))
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role NOT IN ('garcom', 'cozinha', 'profissional'))
$$;

-- Só profissional (sem garçom nem cozinha): fica de fora também das telas do salão que o garçom enxerga.
CREATE OR REPLACE FUNCTION public.eh_profissional_restrito()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role = 'profissional')
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role <> 'profissional')
$$;
REVOKE ALL ON FUNCTION public.eh_profissional_restrito() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_profissional_restrito() TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cardapio_categorias', 'cardapio_itens', 'cardapio_grupos', 'cardapio_opcoes',
                           'mesas', 'comandas', 'comanda_itens', 'comanda_pagamentos', 'restaurante_zonas_entrega'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS profissional_restrito ON public.%I', t);
      EXECUTE format('CREATE POLICY profissional_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_profissional_restrito()))', t);
    END IF;
  END LOOP;
END $$;

-- ============ vínculo ============
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id);
CREATE UNIQUE INDEX IF NOT EXISTS pet_profissionais_profile_idx ON public.pet_profissionais (profile_id) WHERE profile_id IS NOT NULL;

-- A conta é a de um usuário da mesma empresa com o perfil profissional; vale uma conta por cadastro e um cadastro por conta.
CREATE OR REPLACE FUNCTION public.pet_profissional_vincular(p_profissional_id uuid, p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM 1 FROM public.pet_profissionais WHERE id = p_profissional_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  IF p_profile_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.tenant_id = p.tenant_id AND r.role = 'profissional'
     WHERE p.id = p_profile_id AND p.tenant_id = v_tenant AND p.ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um usuário ativo desta empresa com o perfil Profissional'; END IF;
    IF EXISTS (SELECT 1 FROM public.pet_profissionais x WHERE x.profile_id = p_profile_id AND x.id <> p_profissional_id) THEN
      RAISE EXCEPTION 'Este usuário já está ligado a outro profissional';
    END IF;
  END IF;
  UPDATE public.pet_profissionais SET profile_id = p_profile_id WHERE id = p_profissional_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_vincular(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_vincular(uuid, uuid) TO authenticated;

-- Apoio: o cadastro do profissional da conta que está logada (nulo se não houver ou estiver inativo).
CREATE OR REPLACE FUNCTION public._pet_meu_profissional()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.pet_profissionais
   WHERE profile_id = auth.uid() AND tenant_id = public.current_tenant_id() AND ativo
$$;
REVOKE ALL ON FUNCTION public._pet_meu_profissional() FROM PUBLIC, anon, authenticated;

-- ============ agenda do profissional ============
-- Atendimentos do profissional da conta entre as duas datas (horário de Brasília), no máximo 31 dias.
CREATE OR REPLACE FUNCTION public.pet_minha_agenda(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prof uuid;
  v_ini timestamptz;
  v_fim timestamptz;
BEGIN
  PERFORM public.exige_papel(ARRAY['profissional']);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Informe o período'; END IF;
  IF p_ate - p_de > 31 THEN RAISE EXCEPTION 'Escolha um período de até 31 dias'; END IF;
  v_prof := public._pet_meu_profissional();
  IF v_prof IS NULL THEN RAISE EXCEPTION 'Sua conta ainda não está ligada a um profissional ativo: peça à gestão'; END IF;
  v_ini := p_de::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (p_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'inicio', a.inicio, 'fim', a.fim, 'situacao', a.situacao, 'taxi_dog', a.taxi_dog, 'observacoes', a.observacoes,
        'pet', jsonb_build_object('nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'pelagem', pt.pelagem,
                                  'peso_kg', pt.peso_kg, 'castrado', pt.castrado, 'alergias', pt.alergias, 'observacoes', pt.observacoes),
        'tutor', split_part(btrim(c.nome), ' ', 1),
        'servicos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', s.nome, 'duracao_min', i.duracao_min) ORDER BY s.nome), '[]'::jsonb)
                       FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                      WHERE i.agendamento_id = a.id)
      ) ORDER BY a.inicio)
      FROM public.pet_agendamentos a
      JOIN public.pets pt ON pt.id = a.pet_id
      JOIN public.clientes c ON c.id = a.cliente_id
     WHERE a.profissional_id = v_prof AND a.tenant_id = public.current_tenant_id()
       AND a.inicio >= v_ini AND a.inicio < v_fim AND a.situacao NOT IN ('cancelado', 'faltou')
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_minha_agenda(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_minha_agenda(date, date) TO authenticated;

-- O profissional começa o atendimento (agendado/confirmado → em atendimento) e dá como pronto (em atendimento → pronto).
-- Cancelar, faltar, remarcar e cobrar seguem com a recepção.
CREATE OR REPLACE FUNCTION public.pet_minha_situacao(p_id uuid, p_para text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prof uuid;
  a public.pet_agendamentos%ROWTYPE;
BEGIN
  PERFORM public.exige_papel(ARRAY['profissional']);
  v_prof := public._pet_meu_profissional();
  IF v_prof IS NULL THEN RAISE EXCEPTION 'Sua conta ainda não está ligada a um profissional ativo: peça à gestão'; END IF;
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = public.current_tenant_id() AND profissional_id = v_prof FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado na sua agenda'; END IF;
  IF NOT (   (p_para = 'em_atendimento' AND a.situacao IN ('agendado', 'confirmado'))
          OR (p_para = 'pronto' AND a.situacao = 'em_atendimento')) THEN
    RAISE EXCEPTION 'Não é possível passar de "%" para "%"', a.situacao, p_para;
  END IF;
  UPDATE public.pet_agendamentos SET situacao = p_para WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_minha_situacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_minha_situacao(uuid, text) TO authenticated;
