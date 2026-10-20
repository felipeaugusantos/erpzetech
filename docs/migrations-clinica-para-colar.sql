
-- ===== 20261019000000_pet_shop_base.sql =====
-- Base do módulo Pet shop: produto que é serviço (banho, tosa, consulta) não controla estoque.
-- A isenção fica no ponto único por onde todo movimento de estoque passa (registrar_movimentacao_interno): venda, cancelamento,
-- devolução, reserva e importação de saldo ignoram o produto marcado, sem saldo e sem erro de estoque insuficiente.

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS controla_estoque boolean NOT NULL DEFAULT true;

DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'registrar_movimentacao_interno';
  IF def IS NULL THEN RAISE EXCEPTION 'registrar_movimentacao_interno não encontrada'; END IF;
  IF position('controla_estoque' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def,
    E'  if p_quantidade is null or p_quantidade <= 0 then raise exception ''Informe uma quantidade maior que zero''; end if;\n',
    E'  if p_quantidade is null or p_quantidade <= 0 then raise exception ''Informe uma quantidade maior que zero''; end if;\n'
    || E'  -- serviço (controla_estoque = false): não há saldo nem movimento\n'
    || E'  if exists (select 1 from public.produtos px where px.id = p_produto_id and px.tenant_id = v_tenant and not px.controla_estoque) then\n'
    || E'    return null;\n'
    || E'  end if;\n');
  IF nova = def THEN RAISE EXCEPTION 'registrar_movimentacao_interno: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- ===== 20261019000001_pet_cadastros.sql =====
-- Pet shop (PR 2): tutores e pets, serviços com preço por porte/raça/pelagem e profissionais.
-- Escrita só por funções (papel + trava do salão). O tutor é um cliente comum; o serviço é um produto sem controle de estoque.

-- ============ pets ============
CREATE TABLE IF NOT EXISTS public.pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  especie text NOT NULL DEFAULT 'cao' CHECK (especie IN ('cao', 'gato', 'outro')),
  raca text,
  porte text CHECK (porte IN ('mini', 'pequeno', 'medio', 'grande', 'gigante')),
  sexo text CHECK (sexo IN ('macho', 'femea')),
  pelagem text CHECK (pelagem IN ('curta', 'media', 'longa', 'dupla', 'crespa', 'sem_pelo')),
  peso_kg numeric(6,2) CHECK (peso_kg > 0),
  nascimento date,
  castrado boolean,
  alergias text,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pets_tenant_idx ON public.pets (tenant_id, ativo, nome);
CREATE INDEX IF NOT EXISTS pets_cliente_idx ON public.pets (cliente_id);

-- ============ serviços ============
CREATE TABLE IF NOT EXISTS public.pet_servicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  categoria text NOT NULL DEFAULT 'banho' CHECK (categoria IN ('banho', 'tosa', 'estetica', 'outro')),
  duracao_min integer NOT NULL DEFAULT 60 CHECK (duracao_min BETWEEN 5 AND 720),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_servicos_nome_idx ON public.pet_servicos (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS pet_servicos_produto_idx ON public.pet_servicos (produto_id);

-- Cada critério vazio vale para qualquer pet. Vence o preço mais específico (raça 4 > pelagem 2 > porte 1).
CREATE TABLE IF NOT EXISTS public.pet_servico_precos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id) ON DELETE CASCADE,
  porte text CHECK (porte IN ('mini', 'pequeno', 'medio', 'grande', 'gigante')),
  raca text CHECK (raca IS NULL OR length(btrim(raca)) > 0),
  pelagem text CHECK (pelagem IN ('curta', 'media', 'longa', 'dupla', 'crespa', 'sem_pelo')),
  preco numeric(14,2) NOT NULL CHECK (preco >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_servico_precos_combinacao_idx ON public.pet_servico_precos
  (servico_id, coalesce(porte, ''), coalesce(lower(btrim(raca)), ''), coalesce(pelagem, ''));

-- ============ profissionais ============
CREATE TABLE IF NOT EXISTS public.pet_profissionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid REFERENCES public.filiais(id),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  funcao text NOT NULL DEFAULT 'tosador' CHECK (funcao IN ('banhista', 'tosador', 'groomer', 'veterinario', 'auxiliar', 'outro')),
  comissao_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK (comissao_percentual BETWEEN 0 AND 100),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_profissionais_tenant_idx ON public.pet_profissionais (tenant_id, ativo, nome);

-- ============ acesso: leitura da empresa, escrita só pelas funções ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pets', 'pet_servicos', 'pet_servico_precos', 'pet_profissionais'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $$;

-- ============ funções ============
-- Tutor e pet: a recepção também cadastra.
CREATE OR REPLACE FUNCTION public.pet_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_cliente uuid := nullif(p_dados ->> 'cliente_id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_peso numeric := nullif(p_dados ->> 'peso_kg', '')::numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do pet'; END IF;
  IF v_peso IS NOT NULL AND v_peso <= 0 THEN RAISE EXCEPTION 'O peso precisa ser maior que zero'; END IF;
  IF coalesce(p_dados ->> 'especie', 'cao') NOT IN ('cao', 'gato', 'outro') THEN RAISE EXCEPTION 'Espécie inválida'; END IF;
  IF nullif(p_dados ->> 'porte', '') IS NOT NULL AND p_dados ->> 'porte' NOT IN ('mini', 'pequeno', 'medio', 'grande', 'gigante') THEN RAISE EXCEPTION 'Porte inválido'; END IF;
  IF nullif(p_dados ->> 'pelagem', '') IS NOT NULL AND p_dados ->> 'pelagem' NOT IN ('curta', 'media', 'longa', 'dupla', 'crespa', 'sem_pelo') THEN RAISE EXCEPTION 'Pelagem inválida'; END IF;
  IF nullif(p_dados ->> 'sexo', '') IS NOT NULL AND p_dados ->> 'sexo' NOT IN ('macho', 'femea') THEN RAISE EXCEPTION 'Sexo inválido'; END IF;
  IF v_cliente IS NULL OR NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o tutor (cliente) do pet';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.pets (tenant_id, cliente_id, nome, especie, raca, porte, sexo, pelagem, peso_kg, nascimento, castrado, alergias, observacoes, ativo)
    VALUES (v_tenant, v_cliente, v_nome, coalesce(nullif(p_dados ->> 'especie', ''), 'cao'), nullif(btrim(p_dados ->> 'raca'), ''),
            nullif(p_dados ->> 'porte', ''), nullif(p_dados ->> 'sexo', ''), nullif(p_dados ->> 'pelagem', ''), v_peso,
            nullif(p_dados ->> 'nascimento', '')::date, (p_dados ->> 'castrado')::boolean, nullif(btrim(p_dados ->> 'alergias'), ''),
            nullif(btrim(p_dados ->> 'observacoes'), ''), coalesce((p_dados ->> 'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.pets SET cliente_id = v_cliente, nome = v_nome, especie = coalesce(nullif(p_dados ->> 'especie', ''), 'cao'),
           raca = nullif(btrim(p_dados ->> 'raca'), ''), porte = nullif(p_dados ->> 'porte', ''), sexo = nullif(p_dados ->> 'sexo', ''),
           pelagem = nullif(p_dados ->> 'pelagem', ''), peso_kg = v_peso, nascimento = nullif(p_dados ->> 'nascimento', '')::date,
           castrado = (p_dados ->> 'castrado')::boolean, alergias = nullif(btrim(p_dados ->> 'alergias'), ''),
           observacoes = nullif(btrim(p_dados ->> 'observacoes'), ''), ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_salvar(jsonb) TO authenticated;

-- Serviço: cria (ou atualiza) o produto que entra na frente de caixa, sem controle de estoque.
CREATE OR REPLACE FUNCTION public.pet_servico_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_cat text := coalesce(nullif(p_dados ->> 'categoria', ''), 'banho');
  v_dur integer := coalesce(nullif(p_dados ->> 'duracao_min', '')::integer, 60);
  v_base numeric := coalesce(nullif(p_dados ->> 'preco_base', '')::numeric, 0);
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_prod uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do serviço'; END IF;
  IF v_cat NOT IN ('banho', 'tosa', 'estetica', 'outro') THEN RAISE EXCEPTION 'Categoria inválida'; END IF;
  IF v_dur < 5 OR v_dur > 720 THEN RAISE EXCEPTION 'A duração precisa ficar entre 5 e 720 minutos'; END IF;
  IF v_base < 0 THEN RAISE EXCEPTION 'O preço não pode ser negativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_servico:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_servicos s WHERE s.tenant_id = v_tenant AND lower(btrim(s.nome)) = lower(v_nome) AND s.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um serviço com este nome';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque, ativo)
    VALUES (v_tenant, '', v_nome, 'UN', v_base, false, v_ativo)
    RETURNING id INTO v_prod;
    INSERT INTO public.pet_servicos (tenant_id, nome, categoria, duracao_min, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_cat, v_dur, v_prod, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.pet_servicos SET nome = v_nome, categoria = v_cat, duracao_min = v_dur, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant
    RETURNING produto_id INTO v_prod;
    IF v_prod IS NULL THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
    UPDATE public.produtos SET descricao = v_nome, preco_venda = v_base, ativo = v_ativo WHERE id = v_prod AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_servico_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_servico_salvar(jsonb) TO authenticated;

-- Preço por critério: grava ou atualiza a linha da combinação.
CREATE OR REPLACE FUNCTION public.pet_preco_salvar(
  p_servico_id uuid, p_porte text, p_raca text, p_pelagem text, p_preco numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_porte text := nullif(btrim(p_porte), '');
  v_raca text := nullif(btrim(p_raca), '');
  v_pelagem text := nullif(btrim(p_pelagem), '');
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF p_preco IS NULL OR p_preco < 0 THEN RAISE EXCEPTION 'Informe um preço válido'; END IF;
  IF v_porte IS NOT NULL AND v_porte NOT IN ('mini', 'pequeno', 'medio', 'grande', 'gigante') THEN RAISE EXCEPTION 'Porte inválido'; END IF;
  IF v_pelagem IS NOT NULL AND v_pelagem NOT IN ('curta', 'media', 'longa', 'dupla', 'crespa', 'sem_pelo') THEN RAISE EXCEPTION 'Pelagem inválida'; END IF;
  PERFORM 1 FROM public.pet_servicos WHERE id = p_servico_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_preco:' || p_servico_id::text, 0));

  SELECT id INTO v_id FROM public.pet_servico_precos
   WHERE servico_id = p_servico_id AND coalesce(porte, '') = coalesce(v_porte, '')
     AND coalesce(lower(btrim(raca)), '') = coalesce(lower(v_raca), '') AND coalesce(pelagem, '') = coalesce(v_pelagem, '');
  IF v_id IS NULL THEN
    INSERT INTO public.pet_servico_precos (tenant_id, servico_id, porte, raca, pelagem, preco)
    VALUES (v_tenant, p_servico_id, v_porte, v_raca, v_pelagem, round(p_preco, 2)) RETURNING id INTO v_id;
  ELSE
    UPDATE public.pet_servico_precos SET preco = round(p_preco, 2) WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_preco_salvar(uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_preco_salvar(uuid, text, text, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_preco_remover(p_preco_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  DELETE FROM public.pet_servico_precos WHERE id = p_preco_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Preço não encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_preco_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_preco_remover(uuid) TO authenticated;

-- Qual preço vale para este pet: o mais específico entre os que batem (mesma regra de src/lib/pet.ts).
CREATE OR REPLACE FUNCTION public.pet_preco_calcular(p_servico_id uuid, p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  r record;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  PERFORM 1 FROM public.pet_servicos WHERE id = p_servico_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  SELECT p.id, p.preco, p.porte, p.raca, p.pelagem,
         (CASE WHEN p.raca IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.pelagem IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN p.porte IS NOT NULL THEN 1 ELSE 0 END) AS pontos
    INTO r
    FROM public.pet_servico_precos p
   WHERE p.servico_id = p_servico_id AND p.tenant_id = v_tenant
     AND (p.porte IS NULL OR p.porte = pt.porte)
     AND (p.raca IS NULL OR lower(btrim(p.raca)) = lower(btrim(coalesce(pt.raca, ''))))
     AND (p.pelagem IS NULL OR p.pelagem = pt.pelagem)
   ORDER BY 6 DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('preco_id', r.id, 'preco', r.preco, 'porte', r.porte, 'raca', r.raca, 'pelagem', r.pelagem, 'pontos', r.pontos);
END $$;
REVOKE ALL ON FUNCTION public.pet_preco_calcular(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_preco_calcular(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_profissional_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_funcao text := coalesce(nullif(p_dados ->> 'funcao', ''), 'tosador');
  v_com numeric := coalesce(nullif(p_dados ->> 'comissao_percentual', '')::numeric, 0);
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do profissional'; END IF;
  IF v_funcao NOT IN ('banhista', 'tosador', 'groomer', 'veterinario', 'auxiliar', 'outro') THEN RAISE EXCEPTION 'Função inválida'; END IF;
  IF v_com < 0 OR v_com > 100 THEN RAISE EXCEPTION 'A comissão precisa ficar entre 0 e 100%%'; END IF;
  IF v_filial IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filiais f WHERE f.id = v_filial AND f.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_profissionais (tenant_id, filial_id, nome, funcao, comissao_percentual, ativo)
    VALUES (v_tenant, v_filial, v_nome, v_funcao, v_com, coalesce((p_dados ->> 'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.pet_profissionais SET filial_id = v_filial, nome = v_nome, funcao = v_funcao, comissao_percentual = v_com,
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_salvar(jsonb) TO authenticated;

-- ===== 20261019000002_pet_agenda.sql =====
-- Pet shop (PR 3): agenda de banho e tosa. Só a recepção agenda; o profissional não pode ter dois atendimentos ao mesmo tempo.
-- A cobrança ("retirado") entra no PR seguinte: aqui o atendimento vai até "pronto".
-- A escrita passa só pelas funções, que travam o profissional (lock) antes de conferir a sobreposição.

CREATE TABLE IF NOT EXISTS public.pet_agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid REFERENCES public.filiais(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  situacao text NOT NULL DEFAULT 'agendado'
    CHECK (situacao IN ('agendado', 'confirmado', 'em_atendimento', 'pronto', 'retirado', 'cancelado', 'faltou')),
  observacoes text,
  taxi_dog boolean NOT NULL DEFAULT false,
  motivo text,
  venda_id uuid REFERENCES public.pedidos(id),
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS pet_agendamentos_dia_idx ON public.pet_agendamentos (tenant_id, inicio);
CREATE INDEX IF NOT EXISTS pet_agendamentos_prof_idx ON public.pet_agendamentos (profissional_id, inicio) WHERE situacao NOT IN ('cancelado', 'faltou');
CREATE INDEX IF NOT EXISTS pet_agendamentos_pet_idx ON public.pet_agendamentos (pet_id, inicio DESC);

-- Preço e duração ficam congelados na hora de agendar.
CREATE TABLE IF NOT EXISTS public.pet_agendamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  agendamento_id uuid NOT NULL REFERENCES public.pet_agendamentos(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id),
  preco_aplicado numeric(14,2) NOT NULL CHECK (preco_aplicado >= 0),
  duracao_min integer NOT NULL CHECK (duracao_min > 0),
  preco_avulso boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agendamento_id, servico_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_agendamentos', 'pet_agendamento_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER trg_pet_agendamentos_updated BEFORE UPDATE ON public.pet_agendamentos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- Apoio: o profissional já tem atendimento que cruza este intervalo? (intervalo aberto no fim: um começa quando o outro termina)
CREATE OR REPLACE FUNCTION public._pet_conflito(p_prof uuid, p_ini timestamptz, p_fim timestamptz, p_ignorar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pet_agendamentos a
     WHERE a.profissional_id = p_prof AND a.situacao NOT IN ('cancelado', 'faltou')
       AND a.id IS DISTINCT FROM p_ignorar
       AND a.inicio < p_fim AND a.fim > p_ini)
$$;
REVOKE ALL ON FUNCTION public._pet_conflito(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- p_dados: {pet_id, profissional_id, inicio, servicos: [{servico_id, preco_avulso?}], observacoes?, taxi_dog?}
CREATE OR REPLACE FUNCTION public.pet_agendar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_ini timestamptz := nullif(p_dados ->> 'inicio', '')::timestamptz;
  v_fim timestamptz;
  v_dur integer := 0;
  v_gestao boolean;
  it jsonb;
  sv public.pet_servicos%ROWTYPE;
  v_calc jsonb;
  v_preco numeric;
  v_avulso boolean;
  v_itens jsonb := '[]'::jsonb;
  v_vistos uuid[] := '{}';
  v_id uuid;
  r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  v_gestao := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe o dia e a hora do atendimento'; END IF;
  IF jsonb_typeof(p_dados -> 'servicos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'servicos') = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um serviço';
  END IF;

  SELECT * INTO pt FROM public.pets WHERE id = nullif(p_dados ->> 'pet_id', '')::uuid AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  IF NOT pt.ativo THEN RAISE EXCEPTION 'Este pet está inativo'; END IF;
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = nullif(p_dados ->> 'profissional_id', '')::uuid AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  IF NOT pf.ativo THEN RAISE EXCEPTION 'Este profissional está inativo'; END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_dados -> 'servicos') LOOP
    SELECT * INTO sv FROM public.pet_servicos WHERE id = nullif(it ->> 'servico_id', '')::uuid AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
    IF NOT sv.ativo THEN RAISE EXCEPTION 'O serviço % está inativo', sv.nome; END IF;
    IF sv.id = ANY (v_vistos) THEN RAISE EXCEPTION 'O serviço % foi escolhido duas vezes', sv.nome; END IF;
    v_vistos := v_vistos || sv.id;

    v_calc := public.pet_preco_calcular(sv.id, pt.id);
    v_avulso := false;
    IF v_calc IS NOT NULL THEN
      v_preco := (v_calc ->> 'preco')::numeric;
    ELSIF nullif(it ->> 'preco_avulso', '') IS NOT NULL THEN
      IF NOT v_gestao THEN RAISE EXCEPTION 'Sem preço cadastrado para % neste pet; só administrador ou gestor informa preço avulso', sv.nome; END IF;
      v_preco := (it ->> 'preco_avulso')::numeric;
      IF v_preco < 0 THEN RAISE EXCEPTION 'O preço avulso não pode ser negativo'; END IF;
      v_avulso := true;
    ELSE
      RAISE EXCEPTION 'O serviço % não tem preço cadastrado para este pet', sv.nome;
    END IF;
    v_dur := v_dur + sv.duracao_min;
    v_itens := v_itens || jsonb_build_object('servico_id', sv.id, 'preco', round(v_preco, 2), 'duracao', sv.duracao_min, 'avulso', v_avulso);
  END LOOP;

  v_fim := v_ini + make_interval(mins => v_dur);
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_agenda:' || pf.id::text, 0));
  IF public._pet_conflito(pf.id, v_ini, v_fim, NULL) THEN
    RAISE EXCEPTION '% já tem atendimento neste horário', pf.nome;
  END IF;

  INSERT INTO public.pet_agendamentos (tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, observacoes, taxi_dog)
  VALUES (v_tenant, pf.filial_id, pt.id, pt.cliente_id, pf.id, v_ini, v_fim, nullif(btrim(p_dados ->> 'observacoes'), ''),
          coalesce((p_dados ->> 'taxi_dog')::boolean, false))
  RETURNING id INTO v_id;
  FOR r IN SELECT value FROM jsonb_array_elements(v_itens) LOOP
    INSERT INTO public.pet_agendamento_itens (tenant_id, agendamento_id, servico_id, preco_aplicado, duracao_min, preco_avulso)
    VALUES (v_tenant, v_id, (r ->> 'servico_id')::uuid, (r ->> 'preco')::numeric, (r ->> 'duracao')::integer, (r ->> 'avulso')::boolean);
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_agendar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agendar(jsonb) TO authenticated;

-- Situação: agendado → confirmado → em_atendimento → pronto. Cancelar e faltar valem enquanto o atendimento não começou.
-- "retirado" só sai da cobrança (próximo PR); por aqui não se alcança.
CREATE OR REPLACE FUNCTION public.pet_agenda_situacao(p_id uuid, p_para text, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.pet_agendamentos%ROWTYPE;
  v_ok boolean;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  v_ok := CASE a.situacao
    WHEN 'agendado' THEN p_para IN ('confirmado', 'em_atendimento', 'cancelado', 'faltou')
    WHEN 'confirmado' THEN p_para IN ('em_atendimento', 'cancelado', 'faltou')
    WHEN 'em_atendimento' THEN p_para = 'pronto'
    ELSE false END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Não é possível passar de "%" para "%"', a.situacao, p_para;
  END IF;
  IF p_para IN ('cancelado', 'faltou') AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo';
  END IF;
  UPDATE public.pet_agendamentos SET situacao = p_para, motivo = CASE WHEN p_para IN ('cancelado', 'faltou') THEN v_motivo ELSE motivo END
   WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_situacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_situacao(uuid, text, text) TO authenticated;

-- Remarcar: só antes de começar; o profissional pode mudar; a duração dos serviços já combinados se mantém.
CREATE OR REPLACE FUNCTION public.pet_reagendar(p_id uuid, p_inicio timestamptz, p_profissional_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.pet_agendamentos%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_dur integer;
  v_fim timestamptz;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_inicio IS NULL THEN RAISE EXCEPTION 'Informe o novo horário'; END IF;
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao NOT IN ('agendado', 'confirmado') THEN
    RAISE EXCEPTION 'Só dá para remarcar atendimento agendado ou confirmado';
  END IF;
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = coalesce(p_profissional_id, a.profissional_id) AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  IF NOT pf.ativo THEN RAISE EXCEPTION 'Este profissional está inativo'; END IF;
  SELECT coalesce(sum(duracao_min), 0) INTO v_dur FROM public.pet_agendamento_itens WHERE agendamento_id = a.id;
  v_fim := p_inicio + make_interval(mins => v_dur);
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_agenda:' || pf.id::text, 0));
  IF public._pet_conflito(pf.id, p_inicio, v_fim, a.id) THEN
    RAISE EXCEPTION '% já tem atendimento neste horário', pf.nome;
  END IF;
  UPDATE public.pet_agendamentos SET inicio = p_inicio, fim = v_fim, profissional_id = pf.id, filial_id = pf.filial_id WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_reagendar(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_reagendar(uuid, timestamptz, uuid) TO authenticated;

-- ===== 20261019000003_pet_cobranca.sql =====
-- Pet shop (PR 4): cobrança do atendimento pronto ("Retirar e cobrar"), comissão do profissional e NFS-e em rascunho.
-- A venda é feita pela frente de caixa de sempre (o operador escolhe a forma de pagamento); depois pet_agenda_retirar
-- confere que a venda é aquela mesma, liga os dois, calcula a comissão e deixa a NFS-e do serviço em rascunho.

CREATE UNIQUE INDEX IF NOT EXISTS pet_agendamentos_venda_idx ON public.pet_agendamentos (venda_id) WHERE venda_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pet_comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  agendamento_id uuid NOT NULL UNIQUE REFERENCES public.pet_agendamentos(id),
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id),
  base numeric(14,2) NOT NULL CHECK (base >= 0),
  percentual numeric(5,2) NOT NULL CHECK (percentual BETWEEN 0 AND 100),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  situacao text NOT NULL DEFAULT 'a_aprovar' CHECK (situacao IN ('a_aprovar', 'aprovada', 'paga', 'cancelada')),
  aprovada_em timestamptz,
  aprovada_por uuid,
  pago_em timestamptz,
  pago_por uuid,
  forma_pagamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_comissoes_prof_idx ON public.pet_comissoes (tenant_id, profissional_id, situacao);

ALTER TABLE public.pet_comissoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_comissoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pet_comissoes TO authenticated;
GRANT ALL ON public.pet_comissoes TO service_role;
CREATE POLICY pet_comissoes_ler ON public.pet_comissoes FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro')));
CREATE POLICY salao_restrito ON public.pet_comissoes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
CREATE TRIGGER trg_pet_comissoes_updated BEFORE UPDATE ON public.pet_comissoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- NFS-e do serviço, como rascunho (com as pendências de configuração) ou pronta, no molde da locação.
-- Interna: só é chamada por pet_agenda_retirar.
CREATE OR REPLACE FUNCTION public._pet_nfse_rascunho(p_agendamento_id uuid, p_pedido_id uuid, p_liquido numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.pet_agendamentos%ROWTYPE;
  v_ped record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_bruto numeric;
BEGIN
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  SELECT * INTO v_cli FROM public.clientes WHERE id = a.cliente_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas
   WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_fil_cfg FROM public.fiscal_config WHERE tenant_id = v_tenant AND filial_id = v_ped.filial_id LIMIT 1;
  SELECT * INTO v_emp_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND filial_id IS NULL AND (empresa_id = v_emp.id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;
  IF v_fil_cfg IS NULL AND v_emp_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_emp_cfg;
  END IF;
  -- registro não encontrado vira linha de campos nulos: escolhe pela chave, não por coalesce
  IF v_fil_cfg.id IS NOT NULL THEN v_cfg := v_fil_cfg; ELSE v_cfg := v_emp_cfg; END IF;

  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''), coalesce(v_fil.cidade, v_emp.cidade, ''));

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\D', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do tutor inválido ou ausente');
  END IF;
  IF coalesce(v_emp.cnpj, '') = '' THEN v_pend := array_append(v_pend, 'CNPJ da empresa ausente'); END IF;
  IF coalesce(v_emp.inscricao_municipal, '') = '' THEN
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  END IF;
  IF v_codigo = '' THEN v_pend := array_append(v_pend, 'Código do serviço municipal não configurado'); END IF;
  IF v_iss <= 0 THEN v_pend := array_append(v_pend, 'Alíquota de ISS não configurada'); END IF;
  IF v_cert = '' THEN v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado'); END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    UPDATE public.fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = v_cfg.id;
  END IF;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.pet_agendamento_itens WHERE agendamento_id = a.id;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, a.cliente_id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    'Prestação de serviço — banho, tosa e estética de animais', NULL,
    v_bruto, greatest(v_bruto - p_liquido, 0), p_liquido, round(p_liquido * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj, 'inscricao_municipal', v_emp.inscricao_municipal,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero, 'bairro', v_cli.bairro, 'cidade', v_cli.cidade,
      'estado', v_cli.estado, 'cep', v_cli.cep, 'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      ELSE 'NFS-e em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_pedidos (tenant_id, nfe_id, pedido_id) VALUES (v_tenant, v_nfe, p_pedido_id);

  INSERT INTO public.nfe_itens (tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total, cst_csosn)
  SELECT v_tenant, v_nfe, s.nome || ' — ' || pt.nome, 'UN', 1, i.preco_aplicado, i.preco_aplicado, '400'
    FROM public.pet_agendamento_itens i
    JOIN public.pet_servicos s ON s.id = i.servico_id
    JOIN public.pets pt ON pt.id = a.pet_id
   WHERE i.agendamento_id = a.id;

  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN v_nfe;
END $$;
REVOKE ALL ON FUNCTION public._pet_nfse_rascunho(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Retirar e cobrar: liga o atendimento "pronto" à venda do caixa (por pedido ou pela chave da venda).
CREATE OR REPLACE FUNCTION public.pet_agenda_retirar(p_agendamento_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.pet_agendamentos%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  r record;
  v_bruto numeric; v_liquido numeric; v_valor numeric; v_nfe uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao = 'retirado' AND a.venda_id IS NOT NULL AND (a.venda_id = p_pedido_id OR p_pedido_id IS NULL) THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    RETURN jsonb_build_object('pedido_id', a.venda_id, 'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = a.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1), 'repetido', true);
  END IF;
  IF a.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para retirar e cobrar atendimento pronto (situação atual: %)', a.situacao; END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A cobrança do pet shop é feita na frente de caixa'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_agendamentos o WHERE o.venda_id = v_pedido AND o.id <> a.id) THEN
    RAISE EXCEPTION 'Esta venda já cobrou outro atendimento';
  END IF;

  -- a venda precisa ter cada serviço do atendimento, pelo valor combinado
  FOR r IN SELECT i.servico_id, i.preco_aplicado, s.produto_id, s.nome
             FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
            WHERE i.agendamento_id = a.id LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                    AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
      RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
    END IF;
  END LOOP;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.pet_agendamento_itens WHERE agendamento_id = a.id;
  -- o desconto da venda reparte-se por igual entre todos os itens: o serviço fica com a parte proporcional
  v_liquido := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(v_bruto * v_ped.total / v_ped.subtotal, 2) ELSE v_bruto END;

  UPDATE public.pet_agendamentos SET situacao = 'retirado', venda_id = v_pedido WHERE id = a.id;

  SELECT * INTO pf FROM public.pet_profissionais WHERE id = a.profissional_id;
  v_valor := round(v_liquido * pf.comissao_percentual / 100, 2);
  IF v_valor > 0 THEN
    INSERT INTO public.pet_comissoes (tenant_id, profissional_id, agendamento_id, pedido_id, base, percentual, valor)
    VALUES (v_tenant, a.profissional_id, a.id, v_pedido, v_liquido, pf.comissao_percentual, v_valor)
    -- cobrar de novo depois de uma venda cancelada reativa a comissão cancelada (uma por atendimento)
    ON CONFLICT (agendamento_id) DO UPDATE
       SET pedido_id = EXCLUDED.pedido_id, base = EXCLUDED.base, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor,
           situacao = 'a_aprovar', aprovada_em = NULL, aprovada_por = NULL
     WHERE public.pet_comissoes.situacao = 'cancelada';
  END IF;

  v_nfe := public._pet_nfse_rascunho(a.id, v_pedido, v_liquido);
  RETURN jsonb_build_object('pedido_id', v_pedido, 'nfe_id', v_nfe, 'comissao', v_valor, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid) TO authenticated;

-- Venda cancelada no caixa: o atendimento volta a "pronto", a comissão não paga é cancelada e o rascunho da NFS-e sai.
CREATE OR REPLACE FUNCTION public.pet_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado'
     AND EXISTS (SELECT 1 FROM public.pet_agendamentos WHERE venda_id = NEW.id) THEN
    UPDATE public.pet_comissoes SET situacao = 'cancelada' WHERE pedido_id = NEW.id AND situacao IN ('a_aprovar', 'aprovada');
    DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
    UPDATE public.pet_agendamentos SET situacao = 'pronto', venda_id = NULL WHERE venda_id = NEW.id AND situacao = 'retirado';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pet_venda_cancelada() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_pet_venda_cancelada AFTER UPDATE OF situacao ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pet_venda_cancelada();

-- Comissão: a_aprovar → aprovada → paga (o pagamento em si é feito fora; aqui fica o registro de quem e quando).
CREATE OR REPLACE FUNCTION public.pet_comissao_aprovar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  UPDATE public.pet_comissoes SET situacao = 'aprovada', aprovada_em = now(), aprovada_por = auth.uid()
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'a_aprovar';
  IF NOT FOUND THEN RAISE EXCEPTION 'Comissão não encontrada ou já tratada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_comissao_aprovar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_comissao_aprovar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_comissao_pagar(p_id uuid, p_forma text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  UPDATE public.pet_comissoes SET situacao = 'paga', pago_em = now(), pago_por = auth.uid(), forma_pagamento = nullif(btrim(p_forma), '')
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'aprovada';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só dá para pagar comissão aprovada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_comissao_pagar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_comissao_pagar(uuid, text) TO authenticated;

-- Relatório "Serviços por profissional" (atendimentos retirados no período).
CREATE OR REPLACE FUNCTION public.pet_servicos_por_profissional(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Informe um período válido'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(l ORDER BY l ->> 'nome') FROM (
      SELECT jsonb_build_object(
        'profissional_id', pf.id, 'nome', pf.nome,
        'atendimentos', count(DISTINCT a.id),
        'servicos', coalesce(sum(it.qtd), 0),
        'faturamento', coalesce(sum(it.valor), 0),
        'comissao_a_aprovar', coalesce((SELECT sum(c.valor) FROM public.pet_comissoes c JOIN public.pet_agendamentos x ON x.id = c.agendamento_id
                                         WHERE c.profissional_id = pf.id AND c.situacao = 'a_aprovar' AND x.inicio::date BETWEEN p_de AND p_ate), 0),
        'comissao_aprovada', coalesce((SELECT sum(c.valor) FROM public.pet_comissoes c JOIN public.pet_agendamentos x ON x.id = c.agendamento_id
                                        WHERE c.profissional_id = pf.id AND c.situacao = 'aprovada' AND x.inicio::date BETWEEN p_de AND p_ate), 0),
        'comissao_paga', coalesce((SELECT sum(c.valor) FROM public.pet_comissoes c JOIN public.pet_agendamentos x ON x.id = c.agendamento_id
                                    WHERE c.profissional_id = pf.id AND c.situacao = 'paga' AND x.inicio::date BETWEEN p_de AND p_ate), 0)
      ) AS l
        FROM public.pet_profissionais pf
        JOIN public.pet_agendamentos a ON a.profissional_id = pf.id AND a.tenant_id = v_tenant AND a.situacao = 'retirado'
             AND a.inicio::date BETWEEN p_de AND p_ate
        LEFT JOIN LATERAL (SELECT count(*) AS qtd, sum(i.preco_aplicado) AS valor FROM public.pet_agendamento_itens i WHERE i.agendamento_id = a.id) it ON true
       WHERE pf.tenant_id = v_tenant
       GROUP BY pf.id, pf.nome
    ) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_servicos_por_profissional(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_servicos_por_profissional(date, date) TO authenticated;

-- NFC-e: só a mercadoria entra (serviço vai para a NFS-e). Venda só de serviço não gera NFC-e.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'nfce_criar';
  IF def IS NULL THEN RAISE EXCEPTION 'nfce_criar não encontrada'; END IF;
  IF position('controla_estoque' IN def) > 0 THEN RETURN; END IF;
  nova := def;
  -- 1) declaração
  nova := replace(nova, E'  v_total numeric;\nBEGIN', E'  v_total numeric;\n  v_serv numeric := 0;\nBEGIN');
  -- 2) "tem itens" olha só a mercadoria
  nova := replace(nova, E'IF NOT EXISTS (SELECT 1 FROM public.pedido_itens WHERE pedido_id = p_pedido_id) THEN',
                        E'IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi JOIN public.produtos pp ON pp.id = pi.produto_id WHERE pi.pedido_id = p_pedido_id AND pp.controla_estoque) THEN');
  -- 3) conferência dos itens: só mercadoria
  nova := replace(nova, E'                 WHERE i.pedido_id = p_pedido_id LOOP', E'                 WHERE i.pedido_id = p_pedido_id AND p.controla_estoque LOOP');
  -- 4) totais: tira a parte do serviço (e do desconto proporcional)
  nova := replace(nova, E'  v_total := coalesce(v_ped.total, 0);\n',
    E'  v_total := coalesce(v_ped.total, 0);\n'
    || E'  SELECT coalesce(sum(i.total), 0) INTO v_serv FROM public.pedido_itens i JOIN public.produtos pp ON pp.id = i.produto_id\n'
    || E'   WHERE i.pedido_id = p_pedido_id AND NOT pp.controla_estoque;\n'
    || E'  IF v_serv > 0 THEN\n'
    || E'    IF v_prod <= 0 THEN RAISE EXCEPTION ''A venda só tem serviços: a nota é de serviço (NFS-e)''; END IF;\n'
    || E'    v_desc := round(v_desc * v_prod / (v_prod + v_serv), 2);\n'
    || E'    v_total := greatest(v_prod - v_desc + v_frete, 0);\n'
    || E'  END IF;\n');
  -- 5) itens da nota: só mercadoria
  nova := replace(nova, E'   WHERE i.pedido_id = p_pedido_id;\n\n  PERFORM public.nfe_calcular_impostos(v_nfe);',
                        E'   WHERE i.pedido_id = p_pedido_id AND p.controla_estoque;\n\n  PERFORM public.nfe_calcular_impostos(v_nfe);');
  IF (length(nova) - length(replace(nova, 'controla_estoque', ''))) / length('controla_estoque') <> 4 THEN
    RAISE EXCEPTION 'nfce_criar: algum trecho esperado não foi encontrado';
  END IF;
  EXECUTE nova;
END $$;

-- ===== 20261020000000_pet_contatos.sql =====
-- Pet shop, Fase 2 (PR 5): contatos com o tutor. Aniversário do pet e retorno de banho viram listas para a recepção;
-- o contato registrado tira o pet da lista naquela ocasião. Sem envio automático: o clique é da recepção.

CREATE TABLE IF NOT EXISTS public.pet_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  tipo text NOT NULL CHECK (tipo IN ('aniversario', 'retorno')),
  -- a ocasião: o dia do aniversário, ou a data do último atendimento que motivou o retorno
  referencia date NOT NULL,
  canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'telefone', 'outro')),
  observacao text,
  contatado_por uuid DEFAULT auth.uid(),
  contatado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pet_id, tipo, referencia)
);
CREATE INDEX IF NOT EXISTS pet_contatos_tenant_idx ON public.pet_contatos (tenant_id, tipo, referencia);

ALTER TABLE public.pet_contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_contatos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pet_contatos TO authenticated;
GRANT ALL ON public.pet_contatos TO service_role;
CREATE POLICY pet_contatos_ler ON public.pet_contatos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.pet_contatos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- p_tipo: 'aniversario' (p_janela = dias à frente) ou 'retorno' (p_dias = dias sem atendimento).
CREATE OR REPLACE FUNCTION public.pet_contatos_pendentes(p_tipo text, p_dias integer DEFAULT 30, p_janela integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_tipo NOT IN ('aniversario', 'retorno') THEN RAISE EXCEPTION 'Tipo de contato inválido'; END IF;

  IF p_tipo = 'aniversario' THEN
    IF p_janela IS NULL OR p_janela < 0 OR p_janela > 60 THEN RAISE EXCEPTION 'A janela precisa ficar entre 0 e 60 dias'; END IF;
    RETURN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'pet_id', t.id, 'pet', t.nome, 'tutor', t.tutor, 'telefone', t.telefone,
               'referencia', t.prox, 'anos', extract(year FROM age(t.prox, t.nascimento))::int) ORDER BY t.prox, t.nome)
        FROM (
          SELECT x.*, CASE WHEN x.cand < v_hoje THEN (x.nascimento + make_interval(years => x.anos + 1))::date ELSE x.cand END AS prox
            FROM (
              SELECT p.id, p.nome, p.nascimento, c.nome AS tutor, c.telefone,
                     extract(year FROM age(v_hoje, p.nascimento))::int AS anos,
                     (p.nascimento + make_interval(years => extract(year FROM age(v_hoje, p.nascimento))::int))::date AS cand
                FROM public.pets p JOIN public.clientes c ON c.id = p.cliente_id
               WHERE p.tenant_id = v_tenant AND p.ativo AND p.nascimento IS NOT NULL AND p.nascimento <= v_hoje
            ) x
        ) t
       WHERE t.prox BETWEEN v_hoje AND v_hoje + p_janela
         AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = t.id AND k.tipo = 'aniversario' AND k.referencia = t.prox)
    ), '[]'::jsonb);
  END IF;

  IF p_dias IS NULL OR p_dias < 7 OR p_dias > 365 THEN RAISE EXCEPTION 'O prazo precisa ficar entre 7 e 365 dias'; END IF;
  -- o teto de 300 vale para a lista (os mais antigos primeiro), então é aplicado antes de agregar
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'pet_id', x.id, 'pet', x.nome, 'tutor', x.tutor, 'telefone', x.telefone,
             'referencia', x.ultimo, 'dias', v_hoje - x.ultimo) ORDER BY x.ultimo, x.nome)
      FROM (
        SELECT t.*
          FROM (
            SELECT p.id, p.nome, c.nome AS tutor, c.telefone,
                   (SELECT max((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date) FROM public.pet_agendamentos a
                     WHERE a.pet_id = p.id AND a.situacao = 'retirado') AS ultimo
              FROM public.pets p JOIN public.clientes c ON c.id = p.cliente_id
             WHERE p.tenant_id = v_tenant AND p.ativo
               -- já tem atendimento marcado ou em andamento: não precisa de lembrete
               AND NOT EXISTS (SELECT 1 FROM public.pet_agendamentos f WHERE f.pet_id = p.id
                                AND f.situacao IN ('agendado', 'confirmado', 'em_atendimento', 'pronto') AND f.inicio >= now() - interval '1 day')
          ) t
         WHERE t.ultimo IS NOT NULL AND t.ultimo <= v_hoje - p_dias
           AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = t.id AND k.tipo = 'retorno' AND k.referencia = t.ultimo)
         ORDER BY t.ultimo, t.nome
         LIMIT 300
      ) x
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_contatos_pendentes(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_contatos_pendentes(text, integer, integer) TO authenticated;

-- Registrar é idempotente: repetir a mesma ocasião não duplica nem falha.
CREATE OR REPLACE FUNCTION public.pet_contato_registrar(p_pet_id uuid, p_tipo text, p_referencia date, p_canal text DEFAULT 'whatsapp', p_observacao text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_tipo NOT IN ('aniversario', 'retorno') THEN RAISE EXCEPTION 'Tipo de contato inválido'; END IF;
  IF p_canal NOT IN ('whatsapp', 'telefone', 'outro') THEN RAISE EXCEPTION 'Canal inválido'; END IF;
  IF p_referencia IS NULL THEN RAISE EXCEPTION 'Informe a ocasião do contato'; END IF;
  PERFORM 1 FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  INSERT INTO public.pet_contatos (tenant_id, pet_id, tipo, referencia, canal, observacao)
  VALUES (v_tenant, p_pet_id, p_tipo, p_referencia, p_canal, nullif(btrim(p_observacao), ''))
  ON CONFLICT (pet_id, tipo, referencia) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.pet_contato_registrar(uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_contato_registrar(uuid, text, date, text, text) TO authenticated;

-- ===== 20261020000001_pet_pacotes.sql =====
-- Pet shop, Fase 2 (PR 6): pacotes de banho. Cada pacote é de um pet, vale 30, 60 ou 90 dias e é vendido adiantado na
-- frente de caixa. Na hora de retirar o pet, o banho sai do pacote em vez de ser cobrado. A NFS-e do pacote nasce na
-- venda (quando o dinheiro entra); o uso não gera outra nota. A comissão do profissional usa o valor de cada uso.

-- Retirada só com pacote não tem venda no caixa: a comissão passa a aceitar pedido vazio.
ALTER TABLE public.pet_comissoes ALTER COLUMN pedido_id DROP NOT NULL;

-- ============ modelos de pacote ============
CREATE TABLE IF NOT EXISTS public.pet_pacote_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id),
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 2 AND 52),
  preco numeric(14,2) NOT NULL CHECK (preco > 0),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_pacote_modelos_nome_idx ON public.pet_pacote_modelos (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS pet_pacote_modelos_produto_idx ON public.pet_pacote_modelos (produto_id);

-- ============ pacotes vendidos (um por pet) ============
CREATE TABLE IF NOT EXISTS public.pet_pacotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  modelo_id uuid NOT NULL REFERENCES public.pet_pacote_modelos(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  -- o que o tutor pagou pelo pacote (já com a parte do desconto da venda)
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  validade_dias integer NOT NULL CHECK (validade_dias IN (30, 60, 90)),
  comprado_em date NOT NULL,
  vence_em date NOT NULL,
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'cancelado')),
  motivo text,
  venda_id uuid NOT NULL REFERENCES public.pedidos(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venda_id)
);
CREATE INDEX IF NOT EXISTS pet_pacotes_pet_idx ON public.pet_pacotes (tenant_id, pet_id, situacao, vence_em);

-- Cada uso é um banho tirado do pacote; "desfeito" devolve o banho ao saldo.
CREATE TABLE IF NOT EXISTS public.pet_pacote_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pacote_id uuid NOT NULL REFERENCES public.pet_pacotes(id),
  agendamento_id uuid NOT NULL REFERENCES public.pet_agendamentos(id),
  agendamento_item_id uuid NOT NULL REFERENCES public.pet_agendamento_itens(id),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  usado_em date NOT NULL,
  desfeito boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_pacote_usos_item_idx ON public.pet_pacote_usos (agendamento_item_id) WHERE NOT desfeito;
CREATE INDEX IF NOT EXISTS pet_pacote_usos_pacote_idx ON public.pet_pacote_usos (pacote_id) WHERE NOT desfeito;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_pacote_modelos', 'pet_pacotes', 'pet_pacote_usos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER trg_pet_pacote_modelos_updated BEFORE UPDATE ON public.pet_pacote_modelos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
  EXECUTE 'CREATE TRIGGER trg_pet_pacotes_updated BEFORE UPDATE ON public.pet_pacotes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- Quantos banhos ainda restam no pacote.
CREATE OR REPLACE FUNCTION public._pet_pacote_restam(p_pacote_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT p.quantidade - (SELECT count(*)::int FROM public.pet_pacote_usos u WHERE u.pacote_id = p.id AND NOT u.desfeito)
    FROM public.pet_pacotes p WHERE p.id = p_pacote_id
$$;
REVOKE ALL ON FUNCTION public._pet_pacote_restam(uuid) FROM PUBLIC, anon, authenticated;

-- ============ modelo de pacote (cria também o produto sem estoque que vai para o caixa) ============
CREATE OR REPLACE FUNCTION public.pet_pacote_modelo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_serv uuid := nullif(p_dados ->> 'servico_id', '')::uuid;
  v_qtd integer := nullif(p_dados ->> 'quantidade', '')::integer;
  v_preco numeric := nullif(p_dados ->> 'preco', '')::numeric;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_prod uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do pacote'; END IF;
  IF v_qtd IS NULL OR v_qtd < 2 OR v_qtd > 52 THEN RAISE EXCEPTION 'O pacote precisa ter de 2 a 52 serviços'; END IF;
  IF v_preco IS NULL OR v_preco <= 0 THEN RAISE EXCEPTION 'Informe o preço do pacote'; END IF;
  PERFORM 1 FROM public.pet_servicos WHERE id = v_serv AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o serviço do pacote'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_pacote_modelo:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_pacote_modelos m WHERE m.tenant_id = v_tenant AND lower(btrim(m.nome)) = lower(v_nome) AND m.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um pacote com este nome';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque, ativo)
    VALUES (v_tenant, '', v_nome, 'UN', round(v_preco, 2), false, v_ativo) RETURNING id INTO v_prod;
    INSERT INTO public.pet_pacote_modelos (tenant_id, nome, servico_id, quantidade, preco, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_serv, v_qtd, round(v_preco, 2), v_prod, v_ativo) RETURNING id INTO v_id;
  ELSE
    -- pacotes já vendidos guardam o que foi combinado; mudar o modelo vale só para as próximas vendas
    UPDATE public.pet_pacote_modelos SET nome = v_nome, servico_id = v_serv, quantidade = v_qtd, preco = round(v_preco, 2), ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant RETURNING produto_id INTO v_prod;
    IF v_prod IS NULL THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;
    UPDATE public.produtos SET descricao = v_nome, preco_venda = round(v_preco, 2), ativo = v_ativo WHERE id = v_prod AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_pacote_modelo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pacote_modelo_salvar(jsonb) TO authenticated;

-- ============ NFS-e genérica em rascunho (agora usada pelo atendimento e pelo pacote) ============
-- p_itens: [{descricao, valor}] (valores cheios); p_liquido: o que de fato foi cobrado, já com o desconto proporcional.
CREATE OR REPLACE FUNCTION public._pet_nfse_criar(p_cliente_id uuid, p_pedido_id uuid, p_itens jsonb, p_liquido numeric, p_natureza text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ped record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_bruto numeric;
BEGIN
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  SELECT * INTO v_cli FROM public.clientes WHERE id = p_cliente_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_fil_cfg FROM public.fiscal_config WHERE tenant_id = v_tenant AND filial_id = v_ped.filial_id LIMIT 1;
  SELECT * INTO v_emp_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND filial_id IS NULL AND (empresa_id = v_emp.id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;
  IF v_fil_cfg IS NULL AND v_emp_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_emp_cfg;
  END IF;
  -- registro não encontrado vira linha de campos nulos: escolhe pela chave, não por coalesce
  IF v_fil_cfg.id IS NOT NULL THEN v_cfg := v_fil_cfg; ELSE v_cfg := v_emp_cfg; END IF;

  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''), coalesce(v_fil.cidade, v_emp.cidade, ''));

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\D', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do tutor inválido ou ausente');
  END IF;
  IF coalesce(v_emp.cnpj, '') = '' THEN v_pend := array_append(v_pend, 'CNPJ da empresa ausente'); END IF;
  IF coalesce(v_emp.inscricao_municipal, '') = '' THEN
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  END IF;
  IF v_codigo = '' THEN v_pend := array_append(v_pend, 'Código do serviço municipal não configurado'); END IF;
  IF v_iss <= 0 THEN v_pend := array_append(v_pend, 'Alíquota de ISS não configurada'); END IF;
  IF v_cert = '' THEN v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado'); END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    UPDATE public.fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = v_cfg.id;
  END IF;

  SELECT coalesce(sum((i ->> 'valor')::numeric), 0) INTO v_bruto FROM jsonb_array_elements(p_itens) i;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, p_cliente_id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    p_natureza, NULL,
    v_bruto, greatest(v_bruto - p_liquido, 0), p_liquido, round(p_liquido * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj, 'inscricao_municipal', v_emp.inscricao_municipal,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero, 'bairro', v_cli.bairro, 'cidade', v_cli.cidade,
      'estado', v_cli.estado, 'cep', v_cli.cep, 'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      ELSE 'NFS-e em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_pedidos (tenant_id, nfe_id, pedido_id) VALUES (v_tenant, v_nfe, p_pedido_id);

  INSERT INTO public.nfe_itens (tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total, cst_csosn)
  SELECT v_tenant, v_nfe, i ->> 'descricao', 'UN', 1, (i ->> 'valor')::numeric, (i ->> 'valor')::numeric, '400'
    FROM jsonb_array_elements(p_itens) i;

  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN v_nfe;
END $$;
REVOKE ALL ON FUNCTION public._pet_nfse_criar(uuid, uuid, jsonb, numeric, text) FROM PUBLIC, anon, authenticated;

-- ============ venda do pacote: confere a venda do caixa e cria o pacote do pet ============
CREATE OR REPLACE FUNCTION public.pet_pacote_vender(
  p_modelo_id uuid, p_pet_id uuid, p_validade_dias integer, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  m public.pet_pacote_modelos%ROWTYPE;
  pt public.pets%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  v_existente uuid; v_valor numeric; v_id uuid; v_nfe uuid; v_serv text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_validade_dias NOT IN (30, 60, 90) THEN RAISE EXCEPTION 'A validade do pacote é de 30, 60 ou 90 dias'; END IF;
  SELECT * INTO m FROM public.pet_pacote_modelos WHERE id = p_modelo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;
  IF NOT m.ativo THEN RAISE EXCEPTION 'Este pacote não está à venda'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  IF NOT pt.ativo THEN RAISE EXCEPTION 'Este pet está inativo'; END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_pacote_venda:' || v_pedido::text, 0));
  -- repetir a chamada (resposta perdida) devolve o mesmo pacote
  SELECT id INTO v_existente FROM public.pet_pacotes WHERE venda_id = v_pedido;
  IF v_existente IS NOT NULL THEN
    RETURN jsonb_build_object('pacote_id', v_existente, 'repetido', true);
  END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A venda do pacote é feita na frente de caixa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = m.produto_id
                  AND pi.preco_unitario = m.preco AND pi.quantidade = 1) THEN
    RAISE EXCEPTION 'A venda não traz o pacote "%" uma vez, por %', m.nome, m.preco;
  END IF;

  v_valor := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(m.preco * v_ped.total / v_ped.subtotal, 2) ELSE m.preco END;
  INSERT INTO public.pet_pacotes (tenant_id, modelo_id, pet_id, cliente_id, servico_id, quantidade, valor, validade_dias, comprado_em, vence_em, venda_id)
  VALUES (v_tenant, m.id, pt.id, pt.cliente_id, m.servico_id, m.quantidade, v_valor, p_validade_dias, v_hoje, v_hoje + p_validade_dias, v_pedido)
  RETURNING id INTO v_id;

  SELECT nome INTO v_serv FROM public.pet_servicos WHERE id = m.servico_id;
  v_nfe := public._pet_nfse_criar(pt.cliente_id, v_pedido,
             jsonb_build_array(jsonb_build_object('descricao', m.nome || ' (' || m.quantidade || ' x ' || coalesce(v_serv, 'serviço') || ') — ' || pt.nome, 'valor', m.preco)),
             v_valor, 'Prestação de serviço — pacote de banho e tosa de animais');
  RETURN jsonb_build_object('pacote_id', v_id, 'nfe_id', v_nfe, 'vence_em', v_hoje + p_validade_dias, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.pet_pacote_vender(uuid, uuid, integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pacote_vender(uuid, uuid, integer, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_pacote_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF nullif(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  UPDATE public.pet_pacotes SET situacao = 'cancelado', motivo = btrim(p_motivo)
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pacote não encontrado ou já cancelado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_pacote_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pacote_cancelar(uuid, text) TO authenticated;

-- ============ cobertura: quais serviços do atendimento saem de um pacote do pet ============
-- Usa o pacote ativo, dentro da validade e com saldo, que vence primeiro.
CREATE OR REPLACE FUNCTION public._pet_cobertura(p_agendamento_id uuid)
RETURNS TABLE (item_id uuid, servico_id uuid, pacote_id uuid, restam integer, vence_em date, valor_uso numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT i.id, i.servico_id, k.id, k.restam, k.vence_em, round(k.valor / k.quantidade, 2)
    FROM public.pet_agendamento_itens i
    JOIN public.pet_agendamentos a ON a.id = i.agendamento_id
    JOIN LATERAL (
      SELECT p.id, p.vence_em, p.valor, p.quantidade, public._pet_pacote_restam(p.id) AS restam
        FROM public.pet_pacotes p
       WHERE p.tenant_id = a.tenant_id AND p.pet_id = a.pet_id AND p.servico_id = i.servico_id AND p.situacao = 'ativo'
         AND p.vence_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
         AND public._pet_pacote_restam(p.id) > 0
       ORDER BY p.vence_em, p.created_at
       LIMIT 1) k ON true
   WHERE a.id = p_agendamento_id
$$;
REVOKE ALL ON FUNCTION public._pet_cobertura(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pet_agenda_cobertura(p_agendamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM 1 FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'servico_id', c.servico_id, 'pacote_id', c.pacote_id,
                                                      'restam', c.restam, 'vence_em', c.vence_em))
                     FROM public._pet_cobertura(p_agendamento_id) c), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_cobertura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_cobertura(uuid) TO authenticated;

-- ============ retirar e cobrar, agora com pacote ============
DROP FUNCTION IF EXISTS public.pet_agenda_retirar(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._pet_nfse_rascunho(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION public.pet_agenda_retirar(
  p_agendamento_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL, p_usar_pacote boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  a public.pet_agendamentos%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  r record; c record;
  v_cobertos uuid[] := '{}';
  v_pagos jsonb := '[]'::jsonb;
  v_bruto_pago numeric := 0; v_liquido_pago numeric := 0; v_pacote_valor numeric := 0; v_base numeric; v_valor numeric;
  v_nfe uuid; v_avisos jsonb := '[]'::jsonb; v_pet text; v_depois integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  -- o pacote é do pet: dois atendimentos do mesmo pet não podem gastar o mesmo saldo ao mesmo tempo
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_pacote:' || a.pet_id::text, 0));
  IF a.situacao = 'retirado'
     AND ((a.venda_id IS NOT NULL AND (a.venda_id = p_pedido_id OR p_pedido_id IS NULL))
          OR (a.venda_id IS NULL AND p_pedido_id IS NULL AND p_chave IS NULL)) THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    RETURN jsonb_build_object('pedido_id', a.venda_id, 'repetido', true,
      'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = a.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1));
  END IF;
  IF a.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para retirar e cobrar atendimento pronto (situação atual: %)', a.situacao; END IF;

  IF p_usar_pacote THEN
    SELECT coalesce(array_agg(item_id), '{}') INTO v_cobertos FROM public._pet_cobertura(a.id);
  END IF;
  SELECT coalesce(sum(i.preco_aplicado), 0) INTO v_bruto_pago
    FROM public.pet_agendamento_itens i WHERE i.agendamento_id = a.id AND NOT (i.id = ANY (v_cobertos));

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL AND v_bruto_pago > 0 THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;

  IF v_pedido IS NOT NULL THEN
    SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
    IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
    IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
    IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A cobrança do pet shop é feita na frente de caixa'; END IF;
    IF EXISTS (SELECT 1 FROM public.pet_agendamentos o WHERE o.venda_id = v_pedido AND o.id <> a.id)
       OR EXISTS (SELECT 1 FROM public.pet_pacotes pp WHERE pp.venda_id = v_pedido) THEN
      RAISE EXCEPTION 'Esta venda já foi usada em outra cobrança do pet shop';
    END IF;
    -- a venda precisa ter cada serviço cobrado do atendimento, pelo valor combinado
    FOR r IN SELECT i.id, i.preco_aplicado, s.produto_id, s.nome
               FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
              WHERE i.agendamento_id = a.id AND NOT (i.id = ANY (v_cobertos)) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                      AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
        RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
      END IF;
    END LOOP;
    -- o desconto da venda reparte-se por igual entre todos os itens: o serviço fica com a parte proporcional
    v_liquido_pago := CASE WHEN v_bruto_pago = 0 THEN 0
                           WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(v_bruto_pago * v_ped.total / v_ped.subtotal, 2)
                           ELSE v_bruto_pago END;
  END IF;

  UPDATE public.pet_agendamentos SET situacao = 'retirado', venda_id = v_pedido WHERE id = a.id;
  SELECT nome INTO v_pet FROM public.pets WHERE id = a.pet_id;

  -- banhos que saem do pacote
  IF p_usar_pacote THEN
    FOR c IN SELECT * FROM public._pet_cobertura(a.id) LOOP
      INSERT INTO public.pet_pacote_usos (tenant_id, pacote_id, agendamento_id, agendamento_item_id, valor, usado_em)
      VALUES (v_tenant, c.pacote_id, a.id, c.item_id, c.valor_uso, v_hoje);
      v_pacote_valor := v_pacote_valor + c.valor_uso;
      v_depois := c.restam - 1;
      IF v_depois <= 1 THEN
        v_avisos := v_avisos || jsonb_build_object('pacote_id', c.pacote_id, 'pet', v_pet, 'restam', v_depois,
                      'servico', (SELECT nome FROM public.pet_servicos WHERE id = c.servico_id));
      END IF;
    END LOOP;
  END IF;

  -- comissão: serviços cobrados (já com o desconto) mais o valor de cada banho tirado do pacote
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = a.profissional_id;
  v_base := v_liquido_pago + v_pacote_valor;
  v_valor := round(v_base * pf.comissao_percentual / 100, 2);
  IF v_valor > 0 THEN
    INSERT INTO public.pet_comissoes (tenant_id, profissional_id, agendamento_id, pedido_id, base, percentual, valor)
    VALUES (v_tenant, a.profissional_id, a.id, v_pedido, v_base, pf.comissao_percentual, v_valor)
    ON CONFLICT (agendamento_id) DO UPDATE
       SET pedido_id = EXCLUDED.pedido_id, base = EXCLUDED.base, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor,
           situacao = 'a_aprovar', aprovada_em = NULL, aprovada_por = NULL
     WHERE public.pet_comissoes.situacao = 'cancelada';
  END IF;

  -- NFS-e só do que foi cobrado agora (o pacote já teve a nota na venda dele)
  IF v_liquido_pago > 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('descricao', s.nome || ' — ' || v_pet, 'valor', i.preco_aplicado)), '[]'::jsonb) INTO v_pagos
      FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
     WHERE i.agendamento_id = a.id AND NOT (i.id = ANY (v_cobertos));
    v_nfe := public._pet_nfse_criar(a.cliente_id, v_pedido, v_pagos, v_liquido_pago, 'Prestação de serviço — banho, tosa e estética de animais');
  END IF;

  RETURN jsonb_build_object('pedido_id', v_pedido, 'nfe_id', v_nfe, 'comissao', v_valor, 'repetido', false,
                            'usos', coalesce(array_length(v_cobertos, 1), 0), 'avisos', v_avisos);
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid, boolean) TO authenticated;

-- Retirada feita só com pacote (sem venda no caixa) pode ser desfeita pela gestão; com venda, cancela-se a venda.
CREATE OR REPLACE FUNCTION public.pet_agenda_desfazer_retirada(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a public.pet_agendamentos%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao <> 'retirado' THEN RAISE EXCEPTION 'O atendimento não está retirado'; END IF;
  IF a.venda_id IS NOT NULL THEN RAISE EXCEPTION 'Este atendimento foi cobrado no caixa: cancele a venda por lá'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_comissoes WHERE agendamento_id = a.id AND situacao = 'paga') THEN
    RAISE EXCEPTION 'A comissão deste atendimento já foi paga';
  END IF;
  UPDATE public.pet_pacote_usos SET desfeito = true WHERE agendamento_id = a.id AND NOT desfeito;
  UPDATE public.pet_comissoes SET situacao = 'cancelada' WHERE agendamento_id = a.id AND situacao IN ('a_aprovar', 'aprovada');
  UPDATE public.pet_agendamentos SET situacao = 'pronto' WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_desfazer_retirada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_desfazer_retirada(uuid) TO authenticated;

-- Venda cancelada no caixa: atendimento volta a "pronto" (devolvendo o banho ao pacote), comissão não paga é cancelada,
-- pacote vendido nela é cancelado e o rascunho da NFS-e sai.
CREATE OR REPLACE FUNCTION public.pet_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ag boolean; v_pac boolean;
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado' THEN
    v_ag := EXISTS (SELECT 1 FROM public.pet_agendamentos WHERE venda_id = NEW.id);
    v_pac := EXISTS (SELECT 1 FROM public.pet_pacotes WHERE venda_id = NEW.id);
    IF v_ag OR v_pac THEN
      UPDATE public.pet_pacote_usos SET desfeito = true
       WHERE NOT desfeito AND agendamento_id IN (SELECT id FROM public.pet_agendamentos WHERE venda_id = NEW.id);
      UPDATE public.pet_comissoes SET situacao = 'cancelada' WHERE pedido_id = NEW.id AND situacao IN ('a_aprovar', 'aprovada');
      UPDATE public.pet_agendamentos SET situacao = 'pronto', venda_id = NULL WHERE venda_id = NEW.id AND situacao = 'retirado';
      UPDATE public.pet_pacotes SET situacao = 'cancelado', motivo = 'Venda cancelada no caixa' WHERE venda_id = NEW.id AND situacao = 'ativo';
      DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pet_venda_cancelada() FROM PUBLIC, anon, authenticated;

-- ===== 20261021000000_pet_granel.sql =====
-- Pet shop, Fase 2 (PR 7): venda a granel. A ração é comprada em saco (15 kg) e vendida por kg. Cada produto-saco aponta para o
-- produto vendido por kg e guarda quantos kg tem o saco (o fator fica no cadastro do produto). "Abrir saco" baixa o saco inteiro
-- e dá entrada dos kg no granel pelo custo proporcional; a venda por kg segue o fluxo normal (quantidade com casas decimais).

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS granel_produto_id uuid REFERENCES public.produtos(id),
  ADD COLUMN IF NOT EXISTS granel_fator numeric(14,3);
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_granel_chk;
ALTER TABLE public.produtos ADD CONSTRAINT produtos_granel_chk CHECK (
  (granel_produto_id IS NULL AND granel_fator IS NULL)
  OR (granel_produto_id IS NOT NULL AND granel_fator IS NOT NULL AND granel_fator > 0 AND granel_produto_id <> id)
);
CREATE INDEX IF NOT EXISTS produtos_granel_idx ON public.produtos (granel_produto_id) WHERE granel_produto_id IS NOT NULL;

-- O granel precisa ser da mesma empresa, controlar estoque e não ser, ele mesmo, um saco (nada de cadeia saco → granel → saco).
CREATE OR REPLACE FUNCTION public._produto_granel_valida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g record;
BEGIN
  IF NEW.granel_produto_id IS NULL THEN RETURN NEW; END IF;
  IF NOT NEW.controla_estoque THEN RAISE EXCEPTION 'Serviço não tem saco para abrir'; END IF;
  SELECT id, tenant_id, controla_estoque, granel_produto_id INTO g FROM public.produtos WHERE id = NEW.granel_produto_id;
  IF g.id IS NULL OR g.tenant_id <> NEW.tenant_id THEN RAISE EXCEPTION 'Produto a granel não encontrado nesta empresa'; END IF;
  IF NOT g.controla_estoque THEN RAISE EXCEPTION 'O produto a granel precisa controlar estoque'; END IF;
  IF g.granel_produto_id IS NOT NULL THEN RAISE EXCEPTION 'O produto a granel não pode ser, ele mesmo, um saco'; END IF;
  IF EXISTS (SELECT 1 FROM public.produtos o WHERE o.granel_produto_id = NEW.id) THEN
    RAISE EXCEPTION 'Este produto já é o granel de outro saco e não pode ter saco próprio';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._produto_granel_valida() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_produto_granel_valida ON public.produtos;
CREATE TRIGGER trg_produto_granel_valida BEFORE INSERT OR UPDATE OF granel_produto_id, granel_fator, controla_estoque ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public._produto_granel_valida();

-- ============ histórico das aberturas ============
CREATE TABLE IF NOT EXISTS public.granel_aberturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  saco_produto_id uuid NOT NULL REFERENCES public.produtos(id),
  granel_produto_id uuid NOT NULL REFERENCES public.produtos(id),
  deposito_id uuid NOT NULL REFERENCES public.depositos(id),
  sacos integer NOT NULL CHECK (sacos > 0),
  kg numeric(14,3) NOT NULL CHECK (kg > 0),
  custo_saco numeric(14,4) NOT NULL DEFAULT 0,
  custo_kg numeric(14,4) NOT NULL DEFAULT 0,
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS granel_aberturas_idx ON public.granel_aberturas (tenant_id, created_at DESC);

ALTER TABLE public.granel_aberturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.granel_aberturas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.granel_aberturas TO authenticated;
GRANT ALL ON public.granel_aberturas TO service_role;
CREATE POLICY granel_aberturas_ler ON public.granel_aberturas FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.granel_aberturas AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- ============ abrir saco ============
CREATE OR REPLACE FUNCTION public.granel_abrir_saco(p_saco_produto_id uuid, p_deposito_id uuid, p_sacos integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  s record;
  v_custo_saco numeric;
  v_custo_kg numeric;
  v_kg numeric;
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'estoquista']);
  IF p_sacos IS NULL OR p_sacos < 1 OR p_sacos > 1000 THEN RAISE EXCEPTION 'Informe quantos sacos serão abertos (de 1 a 1000)'; END IF;

  SELECT id, descricao, custo, granel_produto_id, granel_fator INTO s
    FROM public.produtos WHERE id = p_saco_produto_id AND tenant_id = v_tenant FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Produto não encontrado nesta empresa'; END IF;
  IF s.granel_produto_id IS NULL THEN RAISE EXCEPTION 'Este produto não tem granel cadastrado: informe o produto vendido por kg e os kg do saco no cadastro'; END IF;
  PERFORM 1 FROM public.depositos WHERE id = p_deposito_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito não encontrado nesta empresa'; END IF;

  -- trava o saldo do saco antes de ler o custo, para duas aberturas seguidas não usarem o mesmo custo
  SELECT coalesce(nullif(e.custo_medio, 0), nullif(s.custo, 0), 0) INTO v_custo_saco
    FROM public.estoques e WHERE e.produto_id = s.id AND e.deposito_id = p_deposito_id FOR UPDATE;
  v_custo_saco := coalesce(v_custo_saco, nullif(s.custo, 0), 0);
  v_kg := p_sacos * s.granel_fator;
  v_custo_kg := round(v_custo_saco / s.granel_fator, 4);

  PERFORM public.registrar_movimentacao_interno(s.id, p_deposito_id, 'saida'::public.mov_tipo, p_sacos,
    'Abertura de saco para venda a granel', 'Abertura de saco');
  PERFORM public.registrar_movimentacao_interno(s.granel_produto_id, p_deposito_id, 'entrada'::public.mov_tipo, v_kg,
    'Abertura de saco para venda a granel', 'Abertura de saco', NULL, nullif(v_custo_kg, 0));

  INSERT INTO public.granel_aberturas (tenant_id, saco_produto_id, granel_produto_id, deposito_id, sacos, kg, custo_saco, custo_kg)
  VALUES (v_tenant, s.id, s.granel_produto_id, p_deposito_id, p_sacos, v_kg, round(v_custo_saco, 4), v_custo_kg)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('abertura_id', v_id, 'kg', v_kg, 'custo_kg', v_custo_kg);
END $$;
REVOKE ALL ON FUNCTION public.granel_abrir_saco(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.granel_abrir_saco(uuid, uuid, integer) TO authenticated;

-- ===== 20261022000000_pet_papel_profissional.sql =====
-- Pet shop, Fase 2 (PR 8): perfil do profissional (banhista, tosador, groomer). Fica em arquivo próprio porque um valor novo
-- de enum só pode ser usado depois de confirmado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'profissional';

-- ===== 20261022000001_pet_agenda_profissional.sql =====
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

-- ===== 20261023000000_clinica_papel_veterinario.sql =====
-- Clínica (Fase 3, PR 1): perfil do veterinário. Fica em arquivo próprio porque um valor novo de enum só pode ser usado depois de confirmado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'veterinario';

-- ===== 20261023000001_clinica_base.sql =====
-- Clínica veterinária (Fase 3, PR 1): base. O veterinário entra com a conta ligada ao cadastro do profissional (com CRMV), no mesmo
-- isolamento do profissional do pet shop: não lê nada da loja nem do restaurante. A leitura do que a clínica precisa (pets, agenda)
-- e o texto clínico chegam no PR 2, só para o perfil veterinário. Serviços ganham as categorias de consulta, vacina e exame.

-- ============ isolamento: veterinário entra na lista dos perfis restritos ============
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
            WHERE r.user_id = auth.uid() AND r.role IN ('garcom', 'cozinha', 'profissional', 'veterinario'))
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role NOT IN ('garcom', 'cozinha', 'profissional', 'veterinario'))
$$;

-- Só profissional e/ou veterinário (sem garçom nem cozinha): ficam de fora também das telas do salão que o garçom enxerga.
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
            WHERE r.user_id = auth.uid() AND r.role IN ('profissional', 'veterinario'))
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role NOT IN ('profissional', 'veterinario'))
$$;

-- ============ liberação da clínica no banco ============
-- Mesma regra do menu (src/lib/cnae-regras.ts): ramo "Clínica veterinária" ou CNAE de atividades veterinárias (7500) entre os CNAEs
-- da empresa. Toda política e função clínica exige isto, para a API chamada direto não contornar a liberação.
CREATE OR REPLACE FUNCTION public.clinica_liberada()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.empresas e
     WHERE e.tenant_id = public.current_tenant_id()
       AND (e.ramo_atividade = 'clinica'
            OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae, '') || ',' || coalesce(e.cnae_secundarios, ''), '[,;\n|]+')) c
                        WHERE regexp_replace(c, '\D', '', 'g') LIKE '7500%')))
$$;
REVOKE ALL ON FUNCTION public.clinica_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_liberada() TO authenticated;

-- ============ CRMV no cadastro do profissional ============
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS crmv text;
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS crmv_uf text;
ALTER TABLE public.pet_profissionais DROP CONSTRAINT IF EXISTS pet_profissionais_crmv_chk;
ALTER TABLE public.pet_profissionais ADD CONSTRAINT pet_profissionais_crmv_chk CHECK (
  (crmv IS NULL AND crmv_uf IS NULL)
  OR (crmv IS NOT NULL AND crmv_uf IS NOT NULL AND crmv ~ '^[0-9A-Z]{3,12}$' AND crmv_uf ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$')
);

-- Veterinário exige CRMV e UF; os demais não guardam CRMV. A conta ligada precisa combinar com a função
-- (veterinário ↔ perfil Veterinário; os outros ↔ perfil Profissional).
CREATE OR REPLACE FUNCTION public.pet_profissional_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_funcao text := coalesce(nullif(p_dados ->> 'funcao', ''), 'tosador');
  v_com numeric := coalesce(nullif(p_dados ->> 'comissao_percentual', '')::numeric, 0);
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_crmv text := upper(regexp_replace(coalesce(p_dados ->> 'crmv', ''), '[^0-9A-Za-z]', '', 'g'));
  v_uf text := upper(btrim(coalesce(p_dados ->> 'crmv_uf', '')));
  v_profile uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do profissional'; END IF;
  IF v_funcao NOT IN ('banhista', 'tosador', 'groomer', 'veterinario', 'auxiliar', 'outro') THEN RAISE EXCEPTION 'Função inválida'; END IF;
  IF v_com < 0 OR v_com > 100 THEN RAISE EXCEPTION 'A comissão precisa ficar entre 0 e 100%%'; END IF;
  IF v_filial IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filiais f WHERE f.id = v_filial AND f.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  IF v_funcao = 'veterinario' THEN
    IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa: informe o CNAE 7500 ou o ramo Clínica veterinária no cadastro da empresa'; END IF;
    IF v_crmv !~ '^[0-9A-Z]{3,12}$' THEN RAISE EXCEPTION 'Informe o CRMV do veterinário'; END IF;
    IF v_uf !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$' THEN
      RAISE EXCEPTION 'Informe a UF do CRMV';
    END IF;
  ELSE
    v_crmv := NULL; v_uf := NULL;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_profissionais (tenant_id, filial_id, nome, funcao, comissao_percentual, ativo, crmv, crmv_uf)
    VALUES (v_tenant, v_filial, v_nome, v_funcao, v_com, coalesce((p_dados ->> 'ativo')::boolean, true), v_crmv, v_uf)
    RETURNING id INTO v_id;
  ELSE
    SELECT profile_id INTO v_profile FROM public.pet_profissionais WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
    -- mudar a função com a conta ligada deixaria o acesso com o perfil errado: a gestão desfaz o vínculo antes
    IF v_profile IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.user_roles r WHERE r.user_id = v_profile AND r.tenant_id = v_tenant
            AND r.role = (CASE WHEN v_funcao = 'veterinario' THEN 'veterinario' ELSE 'profissional' END)::public.app_role) THEN
      RAISE EXCEPTION 'A conta ligada não tem o perfil desta função: desfaça o vínculo da conta antes de mudar a função';
    END IF;
    UPDATE public.pet_profissionais SET filial_id = v_filial, nome = v_nome, funcao = v_funcao, comissao_percentual = v_com,
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true), crmv = v_crmv, crmv_uf = v_uf
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_profissional_vincular(p_profissional_id uuid, p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_funcao text;
  v_papel public.app_role;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  SELECT funcao INTO v_funcao FROM public.pet_profissionais WHERE id = p_profissional_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  v_papel := (CASE WHEN v_funcao = 'veterinario' THEN 'veterinario' ELSE 'profissional' END)::public.app_role;
  IF p_profile_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.tenant_id = p.tenant_id AND r.role = v_papel
     WHERE p.id = p_profile_id AND p.tenant_id = v_tenant AND p.ativo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escolha um usuário ativo desta empresa com o perfil %', CASE WHEN v_papel = 'veterinario' THEN 'Veterinário' ELSE 'Profissional' END;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pet_profissionais x WHERE x.profile_id = p_profile_id AND x.id <> p_profissional_id) THEN
      RAISE EXCEPTION 'Este usuário já está ligado a outro profissional';
    END IF;
  END IF;
  UPDATE public.pet_profissionais SET profile_id = p_profile_id WHERE id = p_profissional_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_vincular(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_vincular(uuid, uuid) TO authenticated;

-- ============ a agenda própria vale também para o veterinário ============
-- Se a empresa deixar de ter a clínica liberada, o veterinário perde também a agenda.
CREATE OR REPLACE FUNCTION public._pet_exige_clinica_se_vet()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pet_profissionais WHERE profile_id = auth.uid() AND tenant_id = public.current_tenant_id() AND funcao = 'veterinario')
     AND NOT public.clinica_liberada() THEN
    RAISE EXCEPTION 'A clínica não está liberada para esta empresa';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._pet_exige_clinica_se_vet() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  f text;
  def text;
  nova text;
BEGIN
  FOREACH f IN ARRAY ARRAY['pet_minha_agenda', 'pet_minha_situacao'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF def IS NULL THEN RAISE EXCEPTION '% não encontrada', f; END IF;
    IF position('''veterinario''' IN def) > 0 THEN CONTINUE; END IF;
    nova := replace(def, 'PERFORM public.exige_papel(ARRAY[''profissional'']);',
      E'PERFORM public.exige_papel(ARRAY[''profissional'', ''veterinario'']);\n  PERFORM public._pet_exige_clinica_se_vet();');
    IF nova = def THEN RAISE EXCEPTION '%: trecho esperado não encontrado', f; END IF;
    EXECUTE nova;
  END LOOP;
END $$;

-- ============ categorias de serviço da clínica ============
ALTER TABLE public.pet_servicos DROP CONSTRAINT IF EXISTS pet_servicos_categoria_check;
ALTER TABLE public.pet_servicos ADD CONSTRAINT pet_servicos_categoria_check
  CHECK (categoria IN ('banho', 'tosa', 'estetica', 'consulta', 'vacina', 'exame', 'outro'));

DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_servico_salvar';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_servico_salvar não encontrada'; END IF;
  IF position('''consulta''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, '(''banho'', ''tosa'', ''estetica'', ''outro'')', '(''banho'', ''tosa'', ''estetica'', ''consulta'', ''vacina'', ''exame'', ''outro'')');
  IF nova = def THEN RAISE EXCEPTION 'pet_servico_salvar: trecho esperado não encontrado'; END IF;
  -- consulta, vacina e exame são da clínica: empresa sem a clínica liberada não cria esses serviços
  def := nova;
  nova := replace(def, 'RAISE EXCEPTION ''Categoria inválida''; END IF;',
    E'RAISE EXCEPTION ''Categoria inválida''; END IF;\n  IF v_cat IN (''consulta'', ''vacina'', ''exame'') AND NOT public.clinica_liberada() THEN RAISE EXCEPTION ''A clínica não está liberada para esta empresa''; END IF;');
  IF nova = def THEN RAISE EXCEPTION 'pet_servico_salvar: trecho da categoria não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- ===== 20261024000000_clinica_prontuario.sql =====
-- Clínica (Fase 3, PR 2): consulta e prontuário. Só o perfil Veterinário lê e escreve o texto clínico, sempre por funções: as tabelas não
-- têm leitura nem escrita direta para ninguém (nem administrador, nem gestor). Atendimento fechado é imutável; correção é adendo.
-- Toda função exige o perfil Veterinário, a clínica liberada (clinica_liberada) e um cadastro de veterinário ativo com CRMV.

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_atendimentos_clinicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  agendamento_id uuid NOT NULL UNIQUE REFERENCES public.pet_agendamentos(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  -- o CRMV vale como estava na abertura, mesmo que o cadastro mude depois
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'fechado')),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_em timestamptz,
  queixa text,
  anamnese text,
  peso_kg numeric(6,2) CHECK (peso_kg > 0 AND peso_kg <= 200),
  temperatura_c numeric(4,1) CHECK (temperatura_c BETWEEN 30 AND 45),
  freq_cardiaca integer CHECK (freq_cardiaca BETWEEN 10 AND 400),
  freq_respiratoria integer CHECK (freq_respiratoria BETWEEN 2 AND 200),
  exame_fisico text,
  diagnostico text,
  conduta text,
  retorno_em date,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((situacao = 'fechado') = (fechado_em IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pet_atend_clin_pet_idx ON public.pet_atendimentos_clinicos (tenant_id, pet_id, aberto_em DESC);

CREATE TABLE IF NOT EXISTS public.pet_atendimento_adendos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  atendimento_id uuid NOT NULL REFERENCES public.pet_atendimentos_clinicos(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  texto text NOT NULL CHECK (length(btrim(texto)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_adendos_atend_idx ON public.pet_atendimento_adendos (atendimento_id, created_at);

-- Quem abriu a ficha de um paciente (sem texto clínico): auditoria de leitura do prontuário.
CREATE TABLE IF NOT EXISTS public.clinica_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  profile_id uuid NOT NULL DEFAULT auth.uid(),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  atendimento_id uuid REFERENCES public.pet_atendimentos_clinicos(id),
  acao text NOT NULL CHECK (acao IN ('historico', 'atendimento', 'alergias')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinica_acessos_idx ON public.clinica_acessos (tenant_id, created_at DESC);

-- ============ imutabilidade ============
CREATE OR REPLACE FUNCTION public._clinica_atendimento_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O prontuário não se apaga'; END IF;
  IF OLD.situacao = 'fechado' THEN RAISE EXCEPTION 'Atendimento fechado não pode ser alterado: registre um adendo'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
     OR NEW.agendamento_id IS DISTINCT FROM OLD.agendamento_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id
     OR NEW.crmv IS DISTINCT FROM OLD.crmv OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.aberto_em IS DISTINCT FROM OLD.aberto_em THEN
    RAISE EXCEPTION 'Estes dados do atendimento não mudam';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_atendimento_guarda ON public.pet_atendimentos_clinicos;
CREATE TRIGGER trg_clinica_atendimento_guarda BEFORE UPDATE OR DELETE ON public.pet_atendimentos_clinicos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_atendimento_guarda();

CREATE OR REPLACE FUNCTION public._clinica_adendo_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O adendo não se altera nem se apaga';
END $$;
DROP TRIGGER IF EXISTS trg_clinica_adendo_guarda ON public.pet_atendimento_adendos;
CREATE TRIGGER trg_clinica_adendo_guarda BEFORE UPDATE OR DELETE ON public.pet_atendimento_adendos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_adendo_guarda();

-- ============ acesso: nenhuma leitura nem escrita direta ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_atendimentos_clinicos', 'pet_atendimento_adendos', 'clinica_acessos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
-- a auditoria de acessos (sem texto clínico) é lida pela gestão
GRANT SELECT ON public.clinica_acessos TO authenticated;
CREATE POLICY clinica_acessos_ler ON public.clinica_acessos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.clinica_liberada()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));

-- ============ apoio ============
-- O veterinário da conta: perfil, clínica liberada e cadastro ativo com CRMV.
CREATE OR REPLACE FUNCTION public._clinica_vet()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v uuid;
BEGIN
  PERFORM public.exige_papel(ARRAY['veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  SELECT id INTO v FROM public.pet_profissionais
   WHERE profile_id = auth.uid() AND tenant_id = public.current_tenant_id() AND ativo AND funcao = 'veterinario' AND crmv IS NOT NULL;
  IF v IS NULL THEN RAISE EXCEPTION 'Sua conta não está ligada a um veterinário ativo com CRMV: peça à gestão'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._clinica_vet() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._clinica_atendimento_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
      'id', a.id, 'pet_id', a.pet_id, 'agendamento_id', a.agendamento_id, 'situacao', a.situacao,
      'aberto_em', a.aberto_em, 'fechado_em', a.fechado_em,
      'veterinario', jsonb_build_object('id', a.veterinario_id, 'nome', v.nome, 'crmv', a.crmv, 'crmv_uf', a.crmv_uf),
      'queixa', a.queixa, 'anamnese', a.anamnese, 'peso_kg', a.peso_kg, 'temperatura_c', a.temperatura_c,
      'freq_cardiaca', a.freq_cardiaca, 'freq_respiratoria', a.freq_respiratoria, 'exame_fisico', a.exame_fisico,
      'diagnostico', a.diagnostico, 'conduta', a.conduta, 'retorno_em', a.retorno_em, 'observacoes', a.observacoes,
      'pet', jsonb_build_object('nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'sexo', pt.sexo, 'pelagem', pt.pelagem,
                                'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado, 'alergias', pt.alergias),
      'tutor', c.nome,
      'adendos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'texto', d.texto, 'created_at', d.created_at, 'veterinario', dv.nome,
                                                                'crmv', d.crmv, 'crmv_uf', d.crmv_uf) ORDER BY d.created_at), '[]'::jsonb)
                    FROM public.pet_atendimento_adendos d JOIN public.pet_profissionais dv ON dv.id = d.veterinario_id
                   WHERE d.atendimento_id = a.id))
    FROM public.pet_atendimentos_clinicos a
    JOIN public.pet_profissionais v ON v.id = a.veterinario_id
    JOIN public.pets pt ON pt.id = a.pet_id
    JOIN public.clientes c ON c.id = a.cliente_id
   WHERE a.id = p_id AND a.tenant_id = public.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION public._clinica_atendimento_json(uuid) FROM PUBLIC, anon, authenticated;

-- ============ buscar paciente ============
CREATE OR REPLACE FUNCTION public.clinica_pacientes(p_busca text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := btrim(coalesce(p_busca, ''));
BEGIN
  PERFORM public._clinica_vet();
  IF length(v_busca) < 2 THEN RAISE EXCEPTION 'Digite ao menos 2 letras do nome do pet ou do tutor'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x ->> 'nome')
      FROM (
        SELECT jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'tutor', c.nome) AS x
          FROM public.pets pt JOIN public.clientes c ON c.id = pt.cliente_id
         WHERE pt.tenant_id = public.current_tenant_id() AND pt.ativo
           AND (pt.nome ILIKE '%' || v_busca || '%' OR c.nome ILIKE '%' || v_busca || '%')
         ORDER BY pt.nome LIMIT 30
      ) q
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_pacientes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_pacientes(text) TO authenticated;

-- ============ abrir o atendimento da consulta agendada ============
-- Idempotente: se já existe, devolve. Só o veterinário da consulta; o agendamento precisa ter um serviço de consulta.
CREATE OR REPLACE FUNCTION public.clinica_atendimento_abrir(p_agendamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  ag public.pet_agendamentos%ROWTYPE;
  v_id uuid;
  v_crmv text; v_uf text;
BEGIN
  SELECT * INTO ag FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant AND profissional_id = v_vet FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada na sua agenda'; END IF;
  SELECT id INTO v_id FROM public.pet_atendimentos_clinicos WHERE agendamento_id = ag.id;
  IF v_id IS NULL THEN
    IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN
      RAISE EXCEPTION 'Esta consulta está "%": não dá para abrir o prontuário', ag.situacao;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                    WHERE i.agendamento_id = ag.id AND s.categoria = 'consulta') THEN
      RAISE EXCEPTION 'Este agendamento não tem serviço de consulta';
    END IF;
    SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
    INSERT INTO public.pet_atendimentos_clinicos (tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf)
    VALUES (v_tenant, ag.pet_id, ag.cliente_id, ag.id, v_vet, v_crmv, v_uf) RETURNING id INTO v_id;
    IF ag.situacao <> 'em_atendimento' THEN
      UPDATE public.pet_agendamentos SET situacao = 'em_atendimento' WHERE id = ag.id;
    END IF;
  END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, ag.pet_id, v_id, 'atendimento');
  RETURN public._clinica_atendimento_json(v_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_abrir(uuid) TO authenticated;

-- ============ preencher (enquanto aberto, só quem abriu) ============
CREATE OR REPLACE FUNCTION public.clinica_atendimento_salvar(p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_atendimentos_clinicos%ROWTYPE;
  v_peso numeric; v_temp numeric; v_fc integer; v_fr integer; v_retorno date;
BEGIN
  SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário que abriu o atendimento preenche'; END IF;
  IF a.situacao <> 'aberto' THEN RAISE EXCEPTION 'Atendimento fechado: registre um adendo'; END IF;
  BEGIN
    v_peso := nullif(replace(btrim(coalesce(p_dados ->> 'peso_kg', '')), ',', '.'), '')::numeric;
    v_temp := nullif(replace(btrim(coalesce(p_dados ->> 'temperatura_c', '')), ',', '.'), '')::numeric;
    v_fc := nullif(btrim(coalesce(p_dados ->> 'freq_cardiaca', '')), '')::integer;
    v_fr := nullif(btrim(coalesce(p_dados ->> 'freq_respiratoria', '')), '')::integer;
    v_retorno := nullif(btrim(coalesce(p_dados ->> 'retorno_em', '')), '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira os números e a data do retorno';
  END;
  IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso > 200) THEN RAISE EXCEPTION 'Peso fora do esperado (até 200 kg)'; END IF;
  IF v_temp IS NOT NULL AND (v_temp < 30 OR v_temp > 45) THEN RAISE EXCEPTION 'Temperatura fora do esperado (30 a 45 °C)'; END IF;
  IF v_fc IS NOT NULL AND (v_fc < 10 OR v_fc > 400) THEN RAISE EXCEPTION 'Frequência cardíaca fora do esperado'; END IF;
  IF v_fr IS NOT NULL AND (v_fr < 2 OR v_fr > 200) THEN RAISE EXCEPTION 'Frequência respiratória fora do esperado'; END IF;
  IF v_retorno IS NOT NULL AND v_retorno < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'O retorno não pode ser no passado'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['queixa', 'anamnese', 'exame_fisico', 'diagnostico', 'conduta', 'observacoes']) k
              WHERE length(coalesce(p_dados ->> k, '')) > 8000) THEN
    RAISE EXCEPTION 'Cada campo de texto aceita até 8000 caracteres';
  END IF;
  UPDATE public.pet_atendimentos_clinicos SET
      queixa = nullif(btrim(coalesce(p_dados ->> 'queixa', '')), ''),
      anamnese = nullif(btrim(coalesce(p_dados ->> 'anamnese', '')), ''),
      exame_fisico = nullif(btrim(coalesce(p_dados ->> 'exame_fisico', '')), ''),
      diagnostico = nullif(btrim(coalesce(p_dados ->> 'diagnostico', '')), ''),
      conduta = nullif(btrim(coalesce(p_dados ->> 'conduta', '')), ''),
      observacoes = nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''),
      peso_kg = v_peso, temperatura_c = v_temp, freq_cardiaca = v_fc, freq_respiratoria = v_fr, retorno_em = v_retorno
   WHERE id = a.id;
  RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_salvar(uuid, jsonb) TO authenticated;

-- ============ fechar: fica imutável e a consulta vai para "pronto" (a recepção cobra) ============
CREATE OR REPLACE FUNCTION public.clinica_atendimento_fechar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_atendimentos_clinicos%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário que abriu o atendimento fecha'; END IF;
  IF a.situacao <> 'aberto' THEN RAISE EXCEPTION 'Este atendimento já está fechado'; END IF;
  IF a.queixa IS NULL THEN RAISE EXCEPTION 'Preencha a queixa antes de fechar'; END IF;
  IF a.conduta IS NULL THEN RAISE EXCEPTION 'Preencha a conduta antes de fechar'; END IF;
  UPDATE public.pet_atendimentos_clinicos SET situacao = 'fechado', fechado_em = now() WHERE id = a.id;
  UPDATE public.pet_agendamentos SET situacao = 'pronto' WHERE id = a.agendamento_id AND situacao = 'em_atendimento';
  RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_fechar(uuid) TO authenticated;

-- ============ adendo: correção ou complemento de atendimento fechado, por qualquer veterinário da clínica (identificado) ============
CREATE OR REPLACE FUNCTION public.clinica_adendo_criar(p_atendimento_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_texto text := btrim(coalesce(p_texto, ''));
  a public.pet_atendimentos_clinicos%ROWTYPE;
  v_crmv text; v_uf text;
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Escreva o adendo'; END IF;
  IF length(v_texto) > 8000 THEN RAISE EXCEPTION 'O adendo aceita até 8000 caracteres'; END IF;
  SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_atendimento_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  IF a.situacao <> 'fechado' THEN RAISE EXCEPTION 'Adendo só em atendimento fechado: edite o atendimento aberto'; END IF;
  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
  INSERT INTO public.pet_atendimento_adendos (tenant_id, atendimento_id, veterinario_id, crmv, crmv_uf, texto)
  VALUES (a.tenant_id, a.id, v_vet, v_crmv, v_uf, v_texto);
  RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_adendo_criar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_adendo_criar(uuid, text) TO authenticated;

-- ============ ficha do paciente: dados do pet e histórico de atendimentos ============
CREATE OR REPLACE FUNCTION public.clinica_historico(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  v_tutor text;
BEGIN
  PERFORM public._clinica_vet();
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT nome INTO v_tutor FROM public.clientes WHERE id = pt.cliente_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'historico');
  RETURN jsonb_build_object(
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'sexo', pt.sexo,
                              'pelagem', pt.pelagem, 'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado,
                              'alergias', pt.alergias, 'observacoes', pt.observacoes),
    'tutor', v_tutor,
    'atendimentos', coalesce((SELECT jsonb_agg(public._clinica_atendimento_json(a.id) ORDER BY a.aberto_em DESC)
                                FROM public.pet_atendimentos_clinicos a WHERE a.pet_id = pt.id AND a.tenant_id = v_tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_historico(uuid) TO authenticated;

-- A alergia do cadastro do pet aparece na agenda do banho: o veterinário a atualiza por aqui (a recepção não edita texto clínico).
CREATE OR REPLACE FUNCTION public.clinica_pet_alergias(p_pet_id uuid, p_alergias text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_texto text := nullif(btrim(coalesce(p_alergias, '')), '');
BEGIN
  PERFORM public._clinica_vet();
  IF length(coalesce(v_texto, '')) > 1000 THEN RAISE EXCEPTION 'A alergia aceita até 1000 caracteres'; END IF;
  UPDATE public.pets SET alergias = v_texto WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, p_pet_id, 'alergias');
END $$;
REVOKE ALL ON FUNCTION public.clinica_pet_alergias(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_pet_alergias(uuid, text) TO authenticated;

-- ============ a agenda do veterinário diz a categoria de cada serviço (para abrir o prontuário só da consulta) ============
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_minha_agenda';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_minha_agenda não encontrada'; END IF;
  IF position('''categoria''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, '''nome'', s.nome, ''duracao_min'', i.duracao_min', '''nome'', s.nome, ''categoria'', s.categoria, ''duracao_min'', i.duracao_min');
  IF nova = def THEN RAISE EXCEPTION 'pet_minha_agenda: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- ===== 20261025000000_clinica_vacinas.sql =====
-- Clínica (Fase 3, PR 3): vacinas e vermífugos. A clínica mantém o catálogo (com o intervalo de reforço); o veterinário registra a aplicação
-- dentro do atendimento agendado do serviço de vacina, escolhendo o lote (baixa 1 dose do lote e do estoque); vacina feita em outro lugar
-- entra no cartão sem baixa. A aplicação não se apaga nem se reescreve: erro vira cancelamento com motivo, que devolve a dose ao lote.
-- O item cobrável é o serviço da agenda; o produto do catálogo só serve para baixar o lote e nunca vai para a venda.
-- Nenhuma tabela tem acesso direto: tudo passa por funções que exigem a clínica liberada (clinica_liberada).

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_vacinas_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  tipo text NOT NULL CHECK (tipo IN ('vacina', 'vermifugo')),
  especie text NOT NULL DEFAULT 'todas' CHECK (especie IN ('cao', 'gato', 'todas')),
  doses_serie integer NOT NULL DEFAULT 1 CHECK (doses_serie BETWEEN 1 AND 10),
  intervalo_serie_dias integer CHECK (intervalo_serie_dias BETWEEN 1 AND 365),
  reforco_dias integer NOT NULL CHECK (reforco_dias BETWEEN 1 AND 1100),
  idade_minima_dias integer CHECK (idade_minima_dias BETWEEN 0 AND 3650),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (doses_serie = 1 OR intervalo_serie_dias IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_vacinas_catalogo_nome_idx ON public.pet_vacinas_catalogo (tenant_id, lower(btrim(nome)), especie);

CREATE TABLE IF NOT EXISTS public.pet_vacinacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  catalogo_id uuid NOT NULL REFERENCES public.pet_vacinas_catalogo(id),
  -- nome e tipo como estavam quando foi aplicada
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('vacina', 'vermifugo')),
  origem text NOT NULL CHECK (origem IN ('clinica', 'outro_local')),
  dose_tipo text NOT NULL CHECK (dose_tipo IN ('serie', 'reforco')),
  dose_numero integer NOT NULL CHECK (dose_numero >= 1),
  aplicada_em date NOT NULL,
  proxima_dose_em date,
  -- só aplicação da clínica
  agendamento_id uuid REFERENCES public.pet_agendamentos(id),
  veterinario_id uuid REFERENCES public.pet_profissionais(id),
  aplicador_id uuid REFERENCES public.pet_profissionais(id),
  estoque_lote_id uuid REFERENCES public.estoque_lotes(id),
  deposito_id uuid REFERENCES public.depositos(id),
  lote text,
  validade_lote date,
  local_aplicacao text,
  -- só aplicação de outro local
  informado_por text,
  registrado_por uuid DEFAULT auth.uid(),
  observacoes text,
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'cancelada')),
  cancelada_em timestamptz,
  cancelada_motivo text,
  cancelada_por uuid,
  -- relógio real (não o da transação): duas aplicações do mesmo atendimento mantêm a ordem em que foram feitas
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((situacao = 'cancelada') = (cancelada_em IS NOT NULL)),
  CHECK (origem <> 'clinica' OR (agendamento_id IS NOT NULL AND veterinario_id IS NOT NULL AND estoque_lote_id IS NOT NULL AND lote IS NOT NULL)),
  CHECK (origem <> 'outro_local' OR (informado_por IS NOT NULL AND estoque_lote_id IS NULL AND agendamento_id IS NULL))
);
CREATE INDEX IF NOT EXISTS pet_vacinacoes_pet_idx ON public.pet_vacinacoes (tenant_id, pet_id, aplicada_em DESC);
CREATE INDEX IF NOT EXISTS pet_vacinacoes_proxima_idx ON public.pet_vacinacoes (tenant_id, proxima_dose_em) WHERE situacao = 'ativa';

-- A aplicação só muda para ser cancelada (com motivo); nunca se apaga.
CREATE OR REPLACE FUNCTION public._clinica_vacinacao_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A aplicação de vacina não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'cancelada' THEN RAISE EXCEPTION 'Aplicação cancelada não muda'; END IF;
  IF NEW.situacao <> 'cancelada' OR coalesce(btrim(NEW.cancelada_motivo), '') = '' THEN
    RAISE EXCEPTION 'A aplicação só muda para ser cancelada, com motivo';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por')
     IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por') THEN
    RAISE EXCEPTION 'Os dados da aplicação não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_vacinacao_guarda ON public.pet_vacinacoes;
CREATE TRIGGER trg_clinica_vacinacao_guarda BEFORE UPDATE OR DELETE ON public.pet_vacinacoes
  FOR EACH ROW EXECUTE FUNCTION public._clinica_vacinacao_guarda();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_vacinas_catalogo', 'pet_vacinacoes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER trg_pet_vacinas_catalogo_updated BEFORE UPDATE ON public.pet_vacinas_catalogo FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- ============ apoio ============
-- Perfil e clínica liberada, para quem consulta (gestão, veterinário e recepção).
CREATE OR REPLACE FUNCTION public._clinica_exige_leitura()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exige_leitura() FROM PUBLIC, anon, authenticated;

-- A baixa de estoque da dose. O veterinário é um perfil restrito (como o garçom), e o movimento de estoque recusa perfil restrito:
-- aqui a função da clínica, que já conferiu perfil, clínica liberada e lote, liga um aviso só desta transação para o movimento aceitar.
-- Quem chama o movimento por fora (a função pública de estoque) continua barrado pela própria trava dela, então o aviso não abre nada.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'registrar_movimentacao_interno';
  IF def IS NULL THEN RAISE EXCEPTION 'registrar_movimentacao_interno não encontrada'; END IF;
  IF position('app.clinica_baixa' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, E'  PERFORM public.exige_nao_salao();\n',
    E'  IF coalesce(current_setting(''app.clinica_baixa'', true), '''') <> ''on'' THEN PERFORM public.exige_nao_salao(); END IF;\n');
  IF nova = def THEN RAISE EXCEPTION 'registrar_movimentacao_interno: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

CREATE OR REPLACE FUNCTION public._clinica_movimentar_dose(p_produto_id uuid, p_deposito_id uuid, p_tipo public.mov_tipo, p_motivo text, p_documento text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.clinica_baixa', 'on', true);
  PERFORM public.registrar_movimentacao_interno(p_produto_id, p_deposito_id, p_tipo, 1, p_motivo, p_documento);
  PERFORM set_config('app.clinica_baixa', 'off', true);
END $$;
REVOKE ALL ON FUNCTION public._clinica_movimentar_dose(uuid, uuid, public.mov_tipo, text, text) FROM PUBLIC, anon, authenticated;

-- Qual é a próxima dose do pet para um item do catálogo: ainda na série, ou reforço.
CREATE OR REPLACE FUNCTION public._clinica_proxima_dose(p_pet_id uuid, p_catalogo_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN n < c.doses_serie THEN jsonb_build_object('dose_tipo', 'serie', 'dose_numero', n + 1)
              ELSE jsonb_build_object('dose_tipo', 'reforco', 'dose_numero', n - c.doses_serie + 1) END
    FROM public.pet_vacinas_catalogo c,
         LATERAL (SELECT count(*)::int AS n FROM public.pet_vacinacoes v WHERE v.pet_id = p_pet_id AND v.catalogo_id = c.id AND v.situacao = 'ativa') q
   WHERE c.id = p_catalogo_id
$$;
REVOKE ALL ON FUNCTION public._clinica_proxima_dose(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============ catálogo ============
CREATE OR REPLACE FUNCTION public.clinica_vacinas_catalogo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_exige_leitura();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'especie', c.especie, 'doses_serie', c.doses_serie,
             'intervalo_serie_dias', c.intervalo_serie_dias, 'reforco_dias', c.reforco_dias, 'idade_minima_dias', c.idade_minima_dias,
             'produto_id', c.produto_id, 'produto', p.descricao, 'ativo', c.ativo) ORDER BY c.nome)
      FROM public.pet_vacinas_catalogo c JOIN public.produtos p ON p.id = c.produto_id
     WHERE c.tenant_id = public.current_tenant_id()
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacinas_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacinas_catalogo() TO authenticated;

-- A clínica edita o catálogo: gestão e veterinário. O produto precisa controlar estoque (a dose baixa o lote).
CREATE OR REPLACE FUNCTION public.clinica_vacina_catalogo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'vacina');
  v_especie text := coalesce(nullif(p_dados ->> 'especie', ''), 'todas');
  v_doses integer;
  v_inter integer;
  v_reforco integer;
  v_idade integer;
  v_prod uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  BEGIN
    v_doses := coalesce(nullif(p_dados ->> 'doses_serie', '')::integer, 1);
    v_inter := nullif(p_dados ->> 'intervalo_serie_dias', '')::integer;
    v_reforco := nullif(p_dados ->> 'reforco_dias', '')::integer;
    v_idade := nullif(p_dados ->> 'idade_minima_dias', '')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Confira os números do catálogo';
  END;
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome'; END IF;
  IF v_tipo NOT IN ('vacina', 'vermifugo') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF v_especie NOT IN ('cao', 'gato', 'todas') THEN RAISE EXCEPTION 'Espécie inválida'; END IF;
  IF v_doses < 1 OR v_doses > 10 THEN RAISE EXCEPTION 'A série tem de 1 a 10 doses'; END IF;
  IF v_doses > 1 AND (v_inter IS NULL OR v_inter < 1 OR v_inter > 365) THEN RAISE EXCEPTION 'Informe o intervalo entre as doses da série (1 a 365 dias)'; END IF;
  IF v_doses = 1 THEN v_inter := NULL; END IF;
  IF v_reforco IS NULL OR v_reforco < 1 OR v_reforco > 1100 THEN RAISE EXCEPTION 'Informe o intervalo do reforço em dias (1 a 1100)'; END IF;
  IF v_idade IS NOT NULL AND (v_idade < 0 OR v_idade > 3650) THEN RAISE EXCEPTION 'Idade mínima inválida'; END IF;
  PERFORM 1 FROM public.produtos WHERE id = v_prod AND tenant_id = v_tenant AND controla_estoque AND controla_lote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o produto da dose: um produto de estoque desta empresa que controle lote'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_vacina:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_vacinas_catalogo c WHERE c.tenant_id = v_tenant AND lower(btrim(c.nome)) = lower(v_nome)
                AND c.especie = v_especie AND c.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um item com este nome para esta espécie';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_vacinas_catalogo (tenant_id, nome, tipo, especie, doses_serie, intervalo_serie_dias, reforco_dias, idade_minima_dias, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_tipo, v_especie, v_doses, v_inter, v_reforco, v_idade, v_prod, v_ativo) RETURNING id INTO v_id;
  ELSE
    -- aplicações antigas guardam nome e tipo como foram feitas; mudar o catálogo vale para as próximas
    UPDATE public.pet_vacinas_catalogo SET nome = v_nome, tipo = v_tipo, especie = v_especie, doses_serie = v_doses, intervalo_serie_dias = v_inter,
           reforco_dias = v_reforco, idade_minima_dias = v_idade, produto_id = v_prod, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item do catálogo não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_catalogo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_catalogo_salvar(jsonb) TO authenticated;

-- ============ apoio do veterinário na aplicação ============
-- Lotes com saldo, com validade registrada e dentro dela, nos depósitos da filial do veterinário (ele não lê o estoque direto).
CREATE OR REPLACE FUNCTION public.clinica_lotes_vacina(p_catalogo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._clinica_vet();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', l.id, 'lote', l.lote, 'validade', l.validade, 'quantidade', l.quantidade,
                                         'deposito', d.nome, 'deposito_id', l.deposito_id) ORDER BY l.validade NULLS LAST, l.lote)
      FROM public.pet_vacinas_catalogo c
      JOIN public.estoque_lotes l ON l.produto_id = c.produto_id AND l.tenant_id = c.tenant_id
      JOIN public.depositos d ON d.id = l.deposito_id
     WHERE c.id = p_catalogo_id AND c.tenant_id = public.current_tenant_id()
       -- vacina sem validade registrada não é aplicada; e só os depósitos da filial do veterinário
       AND l.quantidade >= 1 AND l.validade IS NOT NULL AND l.validade >= v_hoje AND public.pode_filial(d.filial_id)
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_lotes_vacina(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_lotes_vacina(uuid) TO authenticated;

-- Quem pode ser o aplicador sob a responsabilidade do veterinário.
CREATE OR REPLACE FUNCTION public.clinica_aplicadores()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_vet();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'funcao', p.funcao) ORDER BY p.nome)
                     FROM public.pet_profissionais p
                    WHERE p.tenant_id = public.current_tenant_id() AND p.ativo AND p.funcao IN ('veterinario', 'auxiliar')), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_aplicadores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_aplicadores() TO authenticated;

-- ============ aplicar (dentro do atendimento agendado do serviço de vacina) ============
-- p_dados: catalogo_id, estoque_lote_id, aplicada_em (opcional, padrão hoje), aplicador_id (opcional), local_aplicacao, observacoes,
-- proxima_dose_em (opcional: se vier vazio fica sem próxima dose; se não vier, calcula). Devolve a aplicação e avisos que não bloqueiam.
CREATE OR REPLACE FUNCTION public.clinica_vacina_aplicar(p_agendamento_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_prox date;
  v_dose jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_id uuid;
  v_idade integer;
  v_depois integer;
BEGIN
  SELECT * INTO ag FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant AND profissional_id = v_vet FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado na sua agenda'; END IF;
  IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN
    RAISE EXCEPTION 'Este atendimento está "%": não dá para registrar vacina', ag.situacao;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                  WHERE i.agendamento_id = ag.id AND s.categoria = 'vacina') THEN
    RAISE EXCEPTION 'Este agendamento não tem serviço de vacina';
  END IF;
  IF v_em > v_hoje THEN RAISE EXCEPTION 'A aplicação não pode ser no futuro'; END IF;
  IF v_em < v_hoje - 7 THEN RAISE EXCEPTION 'Para vacina de outra data use o registro de vacina aplicada em outro local'; END IF;

  SELECT * INTO c FROM public.pet_vacinas_catalogo WHERE id = v_cat AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha a vacina ou o vermífugo do catálogo'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = ag.pet_id;
  IF c.especie <> 'todas' AND c.especie <> pt.especie THEN RAISE EXCEPTION '% não é indicada para esta espécie', c.nome; END IF;

  IF v_aplicador IS NOT NULL THEN
    PERFORM 1 FROM public.pet_profissionais WHERE id = v_aplicador AND tenant_id = v_tenant AND ativo AND funcao IN ('veterinario', 'auxiliar');
    IF NOT FOUND THEN RAISE EXCEPTION 'Aplicador não encontrado (veterinário ou auxiliar ativo)'; END IF;
  END IF;

  -- o lote precisa ser do produto do item, ter dose e estar na validade; trava o lote antes de baixar
  SELECT * INTO l FROM public.estoque_lotes WHERE id = v_lote AND tenant_id = v_tenant AND produto_id = c.produto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um lote deste produto'; END IF;
  IF l.validade IS NULL THEN RAISE EXCEPTION 'O lote % não tem validade registrada: corrija o lote no estoque', l.lote; END IF;
  IF l.validade < v_em THEN RAISE EXCEPTION 'O lote % está vencido', l.lote; END IF;
  PERFORM 1 FROM public.depositos d WHERE d.id = l.deposito_id AND public.pode_filial(d.filial_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'O lote % está em depósito de outra filial', l.lote; END IF;
  IF l.quantidade < 1 THEN RAISE EXCEPTION 'O lote % não tem saldo', l.lote; END IF;

  v_dose := public._clinica_proxima_dose(pt.id, c.id);
  -- ainda na série: a próxima é a seguinte da série; a última dose da série (e as de reforço) já agenda o reforço
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

  -- avisos que não bloqueiam: idade mínima e dose repetida no mesmo dia
  IF c.idade_minima_dias IS NOT NULL AND pt.nascimento IS NOT NULL THEN
    v_idade := v_em - pt.nascimento;
    IF v_idade < c.idade_minima_dias THEN
      v_avisos := v_avisos || to_jsonb(format('O pet tem %s dias e a idade mínima do item é %s dias: confirme a indicação.', v_idade, c.idade_minima_dias));
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_vacinacoes v WHERE v.pet_id = pt.id AND v.catalogo_id = c.id AND v.situacao = 'ativa' AND v.aplicada_em = v_em) THEN
    v_avisos := v_avisos || to_jsonb('Já existe uma aplicação deste item para o pet nesta data.'::text);
  END IF;

  -- baixa 1 dose do lote e do estoque
  UPDATE public.estoque_lotes SET quantidade = quantidade - 1, updated_at = now() WHERE id = l.id;
  INSERT INTO public.estoque_lote_movimentos (tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
  VALUES (v_tenant, l.id, 'saida', 1, l.quantidade - 1, 'Vacinação ' || pt.nome, 'Aplicação na clínica');
  PERFORM public._clinica_movimentar_dose(c.produto_id, l.deposito_id, 'saida'::public.mov_tipo, 'Aplicação na clínica', 'Vacinação ' || pt.nome);

  INSERT INTO public.pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em,
      agendamento_id, veterinario_id, aplicador_id, estoque_lote_id, deposito_id, lote, validade_lote, local_aplicacao, observacoes)
  VALUES (v_tenant, pt.id, c.id, c.nome, c.tipo, 'clinica', v_dose ->> 'dose_tipo', (v_dose ->> 'dose_numero')::int, v_em, v_prox,
      ag.id, v_vet, coalesce(v_aplicador, v_vet), l.id, l.deposito_id, l.lote, l.validade,
      nullif(btrim(coalesce(p_dados ->> 'local_aplicacao', '')), ''), nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''))
  RETURNING id INTO v_id;

  IF ag.situacao <> 'em_atendimento' THEN UPDATE public.pet_agendamentos SET situacao = 'em_atendimento' WHERE id = ag.id; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'vacinacao');
  RETURN jsonb_build_object('id', v_id, 'dose_tipo', v_dose ->> 'dose_tipo', 'dose_numero', (v_dose ->> 'dose_numero')::int,
                            'proxima_dose_em', v_prox, 'avisos', v_avisos);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_aplicar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_aplicar(uuid, jsonb) TO authenticated;

-- ============ aplicada em outro local: entra no cartão sem baixa de estoque ============
CREATE OR REPLACE FUNCTION public.clinica_vacina_registrar_externa(p_pet_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  pt public.pets%ROWTYPE;
  c public.pet_vacinas_catalogo%ROWTYPE;
  v_em date;
  v_prox date;
  v_dose jsonb;
  v_informado text := nullif(btrim(coalesce(p_dados ->> 'informado_por', '')), '');
  v_id uuid;
BEGIN
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT * INTO c FROM public.pet_vacinas_catalogo WHERE id = nullif(p_dados ->> 'catalogo_id', '')::uuid AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha a vacina ou o vermífugo do catálogo'; END IF;
  IF v_informado IS NULL THEN RAISE EXCEPTION 'Informe quem passou a informação (tutor, carteira, outra clínica)'; END IF;
  BEGIN
    v_em := (p_dados ->> 'aplicada_em')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Data da aplicação inválida';
  END;
  IF v_em IS NULL THEN RAISE EXCEPTION 'Informe a data da aplicação'; END IF;
  IF v_em > v_hoje THEN RAISE EXCEPTION 'A aplicação não pode ser no futuro'; END IF;
  IF pt.nascimento IS NOT NULL AND v_em < pt.nascimento THEN RAISE EXCEPTION 'A aplicação é anterior ao nascimento do pet'; END IF;

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

  INSERT INTO public.pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em,
      lote, informado_por, observacoes)
  VALUES (v_tenant, pt.id, c.id, c.nome, c.tipo, 'outro_local', v_dose ->> 'dose_tipo', (v_dose ->> 'dose_numero')::int, v_em, v_prox,
      nullif(btrim(coalesce(p_dados ->> 'lote', '')), ''), v_informado, nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''))
  RETURNING id INTO v_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'vacinacao');
  RETURN jsonb_build_object('id', v_id, 'dose_tipo', v_dose ->> 'dose_tipo', 'dose_numero', (v_dose ->> 'dose_numero')::int, 'proxima_dose_em', v_prox);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_registrar_externa(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_registrar_externa(uuid, jsonb) TO authenticated;

-- ============ cancelar (erro de registro): devolve a dose ao lote e ao estoque ============
CREATE OR REPLACE FUNCTION public.clinica_vacina_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  a public.pet_vacinacoes%ROWTYPE;
  l public.estoque_lotes%ROWTYPE;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO a FROM public.pet_vacinacoes WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aplicação não encontrada'; END IF;
  IF a.situacao <> 'ativa' THEN RAISE EXCEPTION 'Esta aplicação já está cancelada'; END IF;
  IF a.origem = 'clinica' THEN
    SELECT * INTO l FROM public.estoque_lotes WHERE id = a.estoque_lote_id FOR UPDATE;
    UPDATE public.estoque_lotes SET quantidade = quantidade + 1, updated_at = now() WHERE id = l.id;
    INSERT INTO public.estoque_lote_movimentos (tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
    VALUES (v_tenant, l.id, 'entrada', 1, l.quantidade + 1, 'Cancelamento de vacinação', v_motivo);
    PERFORM public._clinica_movimentar_dose(l.produto_id, a.deposito_id, 'entrada'::public.mov_tipo, 'Cancelamento de vacinação: ' || v_motivo, 'Cancelamento de vacinação');
  END IF;
  UPDATE public.pet_vacinacoes SET situacao = 'cancelada', cancelada_em = now(), cancelada_motivo = v_motivo, cancelada_por = auth.uid() WHERE id = a.id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, a.pet_id, 'vacinacao');
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_cancelar(uuid, text) TO authenticated;

-- ============ cartão de vacinação ============
-- Documento do pet, sem texto do prontuário: gestão, veterinário e recepção leem e imprimem.
CREATE OR REPLACE FUNCTION public.clinica_cartao_vacinacao(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  v_tutor text;
  v_clinica text;
BEGIN
  PERFORM public._clinica_exige_leitura();
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT nome INTO v_tutor FROM public.clientes WHERE id = pt.cliente_id;
  SELECT coalesce(nullif(e.nome_fantasia, ''), e.razao_social) INTO v_clinica FROM public.empresas e WHERE e.tenant_id = v_tenant ORDER BY e.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'clinica', v_clinica,
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'nascimento', pt.nascimento),
    'tutor', v_tutor,
    'aplicacoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'nome', v.nome, 'tipo', v.tipo, 'origem', v.origem, 'dose_tipo', v.dose_tipo,
               'dose_numero', v.dose_numero, 'aplicada_em', v.aplicada_em, 'proxima_dose_em', v.proxima_dose_em, 'lote', v.lote,
               'validade_lote', v.validade_lote, 'informado_por', v.informado_por,
               'veterinario', vet.nome, 'crmv', vet.crmv, 'crmv_uf', vet.crmv_uf, 'aplicador', ap.nome) ORDER BY v.aplicada_em DESC, v.created_at DESC)
        FROM public.pet_vacinacoes v
        LEFT JOIN public.pet_profissionais vet ON vet.id = v.veterinario_id
        LEFT JOIN public.pet_profissionais ap ON ap.id = v.aplicador_id
       WHERE v.pet_id = pt.id AND v.tenant_id = v_tenant AND v.situacao = 'ativa'), '[]'::jsonb),
    -- próxima dose de cada item: a da aplicação mais recente
    'proximas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('nome', x.nome, 'tipo', x.tipo, 'proxima_dose_em', x.proxima_dose_em) ORDER BY x.proxima_dose_em)
        FROM (SELECT DISTINCT ON (v.catalogo_id) v.nome, v.tipo, v.proxima_dose_em
                FROM public.pet_vacinacoes v
               WHERE v.pet_id = pt.id AND v.tenant_id = v_tenant AND v.situacao = 'ativa'
               ORDER BY v.catalogo_id, v.aplicada_em DESC, v.created_at DESC) x
       WHERE x.proxima_dose_em IS NOT NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_cartao_vacinacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_cartao_vacinacao(uuid) TO authenticated;

-- ============ auditoria: a ação "vacinacao" ============
ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao'));

-- ============ a agenda do veterinário informa o paciente (para abrir as vacinas dele) ============
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_minha_agenda';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_minha_agenda não encontrada'; END IF;
  IF position('''id'', pt.id' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, '''pet'', jsonb_build_object(''nome'', pt.nome,', '''pet'', jsonb_build_object(''id'', pt.id, ''nome'', pt.nome,');
  IF nova = def THEN RAISE EXCEPTION 'pet_minha_agenda: trecho do paciente não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- ===== 20261026000000_clinica_reforcos.sql =====
-- Clínica (Fase 3, PR 4): reforços. A recepção vê quais pets estão com vacina ou vermífugo para tomar (ou atrasado), chama no WhatsApp
-- ou marca "já falei", e o pet sai da lista naquela data. Reaproveita os contatos do pet shop (pet_contatos, tipo "reforco").
-- A lista traz só o nome do item e a data: nada do prontuário. Sem envio automático: o clique é da recepção.

ALTER TABLE public.pet_contatos DROP CONSTRAINT IF EXISTS pet_contatos_tipo_check;
ALTER TABLE public.pet_contatos ADD CONSTRAINT pet_contatos_tipo_check CHECK (tipo IN ('aniversario', 'retorno', 'reforco'));

-- Registrar contato de reforço também exige a clínica liberada.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_contato_registrar';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_contato_registrar não encontrada'; END IF;
  IF position('''reforco''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, E'IF p_tipo NOT IN (''aniversario'', ''retorno'') THEN RAISE EXCEPTION ''Tipo de contato inválido''; END IF;',
    E'IF p_tipo NOT IN (''aniversario'', ''retorno'', ''reforco'') THEN RAISE EXCEPTION ''Tipo de contato inválido''; END IF;\n'
    || E'  IF p_tipo = ''reforco'' AND NOT public.clinica_liberada() THEN RAISE EXCEPTION ''A clínica não está liberada para esta empresa''; END IF;');
  IF nova = def THEN RAISE EXCEPTION 'pet_contato_registrar: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- Pets com vacina/vermífugo a tomar nos próximos p_janela dias ou atrasado até p_atraso dias. Uma linha por pet e data, com os itens daquela data.
-- Vale a aplicação mais recente de cada item (aplicação cancelada não conta; "sem próxima dose" tira o item da lista); item inativo no
-- catálogo e pet com vacina já agendada não entram; quem já foi chamado para aquela data sai.
CREATE OR REPLACE FUNCTION public.clinica_reforcos_pendentes(p_janela integer DEFAULT 15, p_atraso integer DEFAULT 180)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_janela IS NULL OR p_janela < 0 OR p_janela > 60 THEN RAISE EXCEPTION 'A janela precisa ficar entre 0 e 60 dias'; END IF;
  IF p_atraso IS NULL OR p_atraso < 0 OR p_atraso > 730 THEN RAISE EXCEPTION 'O atraso precisa ficar entre 0 e 730 dias'; END IF;
  -- o teto de 300 vale para a lista (as datas mais antigas primeiro), então é aplicado antes de agregar
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('pet_id', g.pet_id, 'pet', g.pet, 'especie', g.especie, 'tutor', g.tutor, 'telefone', g.telefone,
                                         'referencia', g.ref, 'dias', g.ref - v_hoje, 'itens', g.itens) ORDER BY g.ref, g.pet)
      FROM (
        SELECT q.pet_id, q.pet, q.especie, q.tutor, q.telefone, q.ref,
               jsonb_agg(jsonb_build_object('nome', q.nome, 'tipo', q.tipo) ORDER BY q.nome) AS itens
          FROM (
            SELECT DISTINCT ON (v.pet_id, v.catalogo_id)
                   v.pet_id, p.nome AS pet, p.especie, c.nome AS tutor, c.telefone, v.proxima_dose_em AS ref, v.nome, v.tipo
              FROM public.pet_vacinacoes v
              JOIN public.pets p ON p.id = v.pet_id
              JOIN public.clientes c ON c.id = p.cliente_id
              JOIN public.pet_vacinas_catalogo k ON k.id = v.catalogo_id AND k.ativo
             WHERE v.tenant_id = v_tenant AND v.situacao = 'ativa' AND p.ativo
             ORDER BY v.pet_id, v.catalogo_id, v.aplicada_em DESC, v.created_at DESC
          ) q
         WHERE q.ref IS NOT NULL AND q.ref BETWEEN v_hoje - p_atraso AND v_hoje + p_janela
           AND NOT EXISTS (SELECT 1 FROM public.pet_contatos t WHERE t.pet_id = q.pet_id AND t.tipo = 'reforco' AND t.referencia = q.ref)
           AND NOT EXISTS (SELECT 1 FROM public.pet_agendamentos a
                             JOIN public.pet_agendamento_itens i ON i.agendamento_id = a.id
                             JOIN public.pet_servicos s ON s.id = i.servico_id
                            WHERE a.pet_id = q.pet_id AND s.categoria = 'vacina'
                              AND a.situacao IN ('agendado', 'confirmado', 'em_atendimento') AND a.inicio >= now() - interval '1 day')
         GROUP BY q.pet_id, q.pet, q.especie, q.tutor, q.telefone, q.ref
         ORDER BY q.ref, q.pet
         LIMIT 300
      ) g
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_reforcos_pendentes(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_reforcos_pendentes(integer, integer) TO authenticated;

-- ===== 20261027000000_clinica_exames_modelos.sql =====
-- Clínica (Fase 4, PR 2): modelos de exame. A clínica monta (ou começa dos modelos iniciais) o hemograma, a bioquímica, a urina e outros exames:
-- cada modelo tem campos com grupo, unidade, forma de valor (número, texto, escolha ou calculado) e faixa de referência por espécie.
-- A gestão e o veterinário mantêm os modelos; o resultado (PR 3) é só do veterinário. Campo nunca se apaga: sai de uso ficando inativo, para
-- exame já feito continuar legível. O sistema não traz faixa de referência pronta: a faixa é do veterinário responsável e do laboratório da clínica.
-- Nenhuma tabela tem acesso direto: tudo passa por funções que exigem a clínica liberada (clinica_liberada).

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_exame_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  tipo text NOT NULL CHECK (tipo IN ('hemograma', 'bioquimica', 'urina', 'outro')),
  material text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_exame_modelos_nome_idx ON public.pet_exame_modelos (tenant_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.pet_exame_campos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  modelo_id uuid NOT NULL REFERENCES public.pet_exame_modelos(id),
  ordem integer NOT NULL CHECK (ordem >= 0),
  grupo text,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  unidade text,
  forma text NOT NULL CHECK (forma IN ('numero', 'texto', 'escolha', 'calculado')),
  casas integer CHECK (casas BETWEEN 0 AND 6),
  opcoes jsonb,
  observacao text,
  -- só campo calculado: valor = total × percentual ÷ 100 (o absoluto de cada célula do leucograma)
  total_campo_id uuid REFERENCES public.pet_exame_campos(id),
  pct_campo_id uuid REFERENCES public.pet_exame_campos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (forma NOT IN ('numero', 'calculado') OR casas IS NOT NULL),
  CHECK (forma <> 'escolha' OR (opcoes IS NOT NULL AND jsonb_typeof(opcoes) = 'array' AND jsonb_array_length(opcoes) > 0)),
  CHECK (forma = 'escolha' OR opcoes IS NULL),
  CHECK ((forma = 'calculado') = (total_campo_id IS NOT NULL AND pct_campo_id IS NOT NULL)),
  CHECK (forma = 'calculado' OR (total_campo_id IS NULL AND pct_campo_id IS NULL))
);
CREATE INDEX IF NOT EXISTS pet_exame_campos_modelo_idx ON public.pet_exame_campos (modelo_id, ordem);
CREATE UNIQUE INDEX IF NOT EXISTS pet_exame_campos_nome_idx
  ON public.pet_exame_campos (modelo_id, lower(btrim(coalesce(grupo, ''))), lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.pet_exame_referencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  campo_id uuid NOT NULL REFERENCES public.pet_exame_campos(id),
  especie text NOT NULL CHECK (especie IN ('cao', 'gato', 'outro')),
  minimo numeric,
  maximo numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimo IS NOT NULL OR maximo IS NOT NULL),
  CHECK (minimo IS NULL OR maximo IS NULL OR minimo <= maximo),
  UNIQUE (campo_id, especie)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_exame_modelos', 'pet_exame_campos', 'pet_exame_referencias'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ============ apoio ============
-- Quem mantém e consulta os modelos: gestão e veterinário, com a clínica liberada.
CREATE OR REPLACE FUNCTION public._clinica_exige_modelos()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exige_modelos() FROM PUBLIC, anon, authenticated;

-- ============ consulta ============
CREATE OR REPLACE FUNCTION public.clinica_exame_modelos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_exige_modelos();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', m.id, 'nome', m.nome, 'tipo', m.tipo, 'material', m.material, 'ativo', m.ativo,
             'campos', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', c.id, 'ordem', c.ordem, 'grupo', c.grupo, 'nome', c.nome, 'unidade', c.unidade, 'forma', c.forma,
                        'casas', c.casas, 'opcoes', c.opcoes, 'observacao', c.observacao, 'ativo', c.ativo,
                        'total_campo_id', c.total_campo_id, 'pct_campo_id', c.pct_campo_id,
                        'referencias', coalesce((
                          SELECT jsonb_agg(jsonb_build_object('especie', r.especie, 'minimo', r.minimo, 'maximo', r.maximo) ORDER BY r.especie)
                            FROM public.pet_exame_referencias r WHERE r.campo_id = c.id), '[]'::jsonb)
                      ) ORDER BY c.ordem, c.id)
                 FROM public.pet_exame_campos c WHERE c.modelo_id = m.id), '[]'::jsonb)
           ) ORDER BY m.nome)
      FROM public.pet_exame_modelos m
     WHERE m.tenant_id = public.current_tenant_id()
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_modelos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_modelos() TO authenticated;

-- ============ modelo ============
CREATE OR REPLACE FUNCTION public.clinica_exame_modelo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'outro');
  v_material text := nullif(btrim(coalesce(p_dados ->> 'material', '')), '');
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM public._clinica_exige_modelos();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do modelo'; END IF;
  IF length(v_nome) > 80 THEN RAISE EXCEPTION 'O nome do modelo passa de 80 letras'; END IF;
  IF v_tipo NOT IN ('hemograma', 'bioquimica', 'urina', 'outro') THEN RAISE EXCEPTION 'Tipo de exame inválido'; END IF;
  IF length(coalesce(v_material, '')) > 80 THEN RAISE EXCEPTION 'O material passa de 80 letras'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_modelo:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_exame_modelos m WHERE m.tenant_id = v_tenant AND lower(btrim(m.nome)) = lower(v_nome) AND m.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um modelo com este nome';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_exame_modelos (tenant_id, nome, tipo, material, ativo) VALUES (v_tenant, v_nome, v_tipo, v_material, v_ativo) RETURNING id INTO v_id;
  ELSE
    UPDATE public.pet_exame_modelos SET nome = v_nome, tipo = v_tipo, material = v_material, ativo = v_ativo WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de exame não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_modelo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_modelo_salvar(jsonb) TO authenticated;

-- ============ campo ============
CREATE OR REPLACE FUNCTION public.clinica_exame_campo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_modelo uuid := nullif(p_dados ->> 'modelo_id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_grupo text := nullif(btrim(coalesce(p_dados ->> 'grupo', '')), '');
  v_unidade text := nullif(btrim(coalesce(p_dados ->> 'unidade', '')), '');
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  v_forma text := coalesce(nullif(p_dados ->> 'forma', ''), 'numero');
  v_casas integer;
  v_opcoes jsonb := p_dados -> 'opcoes';
  v_total uuid := nullif(p_dados ->> 'total_campo_id', '')::uuid;
  v_pct uuid := nullif(p_dados ->> 'pct_campo_id', '')::uuid;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_ordem integer;
  v_antes record;
BEGIN
  PERFORM public._clinica_exige_modelos();
  BEGIN
    v_casas := nullif(p_dados ->> 'casas', '')::integer;
    v_ordem := nullif(p_dados ->> 'ordem', '')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Confira os números do campo';
  END;
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do campo'; END IF;
  IF length(v_nome) > 80 OR length(coalesce(v_grupo, '')) > 80 OR length(coalesce(v_unidade, '')) > 30 OR length(coalesce(v_obs, '')) > 300 THEN
    RAISE EXCEPTION 'Nome, grupo, unidade ou observação grande demais';
  END IF;
  IF v_forma NOT IN ('numero', 'texto', 'escolha', 'calculado') THEN RAISE EXCEPTION 'Forma de valor inválida'; END IF;
  IF v_ordem IS NOT NULL AND v_ordem < 0 THEN RAISE EXCEPTION 'Ordem inválida'; END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_antes FROM public.pet_exame_campos WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
    v_modelo := v_antes.modelo_id;
  END IF;
  PERFORM 1 FROM public.pet_exame_modelos WHERE id = v_modelo AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de exame não encontrado'; END IF;

  IF v_forma IN ('numero', 'calculado') THEN
    IF v_casas IS NULL THEN v_casas := 2; END IF;
    IF v_casas < 0 OR v_casas > 6 THEN RAISE EXCEPTION 'Casas decimais de 0 a 6'; END IF;
  ELSE
    v_casas := NULL;
  END IF;

  IF v_forma = 'escolha' THEN
    IF v_opcoes IS NULL OR jsonb_typeof(v_opcoes) <> 'array' OR jsonb_array_length(v_opcoes) = 0 OR jsonb_array_length(v_opcoes) > 30 THEN
      RAISE EXCEPTION 'Informe de 1 a 30 opções para o campo de escolha';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opcoes) o WHERE jsonb_typeof(o) <> 'string' OR btrim(o #>> '{}') = '' OR length(o #>> '{}') > 60) THEN
      RAISE EXCEPTION 'Cada opção precisa ter texto, de até 60 letras';
    END IF;
    -- tira repetidas mantendo a primeira aparição e a ordem digitada (a ordem da lista é a da escolha na tela)
    v_opcoes := (SELECT jsonb_agg(to_jsonb(q.op) ORDER BY q.pos)
                   FROM (SELECT btrim(e #>> '{}') AS op, min(n) AS pos FROM jsonb_array_elements(v_opcoes) WITH ORDINALITY t(e, n) GROUP BY 1) q);
  ELSE
    v_opcoes := NULL;
  END IF;

  IF v_forma = 'calculado' THEN
    IF v_total IS NULL OR v_pct IS NULL OR v_total = v_pct OR v_total IS NOT DISTINCT FROM v_id OR v_pct IS NOT DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'Escolha o campo do total e o campo do percentual (dois campos diferentes)';
    END IF;
    IF (SELECT count(*) FROM public.pet_exame_campos x
         WHERE x.id IN (v_total, v_pct) AND x.modelo_id = v_modelo AND x.tenant_id = v_tenant AND x.forma = 'numero' AND x.ativo) <> 2 THEN
      RAISE EXCEPTION 'O total e o percentual precisam ser campos numéricos ativos deste modelo';
    END IF;
  ELSE
    v_total := NULL; v_pct := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_campo:' || v_modelo::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_exame_campos c WHERE c.modelo_id = v_modelo AND lower(btrim(coalesce(c.grupo, ''))) = lower(coalesce(v_grupo, ''))
                AND lower(btrim(c.nome)) = lower(v_nome) AND c.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um campo com este nome neste grupo do modelo';
  END IF;

  IF v_id IS NULL THEN
    IF v_ordem IS NULL THEN v_ordem := coalesce((SELECT max(ordem) + 1 FROM public.pet_exame_campos WHERE modelo_id = v_modelo), 0); END IF;
    INSERT INTO public.pet_exame_campos (tenant_id, modelo_id, ordem, grupo, nome, unidade, forma, casas, opcoes, observacao, total_campo_id, pct_campo_id, ativo)
    VALUES (v_tenant, v_modelo, v_ordem, v_grupo, v_nome, v_unidade, v_forma, v_casas, v_opcoes, v_obs, v_total, v_pct, v_ativo) RETURNING id INTO v_id;
  ELSE
    -- um campo que alimenta um cálculo ativo não muda de forma nem sai de uso
    IF EXISTS (SELECT 1 FROM public.pet_exame_campos d WHERE d.ativo AND d.forma = 'calculado' AND v_id IN (d.total_campo_id, d.pct_campo_id))
       AND (v_forma <> 'numero' OR NOT v_ativo) THEN
      RAISE EXCEPTION 'Este campo alimenta um campo calculado ativo: ele precisa continuar numérico e ativo';
    END IF;
    -- campo que já tem faixa de referência só aceita faixa se continuar numérico
    IF v_forma NOT IN ('numero', 'calculado') AND EXISTS (SELECT 1 FROM public.pet_exame_referencias r WHERE r.campo_id = v_id) THEN
      RAISE EXCEPTION 'Remova as faixas de referência antes de trocar para texto ou escolha';
    END IF;
    UPDATE public.pet_exame_campos SET ordem = coalesce(v_ordem, ordem), grupo = v_grupo, nome = v_nome, unidade = v_unidade, forma = v_forma,
           casas = v_casas, opcoes = v_opcoes, observacao = v_obs, total_campo_id = v_total, pct_campo_id = v_pct, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_campo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_campo_salvar(jsonb) TO authenticated;

-- Sobe ou desce o campo uma posição, trocando a ordem com o vizinho do mesmo modelo.
CREATE OR REPLACE FUNCTION public.clinica_exame_campo_mover(p_campo_id uuid, p_delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_modelo uuid;
  v_ordem integer;
  v_viz record;
BEGIN
  PERFORM public._clinica_exige_modelos();
  IF p_delta IS NULL OR p_delta NOT IN (-1, 1) THEN RAISE EXCEPTION 'Movimento inválido'; END IF;
  SELECT modelo_id, ordem INTO v_modelo, v_ordem FROM public.pet_exame_campos WHERE id = p_campo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_campo:' || v_modelo::text, 0));
  -- renumera o modelo inteiro de 0 em diante (a ordem pode ter buracos ou repetições) e troca com o vizinho
  WITH n AS (
    SELECT id, (row_number() OVER (ORDER BY ordem, id) - 1)::int AS pos FROM public.pet_exame_campos WHERE modelo_id = v_modelo
  )
  UPDATE public.pet_exame_campos c SET ordem = n.pos FROM n WHERE c.id = n.id AND c.ordem <> n.pos;
  SELECT ordem INTO v_ordem FROM public.pet_exame_campos WHERE id = p_campo_id;
  SELECT id, ordem INTO v_viz FROM public.pet_exame_campos WHERE modelo_id = v_modelo AND ordem = v_ordem + p_delta;
  IF v_viz.id IS NULL THEN RETURN; END IF;
  UPDATE public.pet_exame_campos SET ordem = v_viz.ordem WHERE id = p_campo_id;
  UPDATE public.pet_exame_campos SET ordem = v_ordem WHERE id = v_viz.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_campo_mover(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_campo_mover(uuid, integer) TO authenticated;

-- ============ faixa de referência ============
-- Mínimo e máximo ficam em branco juntos para tirar a faixa. A faixa é do veterinário responsável: o sistema não traz valor pronto.
CREATE OR REPLACE FUNCTION public.clinica_exame_referencia_salvar(p_campo_id uuid, p_especie text, p_minimo numeric, p_maximo numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_forma text;
BEGIN
  PERFORM public._clinica_exige_modelos();
  IF p_especie IS NULL OR p_especie NOT IN ('cao', 'gato', 'outro') THEN RAISE EXCEPTION 'Espécie inválida'; END IF;
  SELECT forma INTO v_forma FROM public.pet_exame_campos WHERE id = p_campo_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
  IF v_forma NOT IN ('numero', 'calculado') THEN RAISE EXCEPTION 'Só campo numérico ou calculado tem faixa de referência'; END IF;
  IF p_minimo IS NULL AND p_maximo IS NULL THEN
    DELETE FROM public.pet_exame_referencias WHERE campo_id = p_campo_id AND especie = p_especie AND tenant_id = v_tenant;
    RETURN;
  END IF;
  IF p_minimo IS NOT NULL AND p_maximo IS NOT NULL AND p_minimo > p_maximo THEN RAISE EXCEPTION 'O mínimo não pode passar do máximo'; END IF;
  INSERT INTO public.pet_exame_referencias (tenant_id, campo_id, especie, minimo, maximo)
  VALUES (v_tenant, p_campo_id, p_especie, p_minimo, p_maximo)
  ON CONFLICT (campo_id, especie) DO UPDATE SET minimo = EXCLUDED.minimo, maximo = EXCLUDED.maximo;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_referencia_salvar(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_referencia_salvar(uuid, text, numeric, numeric) TO authenticated;

-- ============ modelos iniciais ============
-- Cria um modelo (e seus campos, na ordem) se a empresa ainda não tem um com o mesmo nome. Cada campo: [grupo, nome, unidade, forma, casas, extra],
-- onde extra é a lista de opções (escolha) ou {"total": nome, "pct": nome} (calculado, apontando para campos já criados acima).
CREATE OR REPLACE FUNCTION public._clinica_exame_semear(p_tenant uuid, p_nome text, p_tipo text, p_material text, p_campos jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_modelo uuid;
  c record;
  v_total uuid;
  v_pct uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.pet_exame_modelos m WHERE m.tenant_id = p_tenant AND lower(btrim(m.nome)) = lower(btrim(p_nome))) THEN RETURN false; END IF;
  INSERT INTO public.pet_exame_modelos (tenant_id, nome, tipo, material) VALUES (p_tenant, p_nome, p_tipo, p_material) RETURNING id INTO v_modelo;
  FOR c IN SELECT e AS campo, (n - 1)::int AS pos FROM jsonb_array_elements(p_campos) WITH ORDINALITY AS t(e, n) LOOP
    v_total := NULL; v_pct := NULL;
    IF c.campo ->> 3 = 'calculado' THEN
      SELECT id INTO v_total FROM public.pet_exame_campos WHERE modelo_id = v_modelo AND nome = c.campo -> 5 ->> 'total';
      SELECT id INTO v_pct FROM public.pet_exame_campos WHERE modelo_id = v_modelo AND nome = c.campo -> 5 ->> 'pct';
    END IF;
    INSERT INTO public.pet_exame_campos (tenant_id, modelo_id, ordem, grupo, nome, unidade, forma, casas, opcoes, total_campo_id, pct_campo_id)
    VALUES (p_tenant, v_modelo, c.pos, nullif(c.campo ->> 0, ''), c.campo ->> 1, nullif(c.campo ->> 2, ''), c.campo ->> 3,
            CASE WHEN jsonb_typeof(c.campo -> 4) = 'number' THEN (c.campo ->> 4)::int END,
            CASE WHEN c.campo ->> 3 = 'escolha' THEN c.campo -> 5 END, v_total, v_pct);
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exame_semear(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clinica_exame_modelos_iniciais()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_criados integer := 0;
  v_diferencial jsonb := jsonb_build_array('Metamielócitos', 'Bastonetes', 'Segmentados', 'Eosinófilos', 'Basófilos', 'Linfócitos', 'Monócitos');
  v_hemo jsonb;
  v_bioq jsonb;
  v_urina jsonb;
  v_neg5 jsonb := jsonb_build_array('Negativo', 'Traços', '+', '++', '+++');
  d text;
BEGIN
  PERFORM public._clinica_exige_modelos();
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_modelo:' || v_tenant::text, 0));

  v_hemo := '[
    ["Eritrograma","Hemácias","milhões/mm³","numero",2],
    ["Eritrograma","Hemoglobina","g/dL","numero",1],
    ["Eritrograma","Hematócrito","%","numero",1],
    ["Eritrograma","VCM","fl","numero",1],
    ["Eritrograma","HCM","pg","numero",1],
    ["Eritrograma","CHCM","%","numero",1],
    ["Eritrograma","RDW","%","numero",1],
    ["Proteínas","Proteínas totais","g/dL","numero",1],
    ["Leucograma","Leucócitos totais","células/mm³","numero",0]
  ]'::jsonb;
  FOR d IN SELECT jsonb_array_elements_text(v_diferencial) LOOP
    v_hemo := v_hemo || jsonb_build_array(jsonb_build_array('Leucograma — relativo', d || ' (%)', '%', 'numero', 0));
  END LOOP;
  FOR d IN SELECT jsonb_array_elements_text(v_diferencial) LOOP
    v_hemo := v_hemo || jsonb_build_array(jsonb_build_array('Leucograma — absoluto', d || ' (abs.)', 'células/mm³', 'calculado', 0,
                jsonb_build_object('total', 'Leucócitos totais', 'pct', d || ' (%)')));
  END LOOP;
  v_hemo := v_hemo || '[
    ["Plaquetograma","Plaquetas","mil/mm³","numero",0],
    ["Plaquetograma","Observação do plaquetograma","","texto"],
    ["","Observações","","texto"]
  ]'::jsonb;

  v_bioq := '[
    ["Bioquímica","Albumina","g/dL","numero",1],
    ["Bioquímica","Proteínas totais","g/dL","numero",1],
    ["Bioquímica","Globulinas","g/dL","numero",1],
    ["Bioquímica","Fibrinogênio","mg/dL","numero",0],
    ["Bioquímica","Bilirrubina total","mg/dL","numero",2],
    ["Bioquímica","Bilirrubina direta","mg/dL","numero",2],
    ["Bioquímica","AST (TGO)","U/L","numero",0],
    ["Bioquímica","ALT (TGP)","U/L","numero",0],
    ["Bioquímica","Fosfatase alcalina","U/L","numero",0],
    ["Bioquímica","Ureia","mg/dL","numero",0],
    ["Bioquímica","Creatinina","mg/dL","numero",2],
    ["Bioquímica","Glicose","mg/dL","numero",0],
    ["Bioquímica","Colesterol","mg/dL","numero",0],
    ["Bioquímica","Amilase","U/L","numero",0],
    ["Bioquímica","Lipase","U/L","numero",0],
    ["Bioquímica","Cálcio","mg/dL","numero",1],
    ["Bioquímica","Fósforo","mg/dL","numero",1],
    ["Bioquímica","Sódio","mEq/L","numero",0],
    ["Bioquímica","Potássio","mEq/L","numero",1],
    ["Bioquímica","Ácido úrico","mg/dL","numero",1],
    ["Bioquímica","Creatinoquinase (CK)","U/L","numero",0],
    ["","Observações","","texto"]
  ]'::jsonb;

  v_urina := jsonb_build_array(
    jsonb_build_array('Físico', 'Volume', 'ml', 'numero', 0),
    jsonb_build_array('Físico', 'Colheita', '', 'texto'),
    jsonb_build_array('Físico', 'Aspecto', '', 'escolha', NULL, jsonb_build_array('Límpido', 'Ligeiramente turvo', 'Turvo')),
    jsonb_build_array('Físico', 'Cor', '', 'texto'),
    jsonb_build_array('Físico', 'Odor', '', 'texto'),
    jsonb_build_array('Físico', 'Densidade', '', 'numero', 3),
    jsonb_build_array('Físico', 'pH', '', 'numero', 1),
    jsonb_build_array('Químico', 'Proteínas', 'mg%', 'numero', 0),
    jsonb_build_array('Químico', 'Glicose', 'mg%', 'numero', 0),
    jsonb_build_array('Químico', 'Corpos cetônicos', '', 'escolha', NULL, v_neg5),
    jsonb_build_array('Químico', 'Bilirrubina', '', 'escolha', NULL, v_neg5),
    jsonb_build_array('Químico', 'Urobilinogênio', '', 'escolha', NULL, jsonb_build_array('Normal', 'Aumentado')),
    jsonb_build_array('Químico', 'Sangue oculto', '', 'escolha', NULL, jsonb_build_array('Negativo', '+', '++', '+++')),
    jsonb_build_array('Químico', 'Nitritos', '', 'escolha', NULL, jsonb_build_array('Negativo', 'Positivo')),
    jsonb_build_array('Sedimentoscopia', 'Hemácias', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Leucócitos', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Cilindros', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Células descamativas', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Cristais', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Outros', '', 'texto'),
    jsonb_build_array('', 'Observações', '', 'texto')
  );

  IF public._clinica_exame_semear(v_tenant, 'Hemograma', 'hemograma', 'Sangue total em EDTA', v_hemo) THEN v_criados := v_criados + 1; END IF;
  IF public._clinica_exame_semear(v_tenant, 'Bioquímica sanguínea', 'bioquimica', 'Soro sanguíneo', v_bioq) THEN v_criados := v_criados + 1; END IF;
  IF public._clinica_exame_semear(v_tenant, 'Urina', 'urina', 'Urina', v_urina) THEN v_criados := v_criados + 1; END IF;
  RETURN v_criados;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_modelos_iniciais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_modelos_iniciais() TO authenticated;

-- ===== 20261028000000_clinica_exames_resultados.sql =====
-- Clínica (Fase 4, PR 3): resultados de exame. O veterinário abre um exame a partir de um modelo (PR 2), para um paciente, ligado a um atendimento
-- aberto dele ou avulso (resultado de laboratório externo, com laboratório e data da coleta), e preenche os valores. Campo em branco é "não feito".
-- Ao abrir, o exame guarda cópia de cada campo (nome, unidade, casas, opções e faixa de referência da espécie): editar o modelo depois não muda o exame.
-- Exame fechado é imutável (nem o dono do banco altera); correção é adendo com nome e CRMV; exame aberto por engano é cancelado com motivo.
-- Só o veterinário lê e escreve; as tabelas não têm acesso direto e cada acesso fica em clinica_acessos.

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_exames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  atendimento_id uuid REFERENCES public.pet_atendimentos_clinicos(id),
  modelo_id uuid NOT NULL REFERENCES public.pet_exame_modelos(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  -- o CRMV vale como estava na abertura
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  -- nome e tipo do modelo como estavam na abertura
  nome text NOT NULL,
  tipo text NOT NULL,
  material text,
  laboratorio text,
  data_coleta date NOT NULL,
  observacoes text,
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'fechado', 'cancelado')),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_em timestamptz,
  cancelado_em timestamptz,
  cancelado_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (atendimento_id IS NOT NULL OR length(btrim(coalesce(laboratorio, ''))) > 0),
  CHECK ((situacao = 'fechado') = (fechado_em IS NOT NULL)),
  CHECK ((situacao = 'cancelado') = (cancelado_em IS NOT NULL AND length(btrim(coalesce(cancelado_motivo, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS pet_exames_pet_idx ON public.pet_exames (tenant_id, pet_id, data_coleta DESC);
CREATE INDEX IF NOT EXISTS pet_exames_atend_idx ON public.pet_exames (atendimento_id) WHERE atendimento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pet_exame_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  exame_id uuid NOT NULL REFERENCES public.pet_exames(id),
  campo_id uuid REFERENCES public.pet_exame_campos(id),
  -- cópia do campo na abertura do exame
  ordem integer NOT NULL CHECK (ordem >= 0),
  grupo text,
  nome text NOT NULL,
  unidade text,
  forma text NOT NULL CHECK (forma IN ('numero', 'texto', 'escolha', 'calculado')),
  casas integer CHECK (casas BETWEEN 0 AND 6),
  opcoes jsonb,
  total_id uuid REFERENCES public.pet_exame_resultados(id),
  pct_id uuid REFERENCES public.pet_exame_resultados(id),
  -- faixa de referência: a do modelo para a espécie na abertura, que o veterinário pode ajustar (laudo externo traz a do laboratório)
  faixa_min numeric,
  faixa_max numeric,
  -- o que o veterinário preenche (em branco = não feito)
  valor_num numeric CHECK (valor_num IS NULL OR (valor_num >= 0 AND valor_num < 1000000000000)),
  valor_texto text,
  nota text,
  UNIQUE (exame_id, ordem),
  CHECK (faixa_min IS NULL OR faixa_max IS NULL OR faixa_min <= faixa_max),
  CHECK (forma IN ('numero', 'calculado') OR (faixa_min IS NULL AND faixa_max IS NULL AND valor_num IS NULL)),
  CHECK (forma IN ('texto', 'escolha') OR valor_texto IS NULL)
);

CREATE TABLE IF NOT EXISTS public.pet_exame_adendos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  exame_id uuid NOT NULL REFERENCES public.pet_exames(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  texto text NOT NULL CHECK (length(btrim(texto)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_exame_adendos_idx ON public.pet_exame_adendos (exame_id, created_at);

ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao', 'exame'));

-- ============ imutabilidade ============
-- O exame só muda enquanto está aberto, e nunca se apaga; fechar e cancelar são definitivos.
CREATE OR REPLACE FUNCTION public._clinica_exame_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O exame não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'fechado' THEN RAISE EXCEPTION 'Exame fechado não pode ser alterado: registre um adendo'; END IF;
  IF OLD.situacao = 'cancelado' THEN RAISE EXCEPTION 'Exame cancelado não muda'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.atendimento_id IS DISTINCT FROM OLD.atendimento_id
     OR NEW.modelo_id IS DISTINCT FROM OLD.modelo_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id OR NEW.crmv IS DISTINCT FROM OLD.crmv
     OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.nome IS DISTINCT FROM OLD.nome OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.aberto_em IS DISTINCT FROM OLD.aberto_em THEN
    RAISE EXCEPTION 'Estes dados do exame não mudam';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_exame_guarda ON public.pet_exames;
CREATE TRIGGER trg_clinica_exame_guarda BEFORE UPDATE OR DELETE ON public.pet_exames
  FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_guarda();

-- Resultado: só nasce e muda com o exame aberto, e só nos campos que o veterinário preenche.
CREATE OR REPLACE FUNCTION public._clinica_exame_resultado_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_situacao text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O resultado do exame não se apaga'; END IF;
  SELECT situacao INTO v_situacao FROM public.pet_exames WHERE id = NEW.exame_id;
  IF v_situacao IS DISTINCT FROM 'aberto' THEN RAISE EXCEPTION 'Exame fechado ou cancelado não muda: registre um adendo'; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'faixa_min' - 'faixa_max' - 'valor_num' - 'valor_texto' - 'nota')
                          IS DISTINCT FROM (to_jsonb(OLD) - 'faixa_min' - 'faixa_max' - 'valor_num' - 'valor_texto' - 'nota') THEN
    RAISE EXCEPTION 'A cópia do campo no exame não muda';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_exame_resultado_guarda ON public.pet_exame_resultados;
CREATE TRIGGER trg_clinica_exame_resultado_guarda BEFORE INSERT OR UPDATE OR DELETE ON public.pet_exame_resultados
  FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_resultado_guarda();

CREATE OR REPLACE FUNCTION public._clinica_exame_adendo_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O adendo do exame não se altera nem se apaga';
END $$;
DROP TRIGGER IF EXISTS trg_clinica_exame_adendo_guarda ON public.pet_exame_adendos;
CREATE TRIGGER trg_clinica_exame_adendo_guarda BEFORE UPDATE OR DELETE ON public.pet_exame_adendos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_adendo_guarda();

-- ============ acesso: nenhuma leitura nem escrita direta ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_exames', 'pet_exame_resultados', 'pet_exame_adendos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

-- ============ apoio ============
CREATE OR REPLACE FUNCTION public._clinica_exame_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
      'id', e.id, 'pet_id', e.pet_id, 'atendimento_id', e.atendimento_id, 'nome', e.nome, 'tipo', e.tipo, 'material', e.material,
      'laboratorio', e.laboratorio, 'data_coleta', e.data_coleta, 'observacoes', e.observacoes, 'situacao', e.situacao,
      'aberto_em', e.aberto_em, 'fechado_em', e.fechado_em, 'cancelado_em', e.cancelado_em, 'cancelado_motivo', e.cancelado_motivo,
      'veterinario', jsonb_build_object('id', e.veterinario_id, 'nome', v.nome, 'crmv', e.crmv, 'crmv_uf', e.crmv_uf),
      'pet', jsonb_build_object('nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'nascimento', pt.nascimento),
      'tutor', c.nome,
      'resultados', coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'id', r.id, 'ordem', r.ordem, 'grupo', r.grupo, 'nome', r.nome, 'unidade', r.unidade, 'forma', r.forma, 'casas', r.casas,
                        'opcoes', r.opcoes, 'total_id', r.total_id, 'pct_id', r.pct_id, 'faixa_min', r.faixa_min, 'faixa_max', r.faixa_max,
                        'valor_num', r.valor_num, 'valor_texto', r.valor_texto, 'nota', r.nota) ORDER BY r.ordem)
                      FROM public.pet_exame_resultados r WHERE r.exame_id = e.id), '[]'::jsonb),
      'adendos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'texto', d.texto, 'created_at', d.created_at, 'veterinario', dv.nome,
                                                                'crmv', d.crmv, 'crmv_uf', d.crmv_uf) ORDER BY d.created_at)
                      FROM public.pet_exame_adendos d JOIN public.pet_profissionais dv ON dv.id = d.veterinario_id WHERE d.exame_id = e.id), '[]'::jsonb))
    FROM public.pet_exames e
    JOIN public.pet_profissionais v ON v.id = e.veterinario_id
    JOIN public.pets pt ON pt.id = e.pet_id
    JOIN public.clientes c ON c.id = pt.cliente_id
   WHERE e.id = p_id AND e.tenant_id = public.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION public._clinica_exame_json(uuid) FROM PUBLIC, anon, authenticated;

-- Valor dos campos calculados: total × percentual ÷ 100, com as casas do campo; sem um dos dois, fica em branco.
CREATE OR REPLACE FUNCTION public._clinica_exame_recalcular(p_exame_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.pet_exame_resultados r
     SET valor_num = (SELECT round(t.valor_num * p.valor_num / 100, coalesce(r.casas, 2))
                        FROM public.pet_exame_resultados t, public.pet_exame_resultados p
                       WHERE t.id = r.total_id AND p.id = r.pct_id AND t.valor_num IS NOT NULL AND p.valor_num IS NOT NULL)
   WHERE r.exame_id = p_exame_id AND r.forma = 'calculado'
$$;
REVOKE ALL ON FUNCTION public._clinica_exame_recalcular(uuid) FROM PUBLIC, anon, authenticated;

-- Exame aberto do veterinário da conta (só quem abriu preenche, fecha ou cancela).
CREATE OR REPLACE FUNCTION public._clinica_exame_meu_aberto(p_id uuid, p_vet uuid)
RETURNS public.pet_exames
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE e public.pet_exames%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.pet_exames WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  IF e.veterinario_id <> p_vet THEN RAISE EXCEPTION 'Só o veterinário que abriu o exame mexe nele'; END IF;
  IF e.situacao <> 'aberto' THEN RAISE EXCEPTION 'Este exame está "%": não dá para alterar (no exame fechado, use um adendo)', e.situacao; END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exame_meu_aberto(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============ abrir ============
-- p_dados: atendimento_id (atendimento aberto deste veterinário e deste pet), laboratorio (obrigatório se avulso), data_coleta, material.
CREATE OR REPLACE FUNCTION public.clinica_exame_abrir(p_pet_id uuid, p_modelo_id uuid, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_atend uuid := nullif(btrim(coalesce(p_dados ->> 'atendimento_id', '')), '')::uuid;
  v_lab text := nullif(btrim(coalesce(p_dados ->> 'laboratorio', '')), '');
  v_material text;
  v_coleta date;
  pt public.pets%ROWTYPE;
  m public.pet_exame_modelos%ROWTYPE;
  v_crmv text; v_uf text;
  v_id uuid;
BEGIN
  BEGIN
    v_coleta := coalesce(nullif(btrim(coalesce(p_dados ->> 'data_coleta', '')), '')::date, v_hoje);
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira a data da coleta';
  END;
  IF v_coleta > v_hoje THEN RAISE EXCEPTION 'A data da coleta não pode ser no futuro'; END IF;
  IF length(coalesce(v_lab, '')) > 120 THEN RAISE EXCEPTION 'O nome do laboratório passa de 120 letras'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT * INTO m FROM public.pet_exame_modelos WHERE id = p_modelo_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de exame não encontrado ou inativo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_exame_campos WHERE modelo_id = m.id AND ativo) THEN RAISE EXCEPTION 'O modelo não tem campos ativos'; END IF;
  v_material := coalesce(nullif(btrim(coalesce(p_dados ->> 'material', '')), ''), m.material);
  IF length(coalesce(v_material, '')) > 80 THEN RAISE EXCEPTION 'O material passa de 80 letras'; END IF;
  IF v_atend IS NOT NULL THEN
    PERFORM 1 FROM public.pet_atendimentos_clinicos a
     WHERE a.id = v_atend AND a.tenant_id = v_tenant AND a.pet_id = pt.id AND a.veterinario_id = v_vet AND a.situacao = 'aberto';
    IF NOT FOUND THEN RAISE EXCEPTION 'O atendimento precisa estar aberto, ser seu e ser deste paciente'; END IF;
  ELSIF v_lab IS NULL THEN
    RAISE EXCEPTION 'Exame avulso (sem atendimento aberto) precisa do nome do laboratório';
  END IF;
  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;

  INSERT INTO public.pet_exames (tenant_id, pet_id, atendimento_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, material, laboratorio, data_coleta)
  VALUES (v_tenant, pt.id, v_atend, m.id, v_vet, v_crmv, v_uf, m.nome, m.tipo, v_material, v_lab, v_coleta) RETURNING id INTO v_id;

  -- copia os campos ativos do modelo (com a faixa da espécie do paciente); o id de cada resultado é sorteado antes para os calculados apontarem
  WITH campos AS (
    SELECT c.*, (row_number() OVER (ORDER BY c.ordem, c.id) - 1)::int AS pos, gen_random_uuid() AS rid
      FROM public.pet_exame_campos c WHERE c.modelo_id = m.id AND c.ativo
  )
  INSERT INTO public.pet_exame_resultados (id, tenant_id, exame_id, campo_id, ordem, grupo, nome, unidade, forma, casas, opcoes, total_id, pct_id, faixa_min, faixa_max)
  SELECT c.rid, v_tenant, v_id, c.id, c.pos, c.grupo, c.nome, c.unidade, c.forma, c.casas, c.opcoes,
         (SELECT x.rid FROM campos x WHERE x.id = c.total_campo_id), (SELECT x.rid FROM campos x WHERE x.id = c.pct_campo_id),
         ref.minimo, ref.maximo
    FROM campos c
    LEFT JOIN public.pet_exame_referencias ref ON ref.campo_id = c.id AND ref.especie = pt.especie AND c.forma IN ('numero', 'calculado');

  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, pt.id, v_atend, 'exame');
  RETURN public._clinica_exame_json(v_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_abrir(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_abrir(uuid, uuid, jsonb) TO authenticated;

-- ============ preencher ============
-- p_dados: material, laboratorio, data_coleta, observacoes e resultados [{id, valor, nota, faixa_min, faixa_max}]. Chave ausente não muda o que já está.
CREATE OR REPLACE FUNCTION public.clinica_exame_salvar(p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  e public.pet_exames%ROWTYPE;
  it jsonb;
  r public.pet_exame_resultados%ROWTYPE;
  v_texto text;
  v_num numeric;
  v_min numeric; v_max numeric;
  v_lab text; v_material text; v_obs text; v_coleta date;
BEGIN
  e := public._clinica_exame_meu_aberto(p_id, v_vet);
  v_lab := e.laboratorio; v_material := e.material; v_obs := e.observacoes; v_coleta := e.data_coleta;
  BEGIN
    IF p_dados ? 'laboratorio' THEN v_lab := nullif(btrim(coalesce(p_dados ->> 'laboratorio', '')), ''); END IF;
    IF p_dados ? 'material' THEN v_material := nullif(btrim(coalesce(p_dados ->> 'material', '')), ''); END IF;
    IF p_dados ? 'observacoes' THEN v_obs := nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''); END IF;
    IF p_dados ? 'data_coleta' THEN v_coleta := (p_dados ->> 'data_coleta')::date; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR null_value_not_allowed THEN
    RAISE EXCEPTION 'Confira a data da coleta';
  END;
  IF v_coleta IS NULL OR v_coleta > v_hoje THEN RAISE EXCEPTION 'A data da coleta não pode ficar em branco nem ser no futuro'; END IF;
  IF e.atendimento_id IS NULL AND v_lab IS NULL THEN RAISE EXCEPTION 'Exame avulso precisa do nome do laboratório'; END IF;
  IF length(coalesce(v_lab, '')) > 120 OR length(coalesce(v_material, '')) > 80 OR length(coalesce(v_obs, '')) > 4000 THEN
    RAISE EXCEPTION 'Laboratório, material ou observações grande demais';
  END IF;
  UPDATE public.pet_exames SET laboratorio = v_lab, material = v_material, observacoes = v_obs, data_coleta = v_coleta WHERE id = e.id;

  IF p_dados ? 'resultados' THEN
    IF jsonb_typeof(p_dados -> 'resultados') <> 'array' THEN RAISE EXCEPTION 'Resultados em formato inválido'; END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_dados -> 'resultados') LOOP
      SELECT * INTO r FROM public.pet_exame_resultados WHERE id = nullif(it ->> 'id', '')::uuid AND exame_id = e.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Resultado não pertence a este exame'; END IF;
      v_num := r.valor_num; v_texto := r.valor_texto; v_min := r.faixa_min; v_max := r.faixa_max;
      BEGIN
        IF it ? 'valor' AND r.forma = 'numero' THEN
          v_num := nullif(replace(btrim(coalesce(it ->> 'valor', '')), ',', '.'), '')::numeric;
        ELSIF it ? 'valor' AND r.forma IN ('texto', 'escolha') THEN
          v_texto := nullif(btrim(coalesce(it ->> 'valor', '')), '');
        END IF;
        IF r.forma IN ('numero', 'calculado') THEN
          IF it ? 'faixa_min' THEN v_min := nullif(replace(btrim(coalesce(it ->> 'faixa_min', '')), ',', '.'), '')::numeric; END IF;
          IF it ? 'faixa_max' THEN v_max := nullif(replace(btrim(coalesce(it ->> 'faixa_max', '')), ',', '.'), '')::numeric; END IF;
        END IF;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Digite só números em "%"', r.nome;
      END;
      IF v_num IS NOT NULL AND (v_num < 0 OR v_num >= 1000000000000) THEN RAISE EXCEPTION '"%": valor fora do esperado', r.nome; END IF;
      IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_min > v_max THEN RAISE EXCEPTION '"%": o mínimo da faixa não pode passar do máximo', r.nome; END IF;
      IF length(coalesce(v_texto, '')) > 2000 THEN RAISE EXCEPTION '"%": texto grande demais (até 2000 caracteres)', r.nome; END IF;
      IF r.forma = 'escolha' AND v_texto IS NOT NULL AND NOT (r.opcoes ? v_texto) THEN
        RAISE EXCEPTION '"%": escolha uma das opções da lista', r.nome;
      END IF;
      UPDATE public.pet_exame_resultados SET
             valor_num = CASE WHEN r.forma = 'numero' THEN v_num ELSE valor_num END,
             valor_texto = CASE WHEN r.forma IN ('texto', 'escolha') THEN v_texto ELSE valor_texto END,
             faixa_min = CASE WHEN r.forma IN ('numero', 'calculado') THEN v_min ELSE faixa_min END,
             faixa_max = CASE WHEN r.forma IN ('numero', 'calculado') THEN v_max ELSE faixa_max END,
             nota = CASE WHEN it ? 'nota' THEN nullif(btrim(coalesce(it ->> 'nota', '')), '') ELSE nota END
       WHERE id = r.id;
      IF it ? 'nota' AND length(coalesce(it ->> 'nota', '')) > 1000 THEN RAISE EXCEPTION '"%": nota grande demais (até 1000 caracteres)', r.nome; END IF;
    END LOOP;
    PERFORM public._clinica_exame_recalcular(e.id);
  END IF;
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_salvar(uuid, jsonb) TO authenticated;

-- ============ fechar e cancelar ============
CREATE OR REPLACE FUNCTION public.clinica_exame_fechar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  e public.pet_exames%ROWTYPE;
BEGIN
  e := public._clinica_exame_meu_aberto(p_id, v_vet);
  IF NOT EXISTS (SELECT 1 FROM public.pet_exame_resultados r
                  WHERE r.exame_id = e.id AND r.forma <> 'calculado' AND (r.valor_num IS NOT NULL OR r.valor_texto IS NOT NULL)) THEN
    RAISE EXCEPTION 'Preencha ao menos um resultado antes de fechar (ou cancele o exame)';
  END IF;
  PERFORM public._clinica_exame_recalcular(e.id);
  UPDATE public.pet_exames SET situacao = 'fechado', fechado_em = now() WHERE id = e.id;
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_fechar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_exame_cancelar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  e public.pet_exames%ROWTYPE;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  IF length(v_motivo) > 500 THEN RAISE EXCEPTION 'O motivo aceita até 500 caracteres'; END IF;
  e := public._clinica_exame_meu_aberto(p_id, v_vet);
  UPDATE public.pet_exames SET situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = v_motivo WHERE id = e.id;
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_cancelar(uuid, text) TO authenticated;

-- ============ adendo: correção ou complemento de exame fechado, por qualquer veterinário da clínica (identificado) ============
CREATE OR REPLACE FUNCTION public.clinica_exame_adendo_criar(p_exame_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_texto text := btrim(coalesce(p_texto, ''));
  e public.pet_exames%ROWTYPE;
  v_crmv text; v_uf text;
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Escreva o adendo'; END IF;
  IF length(v_texto) > 4000 THEN RAISE EXCEPTION 'O adendo aceita até 4000 caracteres'; END IF;
  SELECT * INTO e FROM public.pet_exames WHERE id = p_exame_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  IF e.situacao <> 'fechado' THEN RAISE EXCEPTION 'Adendo só em exame fechado: edite o exame aberto'; END IF;
  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
  INSERT INTO public.pet_exame_adendos (tenant_id, exame_id, veterinario_id, crmv, crmv_uf, texto) VALUES (e.tenant_id, e.id, v_vet, v_crmv, v_uf, v_texto);
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_adendo_criar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_adendo_criar(uuid, text) TO authenticated;

-- ============ consulta ============
CREATE OR REPLACE FUNCTION public.clinica_exame_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pet uuid;
  v_atend uuid;
BEGIN
  PERFORM public._clinica_vet();
  SELECT pet_id, atendimento_id INTO v_pet, v_atend FROM public.pet_exames WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (public.current_tenant_id(), v_pet, v_atend, 'exame');
  RETURN public._clinica_exame_json(p_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_get(uuid) TO authenticated;

-- Paciente e lista dos exames dele (sem os valores), do mais recente para o mais antigo.
CREATE OR REPLACE FUNCTION public.clinica_exames_do_pet(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  v_tutor text;
BEGIN
  PERFORM public._clinica_vet();
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT nome INTO v_tutor FROM public.clientes WHERE id = pt.cliente_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'exame');
  RETURN jsonb_build_object(
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'nascimento', pt.nascimento),
    'tutor', v_tutor,
    'exames', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'nome', e.nome, 'tipo', e.tipo, 'situacao', e.situacao, 'data_coleta', e.data_coleta, 'laboratorio', e.laboratorio,
               'atendimento_id', e.atendimento_id, 'aberto_em', e.aberto_em, 'veterinario', v.nome,
               'preenchidos', (SELECT count(*) FROM public.pet_exame_resultados r
                                WHERE r.exame_id = e.id AND r.forma <> 'calculado' AND (r.valor_num IS NOT NULL OR r.valor_texto IS NOT NULL)),
               'total', (SELECT count(*) FROM public.pet_exame_resultados r WHERE r.exame_id = e.id AND r.forma <> 'calculado'))
             ORDER BY e.data_coleta DESC, e.aberto_em DESC)
        FROM public.pet_exames e JOIN public.pet_profissionais v ON v.id = e.veterinario_id
       WHERE e.pet_id = pt.id AND e.tenant_id = v_tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_exames_do_pet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exames_do_pet(uuid) TO authenticated;

-- Evolução de um valor ao longo dos exames fechados do paciente (mesmo nome e mesma unidade), do mais antigo para o mais novo.
CREATE OR REPLACE FUNCTION public.clinica_exame_evolucao(p_pet_id uuid, p_nome text, p_unidade text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public._clinica_vet();
  PERFORM 1 FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF btrim(coalesce(p_nome, '')) = '' THEN RAISE EXCEPTION 'Informe o campo'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, p_pet_id, 'exame');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('exame_id', e.id, 'exame', e.nome, 'data_coleta', e.data_coleta, 'valor', r.valor_num,
                                         'faixa_min', r.faixa_min, 'faixa_max', r.faixa_max, 'casas', r.casas) ORDER BY e.data_coleta, e.fechado_em)
      FROM public.pet_exames e JOIN public.pet_exame_resultados r ON r.exame_id = e.id
     WHERE e.pet_id = p_pet_id AND e.tenant_id = v_tenant AND e.situacao = 'fechado' AND r.valor_num IS NOT NULL
       AND lower(btrim(r.nome)) = lower(btrim(p_nome)) AND coalesce(btrim(r.unidade), '') = coalesce(btrim(p_unidade), '')), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_evolucao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_evolucao(uuid, text, text) TO authenticated;

-- ===== 20261029000000_clinica_exames_anexos.sql =====
-- Clínica (Fase 4, PR 4): anexos do exame e do atendimento — imagem (ultrassom, raio-x), laudo em arquivo e exame laboratorial (JPEG, PNG ou PDF, até 15 MB).
-- Armazenamento privado (nada de endereço público): o arquivo só abre por um link temporário, que o cliente só consegue gerar logo depois de
-- registrar a abertura (quem, quando, qual anexo) por uma função que confere perfil Veterinário e clínica liberada.
-- O envio também passa por função: ela reserva o caminho (anexo "pendente") e só esse caminho aceita upload; a confirmação confere o arquivo.
-- Anexo é imutável: não se troca nem se apaga; enviado por engano vira "cancelado, com motivo", que sai da lista normal e continua no registro.
-- Nenhuma tabela tem acesso direto e as políticas do armazenamento não permitem alterar nem apagar objeto.

-- ============ bucket privado ============
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clinica-anexos', 'clinica-anexos', false, 15728640, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 15728640, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

-- ============ tabela ============
CREATE TABLE IF NOT EXISTS public.pet_exame_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  exame_id uuid REFERENCES public.pet_exames(id),
  atendimento_id uuid REFERENCES public.pet_atendimentos_clinicos(id),
  categoria text NOT NULL CHECK (categoria IN ('imagem', 'laudo', 'laboratorial')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 200),
  nome_arquivo text NOT NULL CHECK (length(btrim(nome_arquivo)) BETWEEN 1 AND 120),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'application/pdf')),
  tamanho bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 15728640),
  caminho text NOT NULL UNIQUE,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'ativo', 'cancelado')),
  enviado_por uuid NOT NULL DEFAULT auth.uid(),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz,
  cancelado_em timestamptz,
  cancelado_motivo text,
  cancelado_por uuid,
  CHECK ((exame_id IS NOT NULL) <> (atendimento_id IS NOT NULL)),
  CHECK ((situacao = 'pendente') = (confirmado_em IS NULL)),
  CHECK ((situacao = 'cancelado') = (cancelado_em IS NOT NULL AND length(btrim(coalesce(cancelado_motivo, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS pet_exame_anexos_exame_idx ON public.pet_exame_anexos (exame_id) WHERE exame_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pet_exame_anexos_atend_idx ON public.pet_exame_anexos (atendimento_id) WHERE atendimento_id IS NOT NULL;

-- Auditoria da abertura de cada anexo (a política de leitura do armazenamento depende dela).
ALTER TABLE public.clinica_acessos ADD COLUMN IF NOT EXISTS anexo_id uuid REFERENCES public.pet_exame_anexos(id);
ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao', 'exame', 'anexo'));
CREATE INDEX IF NOT EXISTS clinica_acessos_anexo_idx ON public.clinica_acessos (anexo_id, profile_id, created_at DESC) WHERE anexo_id IS NOT NULL;

-- O anexo só muda para ser confirmado (pendente → ativo) ou cancelado com motivo (ativo → cancelado); nunca se apaga.
CREATE OR REPLACE FUNCTION public._clinica_anexo_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O anexo não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'cancelado' THEN RAISE EXCEPTION 'Anexo cancelado não muda'; END IF;
  IF NOT ((OLD.situacao = 'pendente' AND NEW.situacao = 'ativo') OR (OLD.situacao = 'ativo' AND NEW.situacao = 'cancelado')) THEN
    RAISE EXCEPTION 'Os dados do anexo não mudam';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'confirmado_em' - 'cancelado_em' - 'cancelado_motivo' - 'cancelado_por')
     IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'confirmado_em' - 'cancelado_em' - 'cancelado_motivo' - 'cancelado_por') THEN
    RAISE EXCEPTION 'Os dados do anexo não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_anexo_guarda ON public.pet_exame_anexos;
CREATE TRIGGER trg_clinica_anexo_guarda BEFORE UPDATE OR DELETE ON public.pet_exame_anexos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_anexo_guarda();

ALTER TABLE public.pet_exame_anexos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_exame_anexos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pet_exame_anexos TO service_role;
CREATE POLICY salao_restrito ON public.pet_exame_anexos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- ============ políticas do armazenamento ============
-- Envio: só para um caminho reservado por clinica_anexo_preparar (anexo pendente, do próprio veterinário, na última hora).
CREATE OR REPLACE FUNCTION public._clinica_anexo_pode_enviar(p_caminho text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'veterinario') AND public.clinica_liberada()
     AND EXISTS (SELECT 1 FROM public.pet_exame_anexos a
                  WHERE a.caminho = p_caminho AND a.situacao = 'pendente' AND a.enviado_por = auth.uid()
                    AND a.tenant_id = public.current_tenant_id() AND a.created_at > now() - interval '1 hour')
$$;
REVOKE ALL ON FUNCTION public._clinica_anexo_pode_enviar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._clinica_anexo_pode_enviar(text) TO authenticated;

-- Leitura (gerar o link temporário): só logo depois de clinica_anexo_abrir, que registra quem abriu.
CREATE OR REPLACE FUNCTION public._clinica_anexo_pode_ler(p_caminho text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'veterinario') AND public.clinica_liberada()
     AND EXISTS (SELECT 1 FROM public.clinica_acessos ac JOIN public.pet_exame_anexos a ON a.id = ac.anexo_id
                  WHERE ac.acao = 'anexo' AND ac.profile_id = auth.uid() AND ac.tenant_id = public.current_tenant_id()
                    AND a.caminho = p_caminho AND a.tenant_id = ac.tenant_id AND a.situacao IN ('ativo', 'cancelado')
                    AND ac.created_at > now() - interval '2 minutes')
$$;
REVOKE ALL ON FUNCTION public._clinica_anexo_pode_ler(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._clinica_anexo_pode_ler(text) TO authenticated;

DROP POLICY IF EXISTS clinica_anexos_enviar ON storage.objects;
DROP POLICY IF EXISTS clinica_anexos_ler ON storage.objects;
CREATE POLICY clinica_anexos_enviar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clinica-anexos' AND public._clinica_anexo_pode_enviar(name));
CREATE POLICY clinica_anexos_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'clinica-anexos' AND public._clinica_anexo_pode_ler(name));
-- sem política de alterar ou apagar: o arquivo enviado não se troca nem se remove

-- ============ preparar o envio ============
-- p_dados: exame_id ou atendimento_id (um dos dois), categoria, descricao, nome_arquivo, mime, tamanho. Devolve o caminho a usar no upload.
CREATE OR REPLACE FUNCTION public.clinica_anexo_preparar(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_exame uuid := nullif(btrim(coalesce(p_dados ->> 'exame_id', '')), '')::uuid;
  v_atend uuid := nullif(btrim(coalesce(p_dados ->> 'atendimento_id', '')), '')::uuid;
  v_cat text := coalesce(p_dados ->> 'categoria', '');
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_nome text := btrim(coalesce(p_dados ->> 'nome_arquivo', ''));
  v_mime text := coalesce(p_dados ->> 'mime', '');
  v_tam bigint;
  v_pet uuid;
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_caminho text;
  v_crmv text; v_uf text;
  v_n integer;
BEGIN
  BEGIN
    v_tam := (p_dados ->> 'tamanho')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Tamanho do arquivo inválido';
  END;
  IF (v_exame IS NULL) = (v_atend IS NULL) THEN RAISE EXCEPTION 'Informe o exame ou o atendimento (só um dos dois)'; END IF;
  IF v_cat NOT IN ('imagem', 'laudo', 'laboratorial') THEN RAISE EXCEPTION 'Escolha o tipo do anexo: imagem, laudo ou exame laboratorial'; END IF;
  IF v_desc = '' THEN RAISE EXCEPTION 'Descreva o anexo (por exemplo, "Ultrassom abdominal")'; END IF;
  IF length(v_desc) > 200 THEN RAISE EXCEPTION 'A descrição aceita até 200 caracteres'; END IF;
  IF v_nome = '' OR length(v_nome) > 120 THEN RAISE EXCEPTION 'Nome do arquivo inválido (até 120 caracteres)'; END IF;
  v_ext := CASE v_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'application/pdf' THEN 'pdf' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Formato não aceito: envie JPEG, PNG ou PDF'; END IF;
  IF v_tam IS NULL OR v_tam < 1 THEN RAISE EXCEPTION 'Arquivo vazio'; END IF;
  IF v_tam > 15728640 THEN RAISE EXCEPTION 'O arquivo passa de 15 MB'; END IF;

  IF v_exame IS NOT NULL THEN
    SELECT pet_id INTO v_pet FROM public.pet_exames WHERE id = v_exame AND tenant_id = v_tenant AND situacao <> 'cancelado' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado ou cancelado'; END IF;
  ELSE
    SELECT pet_id INTO v_pet FROM public.pet_atendimentos_clinicos WHERE id = v_atend AND tenant_id = v_tenant FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  END IF;

  -- no máximo 20 anexos por exame ou atendimento (os pendentes de mais de uma hora não contam: o envio não aconteceu)
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_anexo:' || coalesce(v_exame, v_atend)::text, 0));
  SELECT count(*) INTO v_n FROM public.pet_exame_anexos a
   WHERE a.exame_id IS NOT DISTINCT FROM v_exame AND a.atendimento_id IS NOT DISTINCT FROM v_atend
     AND (a.situacao <> 'pendente' OR a.created_at > now() - interval '1 hour');
  IF v_n >= 20 THEN RAISE EXCEPTION 'Limite de 20 anexos por exame ou atendimento'; END IF;

  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
  v_caminho := v_tenant::text || '/' || v_pet::text || '/' || v_id::text || '.' || v_ext;
  INSERT INTO public.pet_exame_anexos (id, tenant_id, pet_id, exame_id, atendimento_id, categoria, descricao, nome_arquivo, mime, tamanho, caminho,
                                       veterinario_id, crmv, crmv_uf)
  VALUES (v_id, v_tenant, v_pet, v_exame, v_atend, v_cat, v_desc, v_nome, v_mime, v_tam, v_caminho, v_vet, v_crmv, v_uf);
  RETURN jsonb_build_object('id', v_id, 'caminho', v_caminho, 'mime', v_mime, 'tamanho', v_tam);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_preparar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_preparar(jsonb) TO authenticated;

-- ============ confirmar o envio ============
-- Confere que o arquivo está no armazenamento com o tamanho e o formato informados; só então o anexo passa a valer.
CREATE OR REPLACE FUNCTION public.clinica_anexo_confirmar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_exame_anexos%ROWTYPE;
  v_meta jsonb;
BEGIN
  SELECT * INTO a FROM public.pet_exame_anexos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR a.enviado_por <> auth.uid() OR a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  IF a.situacao <> 'pendente' THEN RAISE EXCEPTION 'Este anexo já foi confirmado'; END IF;
  SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'clinica-anexos' AND name = a.caminho;
  IF NOT FOUND THEN RAISE EXCEPTION 'O arquivo ainda não foi enviado: tente de novo'; END IF;
  IF coalesce(v_meta ->> 'size', '') <> a.tamanho::text OR coalesce(v_meta ->> 'mimetype', '') <> a.mime THEN
    RAISE EXCEPTION 'O arquivo enviado não confere com o informado: envie de novo';
  END IF;
  UPDATE public.pet_exame_anexos SET situacao = 'ativo', confirmado_em = now() WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_confirmar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_confirmar(uuid) TO authenticated;

-- ============ lista (sem o caminho do arquivo) ============
CREATE OR REPLACE FUNCTION public.clinica_anexos(p_exame_id uuid DEFAULT NULL, p_atendimento_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_pet uuid;
BEGIN
  IF (p_exame_id IS NULL) = (p_atendimento_id IS NULL) THEN RAISE EXCEPTION 'Informe o exame ou o atendimento (só um dos dois)'; END IF;
  IF p_exame_id IS NOT NULL THEN
    SELECT pet_id INTO v_pet FROM public.pet_exames WHERE id = p_exame_id AND tenant_id = v_tenant;
  ELSE
    SELECT pet_id INTO v_pet FROM public.pet_atendimentos_clinicos WHERE id = p_atendimento_id AND tenant_id = v_tenant;
  END IF;
  IF v_pet IS NULL THEN RAISE EXCEPTION 'Exame ou atendimento não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, v_pet, p_atendimento_id, 'anexo');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'categoria', a.categoria, 'descricao', a.descricao, 'nome_arquivo', a.nome_arquivo, 'mime', a.mime, 'tamanho', a.tamanho,
             'situacao', a.situacao, 'created_at', a.created_at, 'veterinario', v.nome, 'crmv', a.crmv, 'crmv_uf', a.crmv_uf,
             'cancelado_em', a.cancelado_em, 'cancelado_motivo', a.cancelado_motivo,
             -- só quem enviou cancela: a tela só oferece o botão para esse veterinário
             'pode_cancelar', (a.situacao = 'ativo' AND a.veterinario_id = v_vet AND a.enviado_por = auth.uid())) ORDER BY a.created_at)
      FROM public.pet_exame_anexos a JOIN public.pet_profissionais v ON v.id = a.veterinario_id
     WHERE a.tenant_id = v_tenant AND a.situacao <> 'pendente'
       AND a.exame_id IS NOT DISTINCT FROM p_exame_id AND a.atendimento_id IS NOT DISTINCT FROM p_atendimento_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexos(uuid, uuid) TO authenticated;

-- ============ abrir: registra quem abriu e libera, por 2 minutos, a geração do link temporário ============
CREATE OR REPLACE FUNCTION public.clinica_anexo_abrir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.pet_exame_anexos%ROWTYPE;
BEGIN
  PERFORM public._clinica_vet();
  SELECT * INTO a FROM public.pet_exame_anexos WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao IN ('ativo', 'cancelado');
  IF NOT FOUND THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao, anexo_id) VALUES (a.tenant_id, a.pet_id, a.atendimento_id, 'anexo', a.id);
  RETURN jsonb_build_object('caminho', a.caminho, 'mime', a.mime, 'nome_arquivo', a.nome_arquivo);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_abrir(uuid) TO authenticated;

-- ============ cancelar (só quem enviou; o arquivo e o registro continuam) ============
CREATE OR REPLACE FUNCTION public.clinica_anexo_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  a public.pet_exame_anexos%ROWTYPE;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  IF length(v_motivo) > 500 THEN RAISE EXCEPTION 'O motivo aceita até 500 caracteres'; END IF;
  SELECT * INTO a FROM public.pet_exame_anexos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  IF a.veterinario_id <> v_vet OR a.enviado_por <> auth.uid() THEN RAISE EXCEPTION 'Só o veterinário que enviou o anexo o cancela'; END IF;
  IF a.situacao <> 'ativo' THEN RAISE EXCEPTION 'Este anexo não está ativo'; END IF;
  UPDATE public.pet_exame_anexos SET situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = v_motivo, cancelado_por = auth.uid() WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_cancelar(uuid, text) TO authenticated;

-- ===== 20261030000000_clinica_visita_preparar.sql =====
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

-- ===== 20261031000000_clinica_cadastro_rapido.sql =====
-- Clínica (Fase 4, PR 5b): cadastro rápido de tutor e pet pelo veterinário, feito (também) sem internet. O veterinário é um perfil restrito e não
-- usa o cadastro de clientes e pets; esta função da clínica cria só o essencial (nome e telefone do tutor, e o pet — cão ou gato) com os
-- identificadores que nasceram no notebook, para o pet novo já receber atendimento antes de a fila sincronizar. A chave de repetição vem da
-- operação da fila: reenviar a mesma chave devolve o mesmo resultado e não duplica nada. Tutor com o mesmo telefone de um cadastro existente é
-- criado mesmo assim e marcado nas observações, para a recepção conferir e unir; nada é apagado nem alterado no cadastro que já existia.

CREATE TABLE IF NOT EXISTS public.clinica_cadastros_rapidos (
  chave uuid PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  criado_por uuid NOT NULL DEFAULT auth.uid(),
  possivel_duplicado_de uuid REFERENCES public.clientes(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinica_cadastros_rapidos_idx ON public.clinica_cadastros_rapidos (tenant_id, created_at DESC);

ALTER TABLE public.clinica_cadastros_rapidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinica_cadastros_rapidos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinica_cadastros_rapidos TO service_role;
CREATE POLICY salao_restrito ON public.clinica_cadastros_rapidos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- Telefone só em dígitos e sem o 55 do país (quando sobram 10 ou 11 dígitos): "+55 (16) 98888-1111" e "(16) 98888-1111" são o mesmo número.
CREATE OR REPLACE FUNCTION public._fone_normalizado(p_fone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN d ~ '^55[0-9]{10,11}$' THEN substr(d, 3) ELSE d END
    FROM (SELECT regexp_replace(coalesce(p_fone, ''), '\D', '', 'g') AS d) x
$$;
REVOKE ALL ON FUNCTION public._fone_normalizado(text) FROM PUBLIC, anon, authenticated;

-- p_dados: cliente_id (tutor que já existe) OU cliente {id, nome, telefone} (tutor novo, com o id nascido no notebook);
-- pet {id, nome, especie (cao|gato), raca, sexo, porte, nascimento, peso_kg, castrado, alergias}.
CREATE OR REPLACE FUNCTION public.clinica_cadastro_rapido(p_chave uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_pet jsonb := p_dados -> 'pet';
  v_cli jsonb := p_dados -> 'cliente';
  v_cli_existente uuid;
  v_cli_id uuid;
  v_pet_id uuid;
  v_nome_tutor text;
  v_fone text;
  v_digitos text;
  v_norm text;
  v_dup_id uuid;
  v_dup_nome text;
  v_obs text;
  v_nome_pet text;
  v_especie text;
  v_peso numeric;
  v_nasc date;
  v_resultado jsonb;
BEGIN
  PERFORM public._clinica_vet();
  IF p_chave IS NULL THEN RAISE EXCEPTION 'Operação sem chave de repetição'; END IF;
  IF v_pet IS NULL OR jsonb_typeof(v_pet) <> 'object' THEN RAISE EXCEPTION 'Informe os dados do pet'; END IF;

  -- mesma chave: devolve o que já foi feito (reenvio da fila), sem criar nada
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_cadastro_rapido:' || p_chave::text, 0));
  SELECT jsonb_build_object('cliente_id', cliente_id, 'pet_id', pet_id, 'repetido', true,
                            'possivel_duplicado_de', possivel_duplicado_de)
    INTO v_resultado FROM public.clinica_cadastros_rapidos WHERE chave = p_chave AND tenant_id = v_tenant;
  IF v_resultado IS NOT NULL THEN RETURN v_resultado; END IF;
  IF EXISTS (SELECT 1 FROM public.clinica_cadastros_rapidos WHERE chave = p_chave) THEN RAISE EXCEPTION 'Chave de repetição já usada'; END IF;

  BEGIN
    v_cli_existente := nullif(btrim(coalesce(p_dados ->> 'cliente_id', '')), '')::uuid;
    v_cli_id := nullif(btrim(coalesce(v_cli ->> 'id', '')), '')::uuid;
    v_pet_id := nullif(btrim(coalesce(v_pet ->> 'id', '')), '')::uuid;
    v_peso := nullif(replace(btrim(coalesce(v_pet ->> 'peso_kg', '')), ',', '.'), '')::numeric;
    v_nasc := nullif(btrim(coalesce(v_pet ->> 'nascimento', '')), '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira os identificadores, o peso e a data de nascimento';
  END;

  -- pet
  v_nome_pet := btrim(coalesce(v_pet ->> 'nome', ''));
  v_especie := coalesce(nullif(v_pet ->> 'especie', ''), 'cao');
  IF v_pet_id IS NULL THEN RAISE EXCEPTION 'O pet precisa de um identificador'; END IF;
  IF v_nome_pet = '' OR length(v_nome_pet) > 80 THEN RAISE EXCEPTION 'Informe o nome do pet (até 80 letras)'; END IF;
  IF v_especie NOT IN ('cao', 'gato') THEN RAISE EXCEPTION 'Escolha cão ou gato'; END IF;
  IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso > 200) THEN RAISE EXCEPTION 'Peso fora do esperado (até 200 kg)'; END IF;
  IF v_nasc IS NOT NULL AND v_nasc > v_hoje THEN RAISE EXCEPTION 'O nascimento não pode ser no futuro'; END IF;
  IF nullif(v_pet ->> 'sexo', '') IS NOT NULL AND v_pet ->> 'sexo' NOT IN ('macho', 'femea') THEN RAISE EXCEPTION 'Sexo inválido'; END IF;
  IF nullif(v_pet ->> 'porte', '') IS NOT NULL AND v_pet ->> 'porte' NOT IN ('mini', 'pequeno', 'medio', 'grande', 'gigante') THEN RAISE EXCEPTION 'Porte inválido'; END IF;
  IF length(coalesce(v_pet ->> 'raca', '')) > 60 OR length(coalesce(v_pet ->> 'alergias', '')) > 1000 THEN RAISE EXCEPTION 'Raça ou alergias grande demais'; END IF;
  IF jsonb_typeof(v_pet -> 'castrado') IS NOT NULL AND jsonb_typeof(v_pet -> 'castrado') NOT IN ('boolean', 'null') THEN RAISE EXCEPTION 'Castrado precisa ser sim ou não'; END IF;
  IF EXISTS (SELECT 1 FROM public.pets WHERE id = v_pet_id) THEN RAISE EXCEPTION 'Identificador do pet já usado'; END IF;

  -- tutor: um que já existe, ou um novo
  IF v_cli_existente IS NOT NULL THEN
    IF v_cli IS NOT NULL AND jsonb_typeof(v_cli) = 'object' THEN RAISE EXCEPTION 'Informe o tutor que já existe ou um tutor novo, não os dois'; END IF;
    PERFORM 1 FROM public.clientes WHERE id = v_cli_existente AND tenant_id = v_tenant AND ativo AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tutor não encontrado'; END IF;
    v_cli_id := v_cli_existente;
  ELSE
    IF v_cli IS NULL OR jsonb_typeof(v_cli) <> 'object' THEN RAISE EXCEPTION 'Informe o tutor'; END IF;
    v_nome_tutor := btrim(coalesce(v_cli ->> 'nome', ''));
    v_fone := nullif(btrim(coalesce(v_cli ->> 'telefone', '')), '');
    IF v_cli_id IS NULL THEN RAISE EXCEPTION 'O tutor precisa de um identificador'; END IF;
    IF length(v_nome_tutor) < 2 OR length(v_nome_tutor) > 120 THEN RAISE EXCEPTION 'Informe o nome do tutor (de 2 a 120 letras)'; END IF;
    v_digitos := regexp_replace(coalesce(v_fone, ''), '\D', '', 'g');
    v_norm := public._fone_normalizado(v_fone);
    IF v_fone IS NOT NULL AND (length(v_digitos) < 10 OR length(v_digitos) > 13 OR length(v_fone) > 30) THEN
      RAISE EXCEPTION 'Telefone inválido: informe com DDD';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cli_id) THEN RAISE EXCEPTION 'Identificador do tutor já usado'; END IF;
    -- o mesmo telefone em outro cadastro: cria assim mesmo e avisa a recepção (sem mexer no cadastro antigo).
    -- Duas sincronizações do mesmo tutor ao mesmo tempo (aparelhos diferentes, chaves diferentes) esperam uma pela outra: a segunda enxerga a primeira.
    IF length(v_norm) >= 10 THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('clinica_cadastro_fone:' || v_tenant::text || ':' || v_norm, 0));
      SELECT c.id, c.nome INTO v_dup_id, v_dup_nome FROM public.clientes c
       WHERE c.tenant_id = v_tenant AND c.ativo AND c.deleted_at IS NULL
         AND (public._fone_normalizado(c.telefone) = v_norm OR public._fone_normalizado(c.whatsapp) = v_norm)
       ORDER BY c.created_at LIMIT 1;
    END IF;
    v_obs := 'Cadastro rápido da clínica (veterinário).';
    IF v_dup_id IS NOT NULL THEN
      v_obs := v_obs || ' Possível duplicado do cadastro "' || v_dup_nome || '" (mesmo telefone): a recepção confere e une.';
    END IF;
    INSERT INTO public.clientes (id, tenant_id, nome, telefone, whatsapp, observacoes)
    VALUES (v_cli_id, v_tenant, v_nome_tutor, v_fone, v_fone, v_obs);
  END IF;

  INSERT INTO public.pets (id, tenant_id, cliente_id, nome, especie, raca, porte, sexo, nascimento, peso_kg, castrado, alergias, ativo)
  VALUES (v_pet_id, v_tenant, v_cli_id, v_nome_pet, v_especie, nullif(btrim(coalesce(v_pet ->> 'raca', '')), ''), nullif(v_pet ->> 'porte', ''),
          nullif(v_pet ->> 'sexo', ''), v_nasc, v_peso, (v_pet ->> 'castrado')::boolean, nullif(btrim(coalesce(v_pet ->> 'alergias', '')), ''), true);

  INSERT INTO public.clinica_cadastros_rapidos (chave, tenant_id, cliente_id, pet_id, possivel_duplicado_de)
  VALUES (p_chave, v_tenant, v_cli_id, v_pet_id, v_dup_id);
  RETURN jsonb_build_object('cliente_id', v_cli_id, 'pet_id', v_pet_id, 'repetido', false, 'possivel_duplicado_de', v_dup_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_cadastro_rapido(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_cadastro_rapido(uuid, jsonb) TO authenticated;

-- ===== 20261101000000_clinica_atendimento_offline.sql =====
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

-- ===== 20261102000000_clinica_vacina_exame_offline.sql =====
-- Clínica (Fase 4, PR 5d): vacina e exame sem internet. Cada operação leva uma chave de repetição (reenviar devolve o mesmo resultado).
-- Vacina: aplicar numa consulta de vacina da agenda ou sem agendamento (a função cria o atendimento de vacina já em andamento, com o preço
-- do serviço) e registrar vacina aplicada em outro local. Se o lote acabou antes do envio, a função recusa, nada é gravado e a operação fica
-- guardada no notebook: o veterinário escolhe outro lote e reenvia com a mesma chave (a recusa não grava chave).
-- Exame: o id do exame nasce no banco; as operações seguintes apontam para a chave da abertura e os resultados são ditos pelo campo do modelo
-- (o notebook ainda não conhece o id de cada resultado).

-- Resultado já guardado de uma operação anterior (para as operações seguintes apontarem para ela); recusa chave de outro usuário ou empresa.
CREATE OR REPLACE FUNCTION public._clinica_op_resultado(p_chave uuid, p_tipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE o public.clinica_operacoes_offline%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.clinica_operacoes_offline WHERE chave = p_chave;
  IF NOT FOUND OR o.tenant_id <> public.current_tenant_id() OR o.profile_id <> auth.uid() OR o.tipo <> p_tipo THEN
    RAISE EXCEPTION 'A operação anterior (abertura) ainda não chegou ao servidor ou não é sua';
  END IF;
  RETURN o.resultado;
END $$;
REVOKE ALL ON FUNCTION public._clinica_op_resultado(uuid, text) FROM PUBLIC, anon, authenticated;

-- Atendimento de serviço (vacina) criado de uma vez, já em andamento, com o preço que a agenda calcularia.
CREATE OR REPLACE FUNCTION public._clinica_agendamento_avulso(p_pet uuid, p_servico uuid, p_categoria text, p_inicio timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  sv public.pet_servicos%ROWTYPE;
  v_preco numeric;
  v_id uuid;
BEGIN
  SELECT * INTO pt FROM public.pets WHERE id = p_pet AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = v_vet;
  SELECT * INTO sv FROM public.pet_servicos WHERE id = p_servico AND tenant_id = v_tenant AND ativo AND categoria = p_categoria;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um serviço de % ativo', p_categoria; END IF;
  SELECT p.preco INTO v_preco FROM public.pet_servico_precos p
   WHERE p.servico_id = sv.id AND p.tenant_id = v_tenant
     AND (p.porte IS NULL OR p.porte = pt.porte)
     AND (p.raca IS NULL OR lower(btrim(p.raca)) = lower(btrim(coalesce(pt.raca, ''))))
     AND (p.pelagem IS NULL OR p.pelagem = pt.pelagem)
   ORDER BY (CASE WHEN p.raca IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.pelagem IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN p.porte IS NOT NULL THEN 1 ELSE 0 END) DESC
   LIMIT 1;
  IF v_preco IS NULL THEN RAISE EXCEPTION 'O serviço "%" não tem preço cadastrado para este paciente: peça à gestão e reenvie', sv.nome; END IF;
  INSERT INTO public.pet_agendamentos (tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao, observacoes)
  VALUES (v_tenant, pf.filial_id, pt.id, pt.cliente_id, v_vet, p_inicio, p_inicio + make_interval(mins => sv.duracao_min), 'em_atendimento',
          'Registrado pela clínica durante a visita, sem agendamento')
  RETURNING id INTO v_id;
  INSERT INTO public.pet_agendamento_itens (tenant_id, agendamento_id, servico_id, preco_aplicado, duracao_min)
  VALUES (v_tenant, v_id, sv.id, round(v_preco, 2), sv.duracao_min);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._clinica_agendamento_avulso(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- ============ vacina ============
-- aplicar: p_dados = os de clinica_vacina_aplicar mais, ou agendamento_id (consulta de vacina da agenda), ou pet_id e servico_id (sem agendamento).
-- externa: p_dados = pet_id mais os de clinica_vacina_registrar_externa.
CREATE OR REPLACE FUNCTION public.clinica_vacina_offline(p_chave uuid, p_acao text, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rep jsonb;
  v_ag uuid;
  v_pet uuid;
  v_serv uuid;
  v_em date;
  r jsonb;
  v_resultado jsonb;
BEGIN
  PERFORM public._clinica_vet();
  IF p_acao IS NULL OR p_acao NOT IN ('aplicar', 'externa') THEN RAISE EXCEPTION 'Ação inválida: aplicar ou externa'; END IF;
  v_rep := public._clinica_op_repetida(p_chave, 'vacina_' || p_acao);
  IF v_rep IS NOT NULL THEN RETURN v_rep; END IF;
  BEGIN
    v_ag := nullif(btrim(coalesce(p_dados ->> 'agendamento_id', '')), '')::uuid;
    v_pet := nullif(btrim(coalesce(p_dados ->> 'pet_id', '')), '')::uuid;
    v_serv := nullif(btrim(coalesce(p_dados ->> 'servico_id', '')), '')::uuid;
    v_em := nullif(btrim(coalesce(p_dados ->> 'aplicada_em', '')), '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira os identificadores e a data da aplicação';
  END;

  IF p_acao = 'externa' THEN
    IF v_pet IS NULL THEN RAISE EXCEPTION 'Informe o paciente'; END IF;
    r := public.clinica_vacina_registrar_externa(v_pet, p_dados - 'pet_id');
    v_resultado := jsonb_build_object('vacinacao_id', r ->> 'id', 'dose_tipo', r ->> 'dose_tipo', 'dose_numero', (r ->> 'dose_numero')::int,
                                      'proxima_dose_em', r ->> 'proxima_dose_em');
  ELSE
    IF (v_ag IS NULL) = (v_pet IS NULL OR v_serv IS NULL) THEN
      RAISE EXCEPTION 'Informe a consulta de vacina da agenda ou o paciente com o serviço de vacina (só um dos dois)';
    END IF;
    IF v_ag IS NULL THEN
      IF v_em IS NULL THEN RAISE EXCEPTION 'Informe a data da aplicação'; END IF;
      v_ag := public._clinica_agendamento_avulso(v_pet, v_serv, 'vacina', (v_em + time '12:00') AT TIME ZONE 'America/Sao_Paulo');
    END IF;
    r := public.clinica_vacina_aplicar(v_ag, p_dados - 'agendamento_id' - 'pet_id' - 'servico_id');
    v_resultado := jsonb_build_object('vacinacao_id', r ->> 'id', 'agendamento_id', v_ag, 'dose_tipo', r ->> 'dose_tipo',
                                      'dose_numero', (r ->> 'dose_numero')::int, 'proxima_dose_em', r ->> 'proxima_dose_em', 'avisos', r -> 'avisos');
  END IF;
  INSERT INTO public.clinica_operacoes_offline (chave, tenant_id, tipo, resultado) VALUES (p_chave, public.current_tenant_id(), 'vacina_' || p_acao, v_resultado);
  RETURN v_resultado || jsonb_build_object('repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_offline(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_offline(uuid, text, jsonb) TO authenticated;

-- ============ exame ============
-- abrir: p_dados = pet_id, modelo_id e os de clinica_exame_abrir (atendimento_id é o id que nasceu no notebook).
-- salvar: p_dados = abrir_chave (a chave da operação que abriu), material, laboratorio, data_coleta, observacoes e
--         resultados [{campo_id, valor, nota, faixa_min, faixa_max}] (o campo do modelo, não o id do resultado).
-- fechar: p_dados = abrir_chave.
CREATE OR REPLACE FUNCTION public.clinica_exame_offline(p_chave uuid, p_acao text, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rep jsonb;
  v_exame uuid;
  v_abrir uuid;
  v_dados jsonb;
  v_res jsonb;
  r jsonb;
  v_resultado jsonb;
BEGIN
  PERFORM public._clinica_vet();
  IF p_acao IS NULL OR p_acao NOT IN ('abrir', 'salvar', 'fechar') THEN RAISE EXCEPTION 'Ação inválida: abrir, salvar ou fechar'; END IF;
  v_rep := public._clinica_op_repetida(p_chave, 'exame_' || p_acao);
  IF v_rep IS NOT NULL THEN RETURN v_rep; END IF;

  IF p_acao = 'abrir' THEN
    BEGIN
      r := public.clinica_exame_abrir((p_dados ->> 'pet_id')::uuid, (p_dados ->> 'modelo_id')::uuid, p_dados - 'pet_id' - 'modelo_id');
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Confira o paciente e o modelo do exame';
    END;
    v_resultado := jsonb_build_object('exame_id', r ->> 'id');
  ELSE
    BEGIN
      v_abrir := (p_dados ->> 'abrir_chave')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Operação de abertura do exame inválida';
    END;
    v_exame := ((public._clinica_op_resultado(v_abrir, 'exame_abrir')) ->> 'exame_id')::uuid;
    IF p_acao = 'salvar' THEN
      v_dados := p_dados - 'abrir_chave' - 'resultados';
      IF p_dados ? 'resultados' THEN
        IF jsonb_typeof(p_dados -> 'resultados') <> 'array' THEN RAISE EXCEPTION 'Resultados em formato inválido'; END IF;
        -- cada item diz o campo do modelo; vira o id do resultado deste exame
        SELECT coalesce(jsonb_agg((it - 'campo_id') || jsonb_build_object('id', rr.id) ORDER BY rr.ordem), '[]'::jsonb) INTO v_res
          FROM jsonb_array_elements(p_dados -> 'resultados') it
          LEFT JOIN public.pet_exame_resultados rr ON rr.exame_id = v_exame AND rr.campo_id = nullif(it ->> 'campo_id', '')::uuid;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) x WHERE x -> 'id' = 'null'::jsonb) THEN
          RAISE EXCEPTION 'Um dos campos não faz parte do exame aberto (o modelo mudou?)';
        END IF;
        v_dados := v_dados || jsonb_build_object('resultados', v_res);
      END IF;
      r := public.clinica_exame_salvar(v_exame, v_dados);
      v_resultado := jsonb_build_object('exame_id', v_exame, 'situacao', r ->> 'situacao');
    ELSE
      r := public.clinica_exame_fechar(v_exame);
      v_resultado := jsonb_build_object('exame_id', v_exame, 'situacao', r ->> 'situacao');
    END IF;
  END IF;
  INSERT INTO public.clinica_operacoes_offline (chave, tenant_id, tipo, resultado) VALUES (p_chave, public.current_tenant_id(), 'exame_' || p_acao, v_resultado);
  RETURN v_resultado || jsonb_build_object('repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_offline(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_offline(uuid, text, jsonb) TO authenticated;

-- ============ a cópia da visita passa a levar também os serviços de vacina ============
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
  v_serv_vacina jsonb;
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

  -- serviços de vacina ativos, para aplicar sem agendamento (o preço é conferido na hora de enviar)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', sv.id, 'nome', sv.nome, 'duracao_min', sv.duracao_min) ORDER BY sv.nome), '[]'::jsonb) INTO v_serv_vacina
    FROM public.pet_servicos sv WHERE sv.tenant_id = v_tenant AND sv.ativo AND sv.categoria = 'vacina';

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
    'servicos_consulta', v_servicos,
    'servicos_vacina', v_serv_vacina);
END $$;

REVOKE ALL ON FUNCTION public.clinica_visita_preparar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_visita_preparar(integer) TO authenticated;
