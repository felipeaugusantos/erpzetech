-- Manufatura (fase 2): semiacabado. Um insumo pode ser ele mesmo um produto com lista de materiais ativa (porta, gaveta, módulo).
-- 1) Bloqueia ciclos: a lista de A não pode usar B se B (direta ou indiretamente, pelas listas ativas) usa A, ao salvar e ao ativar.
-- 2) mf_bom_explodir: abre os semiacabados e devolve só a matéria-prima total (com perda e rendimento de cada nível) e o custo de referência.
-- Não muda estoque nem ordens: o semiacabado continua sendo produzido por ordem própria com entrada no estoque. Reexecutável.

-- Do produto de origem, as listas ativas chegam ao produto de destino?
CREATE OR REPLACE FUNCTION public._mf_alcanca(p_tenant uuid, p_de uuid, p_ate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH RECURSIVE alc(prod) AS (
    SELECT p_de
    UNION
    SELECT bi.insumo_id FROM alc
      JOIN public.mf_boms b ON b.produto_id = alc.prod AND b.tenant_id = p_tenant AND b.situacao = 'ativa'
      JOIN public.mf_bom_itens bi ON bi.bom_id = b.id
  )
  SELECT EXISTS (SELECT 1 FROM alc WHERE prod = p_ate)
$$;
REVOKE ALL ON FUNCTION public._mf_alcanca(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mf_bom_salvar(p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_produto uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_rotulo text := nullif(btrim(coalesce(p_dados ->> 'rotulo', '')), '');
  v_rend numeric := coalesce(nullif(p_dados ->> 'rendimento', '')::numeric, 1);
  v_sit text;
  i jsonb; v_insumo uuid; v_qtd numeric; v_perda numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF v_rend <= 0 THEN RAISE EXCEPTION 'O rendimento precisa ser maior que zero'; END IF;
  IF v_id IS NULL THEN
    IF v_produto IS NULL THEN RAISE EXCEPTION 'Informe o produto acabado'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_produto AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('mf_bom:' || v_tenant::text || v_produto::text, 0));
    INSERT INTO public.mf_boms (tenant_id, produto_id, versao, rotulo, rendimento)
    VALUES (v_tenant, v_produto, coalesce((SELECT max(versao) FROM public.mf_boms WHERE tenant_id = v_tenant AND produto_id = v_produto), 0) + 1, v_rotulo, v_rend)
    RETURNING id INTO v_id;
  ELSE
    SELECT situacao, produto_id INTO v_sit, v_produto FROM public.mf_boms WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lista de materiais não encontrada'; END IF;
    IF v_sit <> 'rascunho' THEN RAISE EXCEPTION 'Só o rascunho pode ser editado: crie uma nova versão'; END IF;
    UPDATE public.mf_boms SET rotulo = v_rotulo, rendimento = v_rend WHERE id = v_id;
    DELETE FROM public.mf_bom_itens WHERE bom_id = v_id AND tenant_id = v_tenant;
  END IF;
  FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_dados -> 'itens', '[]'::jsonb)) LOOP
    v_insumo := nullif(i ->> 'insumo_id', '')::uuid;
    v_qtd := coalesce(nullif(i ->> 'quantidade', '')::numeric, 0);
    v_perda := coalesce(nullif(i ->> 'perda_percentual', '')::numeric, 0);
    IF v_insumo IS NULL THEN RAISE EXCEPTION 'Informe o insumo de cada item'; END IF;
    IF v_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade de cada item precisa ser maior que zero'; END IF;
    IF v_perda < 0 OR v_perda >= 90 THEN RAISE EXCEPTION 'A perda precisa ficar entre 0 e 90%%'; END IF;
    IF v_insumo = v_produto THEN RAISE EXCEPTION 'O produto acabado não pode ser insumo dele mesmo'; END IF;
    IF public._mf_alcanca(v_tenant, v_insumo, v_produto) THEN
      RAISE EXCEPTION 'Este item já usa o produto desta lista em outra lista ativa: a lista ficaria em ciclo';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_insumo AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Insumo não encontrado'; END IF;
    IF EXISTS (SELECT 1 FROM public.mf_bom_itens WHERE bom_id = v_id AND insumo_id = v_insumo) THEN RAISE EXCEPTION 'O mesmo insumo aparece mais de uma vez'; END IF;
    INSERT INTO public.mf_bom_itens (tenant_id, bom_id, insumo_id, quantidade, perda_percentual) VALUES (v_tenant, v_id, v_insumo, v_qtd, v_perda);
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_bom_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_bom_salvar(jsonb) TO authenticated;

-- Ativa o rascunho e torna obsoleta a versão que estava ativa do mesmo produto.
CREATE OR REPLACE FUNCTION public.mf_bom_ativar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  b public.mf_boms;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO b FROM public.mf_boms WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lista de materiais não encontrada'; END IF;
  IF b.situacao <> 'rascunho' THEN RAISE EXCEPTION 'Só o rascunho pode ser ativado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mf_bom_itens WHERE bom_id = p_id) THEN RAISE EXCEPTION 'Inclua ao menos um item antes de ativar'; END IF;
  -- outra lista pode ter sido ativada depois de este rascunho ser salvo: confere o ciclo de novo na hora de ativar
  IF EXISTS (SELECT 1 FROM public.mf_bom_itens bi WHERE bi.bom_id = p_id AND public._mf_alcanca(v_tenant, bi.insumo_id, b.produto_id)) THEN
    RAISE EXCEPTION 'Algum item já usa o produto desta lista em outra lista ativa: a lista ficaria em ciclo';
  END IF;
  UPDATE public.mf_boms SET situacao = 'obsoleta' WHERE tenant_id = v_tenant AND produto_id = b.produto_id AND situacao = 'ativa';
  UPDATE public.mf_boms SET situacao = 'ativa' WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_bom_ativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_bom_ativar(uuid) TO authenticated;


-- Matéria-prima total de uma lista (qualquer situação) para `p_qtd` unidades, abrindo os semiacabados que têm lista ativa.
CREATE OR REPLACE FUNCTION public.mf_bom_explodir(p_bom_id uuid, p_qtd numeric DEFAULT 1)
RETURNS TABLE (insumo_id uuid, descricao text, unidade text, quantidade numeric, custo_unitario numeric, valor numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF p_qtd IS NULL OR p_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade precisa ser maior que zero'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mf_boms WHERE id = p_bom_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Lista de materiais não encontrada'; END IF;
  RETURN QUERY
  WITH RECURSIVE arv(prod, qtd, nivel) AS (
    SELECT bi.insumo_id, p_qtd * (bi.quantidade / b.rendimento) * 100 / (100 - bi.perda_percentual), 1
      FROM public.mf_boms b JOIN public.mf_bom_itens bi ON bi.bom_id = b.id
     WHERE b.id = p_bom_id AND b.tenant_id = v_tenant
    UNION ALL
    SELECT bi.insumo_id, a.qtd * (bi.quantidade / b2.rendimento) * 100 / (100 - bi.perda_percentual), a.nivel + 1
      FROM arv a
      JOIN public.mf_boms b2 ON b2.produto_id = a.prod AND b2.tenant_id = v_tenant AND b2.situacao = 'ativa'
      JOIN public.mf_bom_itens bi ON bi.bom_id = b2.id
     WHERE a.nivel < 8
  ), folhas AS (
    SELECT a.prod, sum(a.qtd) AS q FROM arv a
     WHERE NOT EXISTS (SELECT 1 FROM public.mf_boms bb WHERE bb.produto_id = a.prod AND bb.tenant_id = v_tenant AND bb.situacao = 'ativa')
     GROUP BY a.prod
  )
  SELECT f.prod, p.descricao, p.unidade, round(f.q, 3), coalesce(p.custo, 0)::numeric, round(f.q * coalesce(p.custo, 0), 2)
    FROM folhas f JOIN public.produtos p ON p.id = f.prod AND p.tenant_id = v_tenant
   ORDER BY p.descricao;
END $$;
REVOKE ALL ON FUNCTION public.mf_bom_explodir(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_bom_explodir(uuid, numeric) TO authenticated;
