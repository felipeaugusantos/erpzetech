-- Bulário veterinário: catálogo de consulta com os produtos veterinários registrados no MAPA (SIPEAGRO, dados abertos, CC-BY).
-- Base GLOBAL (não tem tenant): todas as empresas com a clínica liberada consultam, ninguém da empresa altera.
-- A carga é feita pela equipe EZRA por função de servidor (service_role), em lotes, e pode ser repetida: o que já existe é atualizado.
-- Só consulta: não cria produto, não mexe em estoque nem em receita sozinho.

CREATE TABLE IF NOT EXISTS public.bulario_medicamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  registro text,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  fabricante text,
  principio_ativo text,
  especies text,
  classificacao text,
  situacao text,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- minúsculas e sem acento, para a busca achar "feromonio" em "Feromônio"
  busca text GENERATED ALWAYS AS (
    lower(translate(
      coalesce(nome, '') || ' ' || coalesce(fabricante, '') || ' ' || coalesce(principio_ativo, '') || ' ' || coalesce(registro, ''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
  ) STORED,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bulario_medicamentos_nome_idx ON public.bulario_medicamentos (lower(nome));
CREATE INDEX IF NOT EXISTS bulario_medicamentos_fabricante_idx ON public.bulario_medicamentos (lower(fabricante));

ALTER TABLE public.bulario_medicamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bulario_medicamentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bulario_medicamentos TO service_role;

-- Carga (só service_role): recebe um lote [{registro,nome,fabricante,principio_ativo,especies,classificacao,situacao,extras}].
-- A chave é o registro do MAPA; sem registro, nome + fabricante. Devolve quantos entraram.
CREATE OR REPLACE FUNCTION public.bulario_importar(p_itens jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lote inválido'; END IF;
  IF jsonb_array_length(p_itens) > 1000 THEN RAISE EXCEPTION 'Lote grande demais (até 1000 itens)'; END IF;
  WITH entrada AS (
    SELECT DISTINCT ON (chave) * FROM (
      SELECT ord,
        lower(btrim(coalesce(nullif(btrim(it ->> 'registro'), ''),
                             btrim(it ->> 'nome') || '|' || coalesce(btrim(it ->> 'fabricante'), '')))) AS chave,
        nullif(btrim(it ->> 'registro'), '') AS registro,
        left(btrim(it ->> 'nome'), 200) AS nome,
        left(nullif(btrim(it ->> 'fabricante'), ''), 200) AS fabricante,
        left(nullif(btrim(it ->> 'principio_ativo'), ''), 600) AS principio_ativo,
        left(nullif(btrim(it ->> 'especies'), ''), 300) AS especies,
        left(nullif(btrim(it ->> 'classificacao'), ''), 120) AS classificacao,
        left(nullif(btrim(it ->> 'situacao'), ''), 60) AS situacao,
        CASE WHEN jsonb_typeof(it -> 'extras') = 'object' THEN it -> 'extras' ELSE '{}'::jsonb END AS extras
      FROM jsonb_array_elements(p_itens) WITH ORDINALITY AS t(it, ord)
      WHERE btrim(coalesce(it ->> 'nome', '')) <> ''
    ) x ORDER BY chave, ord DESC
  ), up AS (
    INSERT INTO public.bulario_medicamentos AS b (chave, registro, nome, fabricante, principio_ativo, especies, classificacao, situacao, extras)
    SELECT chave, registro, nome, fabricante, principio_ativo, especies, classificacao, situacao, extras FROM entrada
    ON CONFLICT (chave) DO UPDATE SET
      registro = EXCLUDED.registro, nome = EXCLUDED.nome, fabricante = EXCLUDED.fabricante,
      principio_ativo = EXCLUDED.principio_ativo, especies = EXCLUDED.especies,
      classificacao = EXCLUDED.classificacao, situacao = EXCLUDED.situacao, extras = EXCLUDED.extras,
      atualizado_em = now()
    RETURNING 1
  )
  SELECT count(*) INTO n FROM up;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.bulario_importar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulario_importar(jsonb) TO service_role;

-- Consulta: liberada à clínica (administrador, gestor e veterinário, como o catálogo de vacinas).
-- p_busca: todas as palavras precisam aparecer (nome, fabricante, princípio ativo ou registro). p_letra: "A"…"Z" ou "#".
CREATE OR REPLACE FUNCTION public.bulario_buscar(
  p_busca text DEFAULT NULL, p_letra text DEFAULT NULL, p_fabricante text DEFAULT NULL,
  p_limite integer DEFAULT 100, p_pagina integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 200);
  v_off integer := greatest(coalesce(p_pagina, 0), 0) * v_lim;
  v_termos text[];
  v_letra text := upper(nullif(btrim(coalesce(p_letra, '')), ''));
  v_fab text := nullif(btrim(coalesce(p_fabricante, '')), '');
  v_total integer;
  v_itens jsonb;
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF v_letra IS NOT NULL AND v_letra !~ '^([A-Z]|#)$' THEN RAISE EXCEPTION 'Letra inválida'; END IF;

  v_termos := ARRAY(
    SELECT t FROM unnest(regexp_split_to_array(
      lower(translate(coalesce(p_busca, ''),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+')) t
     WHERE t <> '');

  WITH f AS (
    SELECT b.*, upper(left(translate(b.nome,
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'), 1)) AS ini
      FROM public.bulario_medicamentos b
     WHERE (v_fab IS NULL OR lower(b.fabricante) = lower(v_fab))
       AND (cardinality(v_termos) = 0
            OR NOT EXISTS (SELECT 1 FROM unnest(v_termos) t WHERE position(t IN b.busca) = 0))
  ), g AS (
    SELECT * FROM f
     WHERE v_letra IS NULL
        OR (v_letra = '#' AND ini !~ '[A-Z]')
        OR (v_letra <> '#' AND ini = v_letra)
  ), pag AS (
    SELECT * FROM g ORDER BY lower(nome), id LIMIT v_lim OFFSET v_off
  )
  SELECT (SELECT count(*) FROM g),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'registro', registro, 'nome', nome, 'fabricante', fabricante,
           'principio_ativo', principio_ativo, 'especies', especies, 'classificacao', classificacao,
           'situacao', situacao, 'extras', extras) ORDER BY lower(nome), id) FROM pag), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.bulario_buscar(text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_buscar(text, text, text, integer, integer) TO authenticated;

-- Fabricantes para o filtro e quantidade carregada (para a tela dizer se a base já foi carregada).
CREATE OR REPLACE FUNCTION public.bulario_resumo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.bulario_medicamentos),
    'atualizado_em', (SELECT max(atualizado_em) FROM public.bulario_medicamentos),
    'fabricantes', coalesce((SELECT jsonb_agg(f ORDER BY lower(f)) FROM (
        SELECT DISTINCT fabricante AS f FROM public.bulario_medicamentos WHERE fabricante IS NOT NULL) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.bulario_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_resumo() TO authenticated;

-- Total carregado, para a tela de carga da equipe EZRA (não depende de a empresa ter a clínica).
CREATE OR REPLACE FUNCTION public.bulario_total()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Somente a equipe EZRA'; END IF;
  RETURN (SELECT count(*)::integer FROM public.bulario_medicamentos);
END $$;
REVOKE ALL ON FUNCTION public.bulario_total() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_total() TO authenticated;
