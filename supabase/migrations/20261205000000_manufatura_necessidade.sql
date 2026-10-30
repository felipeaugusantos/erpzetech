-- Manufatura (fase 2, parte 2): necessidade de materiais. Soma o que as ordens abertas ainda precisam e não está coberto por reserva,
-- desconta o saldo livre do depósito (físico - reservado) e o que já está pedido ao fornecedor (compras não recebidas nem canceladas, como
-- na sugestão de reposição) e mostra a falta de cada insumo. Não grava nada: o pedido de compra sai pela função de compras já existente
-- (compra_criar_de_sugestao), em rascunho, para conferência. Reexecutável.
--
-- Demanda sem cobertura por ordem: planejada = o planejado inteiro (ainda sem reserva); liberada ou em produção = planejado - consumido -
-- reservado, que fica em zero enquanto a reserva cobre o que falta consumir.
CREATE OR REPLACE FUNCTION public.mf_necessidade()
RETURNS TABLE (insumo_id uuid, descricao text, unidade text, deposito_id uuid, deposito text, fornecedor_id uuid,
               necessario numeric, disponivel numeric, em_compra numeric, falta numeric, custo_unitario numeric, ordens text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'comprador', 'estoquista']);
  PERFORM public._mf_exige_liberado();
  RETURN QUERY
  WITH linhas AS (
    SELECT oi.insumo_id AS ins, o.deposito_insumos_id AS dep, o.numero AS num,
           CASE WHEN o.situacao = 'planejada' THEN oi.quantidade_planejada
                ELSE greatest(oi.quantidade_planejada - oi.quantidade_consumida - oi.quantidade_reservada, 0) END AS q
      FROM public.mf_ordem_insumos oi JOIN public.mf_ordens o ON o.id = oi.ordem_id
     WHERE oi.tenant_id = v_tenant AND o.tenant_id = v_tenant AND o.situacao IN ('planejada', 'liberada', 'em_producao')
  ), demanda AS (
    SELECT l.ins, l.dep, sum(l.q) AS q, array_agg(DISTINCT 'OP-' || l.num) FILTER (WHERE l.q > 0) AS ops
      FROM linhas l GROUP BY l.ins, l.dep
  ), pedido AS (
    SELECT ci.produto_id AS ins, c.deposito_id AS dep, sum(greatest(ci.quantidade - coalesce(ci.quantidade_recebida, 0), 0)) AS q
      FROM public.compra_itens ci JOIN public.compras c ON c.id = ci.compra_id
     WHERE ci.tenant_id = v_tenant AND c.tenant_id = v_tenant AND c.situacao NOT IN ('recebido', 'cancelado')
     GROUP BY ci.produto_id, c.deposito_id
  )
  SELECT d.ins, p.descricao, p.unidade, d.dep, dp.nome, p.fornecedor_id,
         round(d.q, 3),
         round(coalesce(e.quantidade - e.reservado, 0), 3),
         round(coalesce(pe.q, 0), 3),
         round(greatest(d.q - greatest(coalesce(e.quantidade - e.reservado, 0), 0) - coalesce(pe.q, 0), 0), 3),
         round(coalesce(public._mf_custo(d.ins, d.dep), 0), 4),
         d.ops
    FROM demanda d
    JOIN public.produtos p ON p.id = d.ins AND p.tenant_id = v_tenant
    JOIN public.depositos dp ON dp.id = d.dep AND dp.tenant_id = v_tenant
    LEFT JOIN public.estoques e ON e.produto_id = d.ins AND e.deposito_id = d.dep AND e.tenant_id = v_tenant
    LEFT JOIN pedido pe ON pe.ins = d.ins AND pe.dep = d.dep
   WHERE d.q > 0
   ORDER BY 10 DESC, 2;
END $$;
REVOKE ALL ON FUNCTION public.mf_necessidade() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_necessidade() TO authenticated;
