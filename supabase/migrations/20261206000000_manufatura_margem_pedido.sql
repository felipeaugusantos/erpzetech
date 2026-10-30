-- Manufatura (fase 2): margem do pedido sob medida. Compara o que o cliente pagou (total do pedido) com o custo real das ordens de
-- produção ligadas a ele (insumos consumidos + mão de obra apontada + mão de obra manual lançada ao concluir). Só leitura; reexecutável.
-- O custo é parcial enquanto houver ordem aberta (planejada, liberada ou em produção); ordens canceladas não entram.
-- Exclui pedidos cancelados e rascunhos, como o relatório de lucro. Gestão apenas: o custo e a margem não são para a produção.
CREATE OR REPLACE FUNCTION public.mf_margem_pedidos(p_de date, p_ate date)
RETURNS TABLE (pedido_id uuid, numero bigint, data timestamptz, cliente text, receita numeric, custo_estimado numeric, custo_real numeric,
               ordens integer, ordens_abertas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Informe um período válido'; END IF;
  RETURN QUERY
  SELECT p.id, p.numero::bigint, p.created_at, c.nome,
         p.total::numeric,
         round(coalesce(sum(o.custo_padrao), 0), 2),
         round(coalesce(sum(o.custo_real), 0), 2),
         count(o.id)::integer,
         (count(o.id) FILTER (WHERE o.situacao <> 'concluida'))::integer
    FROM public.pedidos p
    JOIN public.mf_ordens o ON o.pedido_id = p.id AND o.tenant_id = v_tenant AND o.situacao <> 'cancelada'
    LEFT JOIN public.clientes c ON c.id = p.cliente_id AND c.tenant_id = v_tenant
   WHERE p.tenant_id = v_tenant AND p.situacao NOT IN ('cancelado', 'rascunho')
     AND p.created_at >= p_de::timestamptz AND p.created_at < (p_ate + 1)::timestamptz
   GROUP BY p.id, p.numero, p.created_at, c.nome, p.total
   ORDER BY p.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.mf_margem_pedidos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_margem_pedidos(date, date) TO authenticated;
