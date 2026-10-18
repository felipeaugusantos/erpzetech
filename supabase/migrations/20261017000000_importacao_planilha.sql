-- Fase 1: importação em massa por planilha (produtos, clientes e saldos de estoque).
-- Cada importação é uma única chamada ao banco, numa transação: ou entra tudo ou nada. A mesma função confere as linhas
-- (simulação, para a pré-visualização) e grava (importação), com limite de linhas e uma importação por vez por empresa.

CREATE TABLE IF NOT EXISTS public.importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  usuario_id uuid DEFAULT auth.uid(),
  tipo text NOT NULL CHECK (tipo IN ('produtos', 'clientes', 'saldos')),
  arquivo text,
  linhas integer NOT NULL,
  criados integer NOT NULL DEFAULT 0,
  atualizados integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS importacoes_tenant_idx ON public.importacoes (tenant_id, created_at DESC);

ALTER TABLE public.importacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.importacoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.importacoes TO authenticated;
GRANT ALL ON public.importacoes TO service_role;
CREATE POLICY importacoes_ler ON public.importacoes FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'estoquista')));
CREATE POLICY salao_restrito ON public.importacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- Apoio: acrescenta um erro de linha à lista (guarda no máximo 200 mensagens, mas o total é contado por quem chama).
CREATE OR REPLACE FUNCTION public._imp_erro(p_lista jsonb, p_linha integer, p_msg text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_array_length(p_lista) >= 200 THEN p_lista
              ELSE p_lista || jsonb_build_array(jsonb_build_object('linha', p_linha, 'mensagem', p_msg)) END
$$;
REVOKE ALL ON FUNCTION public._imp_erro(jsonb, integer, text) FROM PUBLIC, anon, authenticated;

-- Número de uma célula: nulo se vazio; erro se não for número.
CREATE OR REPLACE FUNCTION public._imp_num(p_item jsonb, p_campo text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_item -> p_campo IS NULL OR jsonb_typeof(p_item -> p_campo) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_item -> p_campo) <> 'number' THEN RAISE EXCEPTION 'valor inválido em %', p_campo; END IF;
  RETURN (p_item ->> p_campo)::numeric;
END $$;
REVOKE ALL ON FUNCTION public._imp_num(jsonb, text) FROM PUBLIC, anon, authenticated;

-- ===== Produtos =====
-- p_linhas: [{linha, codigo_interno, descricao, unidade, preco_venda, custo, codigo_barras, ncm, cfop, cst_csosn,
--             categoria, marca, fabricante, estoque_minimo, estoque_maximo, localizacao}]
-- Código novo cria o produto; código que já existe só é atualizado se p_atualizar (e só nos campos preenchidos).
-- Categoria que não existe é criada.
CREATE OR REPLACE FUNCTION public.importar_produtos(
  p_linhas jsonb, p_atualizar boolean DEFAULT false, p_simular boolean DEFAULT false, p_arquivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb;
  v_linha integer;
  v_cod text; v_desc text; v_un text; v_preco numeric; v_custo numeric; v_barras text; v_ncm text; v_cfop text;
  v_cst text; v_cat text; v_marca text; v_fab text; v_min numeric; v_max numeric; v_loc text;
  v_exist uuid; v_del timestamptz; v_cat_id uuid;
  v_erros jsonb := '[]'::jsonb;
  v_n_erros integer := 0;
  v_ok jsonb := '[]'::jsonb;
  v_vistos text[] := '{}';
  v_cats_novas text[] := '{}';
  v_criar integer := 0;
  v_atual integer := 0;
  r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar';
  END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN
    RAISE EXCEPTION 'Cada importação aceita no máximo 5000 linhas (a planilha tem %)', jsonb_array_length(p_linhas);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('importacao:produtos:' || v_tenant::text, 0)) THEN
    RAISE EXCEPTION 'Já existe uma importação de produtos em andamento. Aguarde terminar e tente de novo';
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_linha := coalesce((it ->> 'linha')::integer, 0);
    v_cod := btrim(coalesce(it ->> 'codigo_interno', ''));
    v_desc := btrim(coalesce(it ->> 'descricao', ''));
    v_un := btrim(coalesce(it ->> 'unidade', ''));
    v_barras := nullif(btrim(coalesce(it ->> 'codigo_barras', '')), '');
    v_ncm := nullif(regexp_replace(coalesce(it ->> 'ncm', ''), '\D', '', 'g'), '');
    v_cfop := nullif(regexp_replace(coalesce(it ->> 'cfop', ''), '\D', '', 'g'), '');
    v_cst := nullif(btrim(coalesce(it ->> 'cst_csosn', '')), '');
    v_cat := nullif(btrim(coalesce(it ->> 'categoria', '')), '');
    v_marca := nullif(btrim(coalesce(it ->> 'marca', '')), '');
    v_fab := nullif(btrim(coalesce(it ->> 'fabricante', '')), '');
    v_loc := nullif(btrim(coalesce(it ->> 'localizacao', '')), '');
    BEGIN
      v_preco := public._imp_num(it, 'preco_venda');
      v_custo := public._imp_num(it, 'custo');
      v_min := public._imp_num(it, 'estoque_minimo');
      v_max := public._imp_num(it, 'estoque_maximo');
    EXCEPTION WHEN OTHERS THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, SQLERRM);
      CONTINUE;
    END;

    IF v_cod = '' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Informe o código do produto'); CONTINUE;
    END IF;
    IF lower(v_cod) = ANY (v_vistos) THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O código %s aparece mais de uma vez na planilha', v_cod));
      CONTINUE;
    END IF;
    v_vistos := array_append(v_vistos, lower(v_cod));
    IF length(v_cod) > 60 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Código com mais de 60 caracteres'); CONTINUE;
    END IF;

    v_exist := NULL; v_del := NULL;
    SELECT id, deleted_at INTO v_exist, v_del FROM public.produtos
     WHERE tenant_id = v_tenant AND lower(codigo_interno) = lower(v_cod) ORDER BY deleted_at NULLS FIRST LIMIT 1;
    IF v_exist IS NOT NULL AND v_del IS NOT NULL THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O código %s pertence a um produto excluído', v_cod)); CONTINUE;
    END IF;
    IF v_exist IS NOT NULL AND NOT p_atualizar THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O produto %s já existe (marque "atualizar os que já existem" para alterá-lo)', v_cod));
      CONTINUE;
    END IF;
    IF v_exist IS NULL AND v_desc = '' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Informe a descrição do produto'); CONTINUE;
    END IF;
    IF length(v_desc) > 200 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Descrição com mais de 200 caracteres'); CONTINUE;
    END IF;
    IF coalesce(v_preco, 0) < 0 OR coalesce(v_custo, 0) < 0 OR coalesce(v_min, 0) < 0 OR coalesce(v_max, 0) < 0 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Preço, custo e estoques não podem ser negativos'); CONTINUE;
    END IF;
    IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_max < v_min THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Estoque máximo menor que o mínimo'); CONTINUE;
    END IF;
    IF v_ncm IS NOT NULL AND length(v_ncm) <> 8 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'NCM deve ter 8 números'); CONTINUE;
    END IF;
    IF v_cfop IS NOT NULL AND length(v_cfop) <> 4 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'CFOP deve ter 4 números'); CONTINUE;
    END IF;

    IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categorias WHERE tenant_id = v_tenant AND lower(nome) = lower(v_cat))
       AND NOT (lower(v_cat) = ANY (SELECT lower(x) FROM unnest(v_cats_novas) x)) THEN
      v_cats_novas := array_append(v_cats_novas, v_cat);
    END IF;

    v_ok := v_ok || jsonb_build_array(jsonb_build_object(
      'cod', v_cod, 'desc', nullif(v_desc, ''), 'un', nullif(v_un, ''), 'preco', v_preco, 'custo', v_custo, 'barras', v_barras,
      'ncm', v_ncm, 'cfop', v_cfop, 'cst', v_cst, 'cat', v_cat, 'marca', v_marca, 'fab', v_fab, 'min', v_min, 'max', v_max,
      'loc', v_loc, 'exist', v_exist));
    IF v_exist IS NULL THEN v_criar := v_criar + 1; ELSE v_atual := v_atual + 1; END IF;
  END LOOP;

  IF v_n_erros > 0 THEN
    RETURN jsonb_build_object('ok', false, 'simulado', p_simular, 'total', jsonb_array_length(p_linhas),
                              'n_erros', v_n_erros, 'erros', v_erros);
  END IF;
  IF p_simular THEN
    RETURN jsonb_build_object('ok', true, 'simulado', true, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                              'erros', '[]'::jsonb, 'criados', v_criar, 'atualizados', v_atual,
                              'categorias_novas', coalesce(array_length(v_cats_novas, 1), 0));
  END IF;

  -- grava: categorias novas primeiro, depois os produtos
  FOR v_cat IN SELECT unnest(v_cats_novas) LOOP
    INSERT INTO public.categorias (tenant_id, nome) VALUES (v_tenant, v_cat);
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(v_ok) LOOP
    v_cat_id := NULL;
    IF r ->> 'cat' IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM public.categorias WHERE tenant_id = v_tenant AND lower(nome) = lower(r ->> 'cat') ORDER BY created_at LIMIT 1;
    END IF;
    IF r ->> 'exist' IS NULL THEN
      INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, custo, codigo_barras, ncm, cfop,
                                   cst_csosn, categoria_id, marca, fabricante, estoque_minimo, estoque_maximo, localizacao)
      VALUES (v_tenant, r ->> 'cod', r ->> 'desc', coalesce(r ->> 'un', 'un'), coalesce((r ->> 'preco')::numeric, 0),
              coalesce((r ->> 'custo')::numeric, 0), r ->> 'barras', r ->> 'ncm', r ->> 'cfop', r ->> 'cst', v_cat_id,
              r ->> 'marca', r ->> 'fab', coalesce((r ->> 'min')::numeric, 0), coalesce((r ->> 'max')::numeric, 0), r ->> 'loc');
    ELSE
      UPDATE public.produtos SET
        descricao = coalesce(r ->> 'desc', descricao),
        unidade = coalesce(r ->> 'un', unidade),
        preco_venda = coalesce((r ->> 'preco')::numeric, preco_venda),
        custo = coalesce((r ->> 'custo')::numeric, custo),
        codigo_barras = coalesce(r ->> 'barras', codigo_barras),
        ncm = coalesce(r ->> 'ncm', ncm),
        cfop = coalesce(r ->> 'cfop', cfop),
        cst_csosn = coalesce(r ->> 'cst', cst_csosn),
        categoria_id = coalesce(v_cat_id, categoria_id),
        marca = coalesce(r ->> 'marca', marca),
        fabricante = coalesce(r ->> 'fab', fabricante),
        estoque_minimo = coalesce((r ->> 'min')::numeric, estoque_minimo),
        estoque_maximo = coalesce((r ->> 'max')::numeric, estoque_maximo),
        localizacao = coalesce(r ->> 'loc', localizacao)
      WHERE id = (r ->> 'exist')::uuid AND tenant_id = v_tenant;
    END IF;
  END LOOP;

  INSERT INTO public.importacoes (tenant_id, tipo, arquivo, linhas, criados, atualizados)
  VALUES (v_tenant, 'produtos', left(p_arquivo, 200), jsonb_array_length(p_linhas), v_criar, v_atual);

  RETURN jsonb_build_object('ok', true, 'simulado', false, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                            'erros', '[]'::jsonb, 'criados', v_criar, 'atualizados', v_atual,
                            'categorias_novas', coalesce(array_length(v_cats_novas, 1), 0));
END $$;
REVOKE ALL ON FUNCTION public.importar_produtos(jsonb, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_produtos(jsonb, boolean, boolean, text) TO authenticated;

-- ===== Clientes =====
-- p_linhas: [{linha, nome, documento, nome_fantasia, inscricao_estadual, telefone, whatsapp, email, cep, endereco, numero,
--             complemento, bairro, cidade, estado, limite_credito, prazo_padrao_dias}]
-- O cliente é reconhecido pelo CPF/CNPJ (só números); sem documento, pelo nome.
CREATE OR REPLACE FUNCTION public.importar_clientes(
  p_linhas jsonb, p_atualizar boolean DEFAULT false, p_simular boolean DEFAULT false, p_arquivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb;
  v_linha integer;
  v_nome text; v_doc text; v_chave text; v_exist uuid; v_del timestamptz;
  v_limite numeric; v_prazo numeric; v_uf text; v_email text;
  v_erros jsonb := '[]'::jsonb;
  v_n_erros integer := 0;
  v_ok jsonb := '[]'::jsonb;
  v_vistos text[] := '{}';
  v_criar integer := 0;
  v_atual integer := 0;
  r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar';
  END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN
    RAISE EXCEPTION 'Cada importação aceita no máximo 5000 linhas (a planilha tem %)', jsonb_array_length(p_linhas);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('importacao:clientes:' || v_tenant::text, 0)) THEN
    RAISE EXCEPTION 'Já existe uma importação de clientes em andamento. Aguarde terminar e tente de novo';
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_linha := coalesce((it ->> 'linha')::integer, 0);
    v_nome := btrim(coalesce(it ->> 'nome', ''));
    v_doc := regexp_replace(coalesce(it ->> 'documento', ''), '\D', '', 'g');
    v_uf := nullif(upper(btrim(coalesce(it ->> 'estado', ''))), '');
    v_email := nullif(btrim(coalesce(it ->> 'email', '')), '');
    BEGIN
      v_limite := public._imp_num(it, 'limite_credito');
      v_prazo := public._imp_num(it, 'prazo_padrao_dias');
    EXCEPTION WHEN OTHERS THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, SQLERRM); CONTINUE;
    END;

    IF v_nome = '' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Informe o nome do cliente'); CONTINUE;
    END IF;
    IF length(v_nome) > 200 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Nome com mais de 200 caracteres'); CONTINUE;
    END IF;
    IF v_doc <> '' AND length(v_doc) NOT IN (11, 14) THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'CPF deve ter 11 números e CNPJ 14'); CONTINUE;
    END IF;
    IF v_uf IS NOT NULL AND length(v_uf) <> 2 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Estado deve ter 2 letras (ex.: SP)'); CONTINUE;
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'E-mail inválido'); CONTINUE;
    END IF;
    IF coalesce(v_limite, 0) < 0 OR coalesce(v_prazo, 0) < 0 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Limite de crédito e prazo não podem ser negativos'); CONTINUE;
    END IF;

    v_chave := CASE WHEN v_doc <> '' THEN 'd:' || v_doc ELSE 'n:' || lower(v_nome) END;
    IF v_chave = ANY (v_vistos) THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('Cliente repetido na planilha (%s)', CASE WHEN v_doc <> '' THEN v_doc ELSE v_nome END));
      CONTINUE;
    END IF;
    v_vistos := array_append(v_vistos, v_chave);

    v_exist := NULL; v_del := NULL;
    IF v_doc <> '' THEN
      SELECT id, deleted_at INTO v_exist, v_del FROM public.clientes
       WHERE tenant_id = v_tenant AND regexp_replace(coalesce(cpf, '') || coalesce(cnpj, ''), '\D', '', 'g') = v_doc
       ORDER BY deleted_at NULLS FIRST LIMIT 1;
    ELSE
      SELECT id, deleted_at INTO v_exist, v_del FROM public.clientes
       WHERE tenant_id = v_tenant AND lower(nome) = lower(v_nome) AND coalesce(cpf, '') = '' AND coalesce(cnpj, '') = ''
       ORDER BY deleted_at NULLS FIRST LIMIT 1;
    END IF;
    IF v_exist IS NOT NULL AND v_del IS NOT NULL THEN
      v_exist := NULL;  -- cliente excluído: entra como novo cadastro
    END IF;
    IF v_exist IS NOT NULL AND NOT p_atualizar THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O cliente %s já existe (marque "atualizar os que já existem" para alterá-lo)',
                                  CASE WHEN v_doc <> '' THEN v_doc ELSE v_nome END));
      CONTINUE;
    END IF;

    v_ok := v_ok || jsonb_build_array(jsonb_build_object(
      'nome', v_nome, 'doc', nullif(v_doc, ''), 'fantasia', nullif(btrim(coalesce(it ->> 'nome_fantasia', '')), ''),
      'ie', nullif(btrim(coalesce(it ->> 'inscricao_estadual', '')), ''), 'tel', nullif(btrim(coalesce(it ->> 'telefone', '')), ''),
      'zap', nullif(btrim(coalesce(it ->> 'whatsapp', '')), ''), 'email', v_email,
      'cep', nullif(regexp_replace(coalesce(it ->> 'cep', ''), '\D', '', 'g'), ''),
      'endereco', nullif(btrim(coalesce(it ->> 'endereco', '')), ''), 'numero', nullif(btrim(coalesce(it ->> 'numero', '')), ''),
      'compl', nullif(btrim(coalesce(it ->> 'complemento', '')), ''), 'bairro', nullif(btrim(coalesce(it ->> 'bairro', '')), ''),
      'cidade', nullif(btrim(coalesce(it ->> 'cidade', '')), ''), 'uf', v_uf, 'limite', v_limite, 'prazo', v_prazo,
      'exist', v_exist));
    IF v_exist IS NULL THEN v_criar := v_criar + 1; ELSE v_atual := v_atual + 1; END IF;
  END LOOP;

  IF v_n_erros > 0 THEN
    RETURN jsonb_build_object('ok', false, 'simulado', p_simular, 'total', jsonb_array_length(p_linhas),
                              'n_erros', v_n_erros, 'erros', v_erros);
  END IF;
  IF p_simular THEN
    RETURN jsonb_build_object('ok', true, 'simulado', true, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                              'erros', '[]'::jsonb, 'criados', v_criar, 'atualizados', v_atual);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(v_ok) LOOP
    IF r ->> 'exist' IS NULL THEN
      INSERT INTO public.clientes (tenant_id, tipo, nome, nome_fantasia, cpf, cnpj, inscricao_estadual, telefone, whatsapp, email,
                                   cep, endereco, numero, complemento, bairro, cidade, estado, limite_credito, prazo_padrao_dias)
      VALUES (v_tenant,
              CASE WHEN length(coalesce(r ->> 'doc', '')) = 14 THEN 'PJ'::public.pessoa_tipo ELSE 'PF'::public.pessoa_tipo END,
              r ->> 'nome', r ->> 'fantasia',
              CASE WHEN length(coalesce(r ->> 'doc', '')) = 11 THEN r ->> 'doc' END,
              CASE WHEN length(coalesce(r ->> 'doc', '')) = 14 THEN r ->> 'doc' END,
              r ->> 'ie', r ->> 'tel', r ->> 'zap', r ->> 'email', r ->> 'cep', r ->> 'endereco', r ->> 'numero', r ->> 'compl',
              r ->> 'bairro', r ->> 'cidade', r ->> 'uf', coalesce((r ->> 'limite')::numeric, 0),
              coalesce((r ->> 'prazo')::numeric, 0)::integer);
    ELSE
      UPDATE public.clientes SET
        nome = r ->> 'nome',
        nome_fantasia = coalesce(r ->> 'fantasia', nome_fantasia),
        inscricao_estadual = coalesce(r ->> 'ie', inscricao_estadual),
        telefone = coalesce(r ->> 'tel', telefone),
        whatsapp = coalesce(r ->> 'zap', whatsapp),
        email = coalesce(r ->> 'email', email),
        cep = coalesce(r ->> 'cep', cep),
        endereco = coalesce(r ->> 'endereco', endereco),
        numero = coalesce(r ->> 'numero', numero),
        complemento = coalesce(r ->> 'compl', complemento),
        bairro = coalesce(r ->> 'bairro', bairro),
        cidade = coalesce(r ->> 'cidade', cidade),
        estado = coalesce(r ->> 'uf', estado),
        limite_credito = coalesce((r ->> 'limite')::numeric, limite_credito),
        prazo_padrao_dias = coalesce((r ->> 'prazo')::numeric, prazo_padrao_dias)::integer
      WHERE id = (r ->> 'exist')::uuid AND tenant_id = v_tenant;
    END IF;
  END LOOP;

  INSERT INTO public.importacoes (tenant_id, tipo, arquivo, linhas, criados, atualizados)
  VALUES (v_tenant, 'clientes', left(p_arquivo, 200), jsonb_array_length(p_linhas), v_criar, v_atual);

  RETURN jsonb_build_object('ok', true, 'simulado', false, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                            'erros', '[]'::jsonb, 'criados', v_criar, 'atualizados', v_atual);
END $$;
REVOKE ALL ON FUNCTION public.importar_clientes(jsonb, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_clientes(jsonb, boolean, boolean, text) TO authenticated;

-- ===== Saldos de estoque =====
-- p_linhas: [{linha, codigo_interno, deposito, quantidade}]. Cada linha ajusta o saldo do produto no depósito para a
-- quantidade da planilha (movimentação de ajuste, com histórico). Depósito em branco vale só se a empresa tem um.
CREATE OR REPLACE FUNCTION public.importar_saldos(
  p_linhas jsonb, p_simular boolean DEFAULT false, p_arquivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb;
  v_linha integer;
  v_cod text; v_dep text; v_qtd numeric; v_prod uuid; v_dep_id uuid; v_unico uuid; v_n_dep integer;
  v_erros jsonb := '[]'::jsonb;
  v_n_erros integer := 0;
  v_ok jsonb := '[]'::jsonb;
  v_vistos text[] := '{}';
  v_chave text;
  v_reservado numeric;
  r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'estoquista']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar';
  END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN
    RAISE EXCEPTION 'Cada importação aceita no máximo 5000 linhas (a planilha tem %)', jsonb_array_length(p_linhas);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('importacao:saldos:' || v_tenant::text, 0)) THEN
    RAISE EXCEPTION 'Já existe uma importação de saldos em andamento. Aguarde terminar e tente de novo';
  END IF;

  SELECT count(*), min(id::text)::uuid INTO v_n_dep, v_unico FROM public.depositos WHERE tenant_id = v_tenant AND ativo;

  FOR it IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_linha := coalesce((it ->> 'linha')::integer, 0);
    v_cod := btrim(coalesce(it ->> 'codigo_interno', ''));
    v_dep := btrim(coalesce(it ->> 'deposito', ''));
    BEGIN
      v_qtd := public._imp_num(it, 'quantidade');
    EXCEPTION WHEN OTHERS THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, SQLERRM); CONTINUE;
    END;

    IF v_cod = '' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Informe o código do produto'); CONTINUE;
    END IF;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, 'Informe uma quantidade maior que zero (para zerar um saldo, use o inventário)'); CONTINUE;
    END IF;

    SELECT id INTO v_prod FROM public.produtos
     WHERE tenant_id = v_tenant AND lower(codigo_interno) = lower(v_cod) AND deleted_at IS NULL LIMIT 1;
    IF v_prod IS NULL THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('Produto %s não encontrado (importe os produtos antes dos saldos)', v_cod)); CONTINUE;
    END IF;

    v_dep_id := NULL;
    IF v_dep = '' THEN
      IF v_n_dep = 1 THEN v_dep_id := v_unico;
      ELSE
        v_n_erros := v_n_erros + 1;
        v_erros := public._imp_erro(v_erros, v_linha, 'Informe o depósito (a empresa tem mais de um)'); CONTINUE;
      END IF;
    ELSE
      SELECT id INTO v_dep_id FROM public.depositos WHERE tenant_id = v_tenant AND ativo AND lower(nome) = lower(v_dep) LIMIT 1;
      IF v_dep_id IS NULL THEN
        v_n_erros := v_n_erros + 1;
        v_erros := public._imp_erro(v_erros, v_linha, format('Depósito "%s" não encontrado', v_dep)); CONTINUE;
      END IF;
    END IF;

    v_chave := v_prod::text || ':' || v_dep_id::text;
    IF v_chave = ANY (v_vistos) THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O produto %s aparece mais de uma vez para o mesmo depósito', v_cod)); CONTINUE;
    END IF;
    v_vistos := array_append(v_vistos, v_chave);

    SELECT coalesce(reservado, 0) INTO v_reservado FROM public.estoques WHERE produto_id = v_prod AND deposito_id = v_dep_id;
    IF coalesce(v_reservado, 0) > v_qtd
       AND NOT (SELECT permite_negativo FROM public.depositos WHERE id = v_dep_id) THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O saldo de %s fica abaixo do reservado (%s)', v_cod, v_reservado)); CONTINUE;
    END IF;

    v_ok := v_ok || jsonb_build_array(jsonb_build_object('prod', v_prod, 'dep', v_dep_id, 'qtd', v_qtd));
  END LOOP;

  IF v_n_erros > 0 THEN
    RETURN jsonb_build_object('ok', false, 'simulado', p_simular, 'total', jsonb_array_length(p_linhas),
                              'n_erros', v_n_erros, 'erros', v_erros);
  END IF;
  IF p_simular THEN
    RETURN jsonb_build_object('ok', true, 'simulado', true, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                              'erros', '[]'::jsonb, 'criados', 0, 'atualizados', jsonb_array_length(v_ok));
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(v_ok) LOOP
    PERFORM public.registrar_movimentacao((r ->> 'prod')::uuid, (r ->> 'dep')::uuid, 'ajuste'::public.mov_tipo,
                                          (r ->> 'qtd')::numeric, 'Importação por planilha', 'importacao');
  END LOOP;

  INSERT INTO public.importacoes (tenant_id, tipo, arquivo, linhas, criados, atualizados)
  VALUES (v_tenant, 'saldos', left(p_arquivo, 200), jsonb_array_length(p_linhas), 0, jsonb_array_length(v_ok));

  RETURN jsonb_build_object('ok', true, 'simulado', false, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                            'erros', '[]'::jsonb, 'criados', 0, 'atualizados', jsonb_array_length(v_ok));
END $$;
REVOKE ALL ON FUNCTION public.importar_saldos(jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_saldos(jsonb, boolean, text) TO authenticated;
