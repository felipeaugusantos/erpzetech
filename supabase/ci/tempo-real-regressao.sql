-- Execute with a Ze Tech operator UUID in request.jwt.claim.sub.
-- Concrete totals must match the saved orders, preserving cents.
SELECT 1 / CASE WHEN NOT EXISTS (
  SELECT 1
  FROM public.saas_tempo_real_por_cliente('2026-10-01', '2026-10-24') r
  WHERE r.valor_vendas IS DISTINCT FROM COALESCE((
    SELECT SUM(p.total) FROM public.pedidos p
    WHERE p.tenant_id = r.tenant_id
      AND p.created_at::date BETWEEN '2026-10-01' AND '2026-10-24'
      AND p.situacao <> 'cancelado'
  ), 0)
) THEN 1 ELSE 0 END AS totais_corretos;