-- Manufatura (fase 2), correções do semiacabado (20261207000000): (1) ativar lista passa a ser uma por vez na empresa, para que duas ativações
-- simultâneas não fechem um ciclo sem enxergar uma à outra; (2) mf_bom_explodir recusa lista com mais de 8 níveis de semiacabado (ou em ciclo)
-- em vez de devolver uma matéria-prima incompleta. Reexecutável.

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
  -- uma ativação por vez na empresa: duas listas que se usam (A->B e B->A) ativadas ao mesmo tempo passariam na checagem de ciclo
  -- sem enxergar uma à outra; com o bloqueio, a segunda confere o ciclo já vendo a primeira ativa
  PERFORM pg_advisory_xact_lock(hashtextextended('mf_bom_grafo:' || v_tenant::text, 0));
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
  -- lista profunda demais (ou em ciclo): recusa em vez de devolver uma matéria-prima incompleta
  IF EXISTS (
    WITH RECURSIVE arv(prod, nivel) AS (
      SELECT bi.insumo_id, 1 FROM public.mf_boms b JOIN public.mf_bom_itens bi ON bi.bom_id = b.id
       WHERE b.id = p_bom_id AND b.tenant_id = v_tenant
      UNION ALL
      SELECT bi.insumo_id, a.nivel + 1 FROM arv a
        JOIN public.mf_boms b2 ON b2.produto_id = a.prod AND b2.tenant_id = v_tenant AND b2.situacao = 'ativa'
        JOIN public.mf_bom_itens bi ON bi.bom_id = b2.id
       WHERE a.nivel < 8
    )
    SELECT 1 FROM arv a WHERE a.nivel >= 8
       AND EXISTS (SELECT 1 FROM public.mf_boms bb WHERE bb.produto_id = a.prod AND bb.tenant_id = v_tenant AND bb.situacao = 'ativa')
  ) THEN
    RAISE EXCEPTION 'A lista tem semiacabados em níveis demais (mais de 8) ou em ciclo: o total não pode ser calculado';
  END IF;
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
