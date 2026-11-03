-- Pet: campos personalizados do animal e do tutor. A clínica define os campos (nome, tipo, lista de opções, obrigatório)
-- e cada pet ou tutor guarda os valores. Escrita só por funções; leitura pela política da empresa e trava do salão.

CREATE TABLE IF NOT EXISTS public.pet_campos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  entidade text NOT NULL CHECK (entidade IN ('pet', 'tutor')),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  tipo text NOT NULL CHECK (tipo IN ('texto', 'numero', 'data', 'sim_nao', 'lista')),
  opcoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opcoes) = 'array'),
  obrigatorio boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 999),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_campos_nome_idx ON public.pet_campos (tenant_id, entidade, lower(btrim(nome)));

-- registro_id é o pet ou o tutor (cliente), conforme a entidade do campo; não há chave estrangeira porque aponta para duas tabelas.
CREATE TABLE IF NOT EXISTS public.pet_campos_valores (
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  campo_id uuid NOT NULL REFERENCES public.pet_campos(id) ON DELETE CASCADE,
  registro_id uuid NOT NULL,
  valor text NOT NULL CHECK (length(valor) BETWEEN 1 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campo_id, registro_id)
);
CREATE INDEX IF NOT EXISTS pet_campos_valores_registro_idx ON public.pet_campos_valores (tenant_id, registro_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_campos', 'pet_campos_valores'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_pet_campos_updated ON public.pet_campos;
CREATE TRIGGER trg_pet_campos_updated BEFORE UPDATE ON public.pet_campos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ definição dos campos (administrador e gestor) ============
CREATE OR REPLACE FUNCTION public.pet_campo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_entidade text := coalesce(p_dados ->> 'entidade', '');
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_tipo text := coalesce(p_dados ->> 'tipo', 'texto');
  v_opcoes jsonb := '[]'::jsonb;
  v_ordem integer := coalesce(nullif(p_dados ->> 'ordem', '')::integer, 0);
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_atual public.pet_campos%ROWTYPE;
  o text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' OR length(v_nome) > 60 THEN RAISE EXCEPTION 'Informe o nome do campo (até 60 letras)'; END IF;
  IF v_tipo NOT IN ('texto', 'numero', 'data', 'sim_nao', 'lista') THEN RAISE EXCEPTION 'Tipo de campo inválido'; END IF;
  IF v_ordem < 0 OR v_ordem > 999 THEN RAISE EXCEPTION 'A ordem fica entre 0 e 999'; END IF;
  IF v_tipo = 'lista' THEN
    IF jsonb_typeof(p_dados -> 'opcoes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Informe as opções da lista'; END IF;
    FOR o IN SELECT btrim(x) FROM jsonb_array_elements_text(p_dados -> 'opcoes') x LOOP
      IF o = '' THEN CONTINUE; END IF;
      IF length(o) > 60 THEN RAISE EXCEPTION 'Cada opção tem até 60 letras'; END IF;
      IF v_opcoes ? o THEN RAISE EXCEPTION 'Opção repetida: %', o; END IF;
      v_opcoes := v_opcoes || to_jsonb(o);
    END LOOP;
    IF jsonb_array_length(v_opcoes) < 2 THEN RAISE EXCEPTION 'A lista precisa de pelo menos 2 opções'; END IF;
    IF jsonb_array_length(v_opcoes) > 30 THEN RAISE EXCEPTION 'A lista aceita até 30 opções'; END IF;
  END IF;

  IF v_id IS NULL THEN
    IF v_entidade NOT IN ('pet', 'tutor') THEN RAISE EXCEPTION 'Os campos são do pet ou do tutor'; END IF;
    IF (SELECT count(*) FROM public.pet_campos WHERE tenant_id = v_tenant AND entidade = v_entidade) >= 30 THEN
      RAISE EXCEPTION 'Limite de 30 campos por cadastro';
    END IF;
    INSERT INTO public.pet_campos (tenant_id, entidade, nome, tipo, opcoes, obrigatorio, ordem, ativo)
    VALUES (v_tenant, v_entidade, v_nome, v_tipo, v_opcoes, coalesce((p_dados ->> 'obrigatorio')::boolean, false), v_ordem, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_atual FROM public.pet_campos WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
    -- o tipo não muda com valores já guardados (o texto antigo poderia deixar de caber no novo tipo)
    IF v_tipo <> v_atual.tipo AND EXISTS (SELECT 1 FROM public.pet_campos_valores WHERE campo_id = v_id) THEN
      RAISE EXCEPTION 'Este campo já tem valores guardados: crie outro campo em vez de mudar o tipo';
    END IF;
    -- opção retirada da lista que ainda está em uso fica de fora: mantém os valores válidos
    IF v_tipo = 'lista' AND EXISTS (SELECT 1 FROM public.pet_campos_valores v WHERE v.campo_id = v_id AND NOT (v_opcoes ? v.valor)) THEN
      RAISE EXCEPTION 'Há cadastros usando uma opção que você retirou da lista: mantenha a opção ou desative o campo';
    END IF;
    UPDATE public.pet_campos SET nome = v_nome, tipo = v_tipo, opcoes = v_opcoes,
           obrigatorio = coalesce((p_dados ->> 'obrigatorio')::boolean, false), ordem = v_ordem, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_campo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_campo_salvar(jsonb) TO authenticated;

-- ============ valores de um pet ou tutor ============
-- p_valores: {"<id do campo>": "valor"}. Valor vazio apaga. Campo obrigatório ativo sem valor recusa o salvamento.
-- Os valores dos campos que não vêm no pacote ficam como estão (campo desativado mantém o que já tinha).
CREATE OR REPLACE FUNCTION public.pet_campos_valores_salvar(p_entidade text, p_registro_id uuid, p_valores jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  c public.pet_campos%ROWTYPE;
  v_chave text;
  v_valor text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_entidade NOT IN ('pet', 'tutor') THEN RAISE EXCEPTION 'Os campos são do pet ou do tutor'; END IF;
  IF jsonb_typeof(p_valores) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Valores inválidos'; END IF;
  IF p_entidade = 'pet' AND NOT EXISTS (SELECT 1 FROM public.pets WHERE id = p_registro_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Pet não encontrado';
  END IF;
  IF p_entidade = 'tutor' AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_registro_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Tutor não encontrado';
  END IF;

  FOR v_chave IN SELECT jsonb_object_keys(p_valores) LOOP
    SELECT * INTO c FROM public.pet_campos WHERE id = v_chave::uuid AND tenant_id = v_tenant AND entidade = p_entidade;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
    v_valor := nullif(btrim(coalesce(p_valores ->> v_chave, '')), '');
    IF v_valor IS NULL THEN
      IF c.obrigatorio AND c.ativo THEN RAISE EXCEPTION 'Preencha o campo "%"', c.nome; END IF;
      DELETE FROM public.pet_campos_valores WHERE campo_id = c.id AND registro_id = p_registro_id;
      CONTINUE;
    END IF;
    IF NOT c.ativo THEN RAISE EXCEPTION 'O campo "%" está desativado', c.nome; END IF;
    IF length(v_valor) > 500 THEN RAISE EXCEPTION 'O campo "%" aceita até 500 letras', c.nome; END IF;
    IF c.tipo = 'numero' AND v_valor !~ '^-?[0-9]+([.][0-9]+)?$' THEN RAISE EXCEPTION 'O campo "%" aceita só número', c.nome; END IF;
    IF c.tipo = 'data' THEN
      BEGIN
        PERFORM v_valor::date;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'O campo "%" precisa de uma data válida', c.nome;
      END;
      IF v_valor !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'O campo "%" precisa de uma data válida', c.nome; END IF;
    END IF;
    IF c.tipo = 'sim_nao' AND v_valor NOT IN ('sim', 'nao') THEN RAISE EXCEPTION 'O campo "%" aceita sim ou não', c.nome; END IF;
    IF c.tipo = 'lista' AND NOT (c.opcoes ? v_valor) THEN RAISE EXCEPTION 'O campo "%" não tem a opção "%"', c.nome, v_valor; END IF;
    INSERT INTO public.pet_campos_valores (tenant_id, campo_id, registro_id, valor)
    VALUES (v_tenant, c.id, p_registro_id, v_valor)
    ON CONFLICT (campo_id, registro_id) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
  END LOOP;

  -- obrigatório ativo que nem veio no pacote e ainda não tem valor
  FOR c IN SELECT * FROM public.pet_campos
            WHERE tenant_id = v_tenant AND entidade = p_entidade AND ativo AND obrigatorio AND NOT (p_valores ? id::text)
              AND NOT EXISTS (SELECT 1 FROM public.pet_campos_valores v WHERE v.campo_id = id AND v.registro_id = p_registro_id) LOOP
    RAISE EXCEPTION 'Preencha o campo "%"', c.nome;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pet_campos_valores_salvar(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_campos_valores_salvar(text, uuid, jsonb) TO authenticated;
