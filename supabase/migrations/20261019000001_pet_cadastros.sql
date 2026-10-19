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
