-- Lava rápido (Fase 3, etapa 3): painel da equipe Ze Tech com o uso do lava rápido por loja cliente, no mesmo molde do painel de assistência técnica.
-- Só entram as lojas com o módulo liberado (mesma regra de lava_rapido_liberado, avaliada para a empresa de cada cliente).
-- Faturamento = serviços cobrados das ordens entregues no período, sem o que foi coberto por plano ou brinde.

CREATE OR REPLACE FUNCTION public.saas_lava_rapido_por_cliente(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe Ze Tech'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Informe um período válido'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x.linha ORDER BY x.entregues DESC, x.nome)
      FROM (
        SELECT c.nome, o.entregues,
               jsonb_build_object(
                 'cliente_id', c.id, 'cliente', c.nome, 'plano', p.nome, 'tenant_id', c.tenant_id,
                 'ordens', o.criadas, 'entregues', o.entregues, 'canceladas', o.canceladas, 'em_andamento', o.em_andamento,
                 'ultima_ordem', o.ultima,
                 'faturamento', i.faturado, 'itens_planos', i.cobertos_plano, 'itens_brindes', i.cobertos_brinde,
                 'ticket_medio', CASE WHEN o.entregues > 0 THEN round(i.faturado / o.entregues, 2) ELSE 0 END,
                 'assinaturas_ativas', a.ativas, 'assinaturas_vendidas', a.vendidas, 'valor_assinaturas', a.valor,
                 'veiculos', v.total, 'fotos', f.total, 'comissoes_a_pagar', k.a_pagar, 'baixas_com_falha', b.falhas) AS linha
          FROM public.saas_clientes c
          LEFT JOIN public.saas_planos p ON p.id = c.plano_id
          CROSS JOIN LATERAL (
            SELECT count(*) FILTER (WHERE (od.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate)::int AS criadas,
                   count(*) FILTER (WHERE od.situacao = 'entregue' AND (od.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate)::int AS entregues,
                   count(*) FILTER (WHERE od.situacao = 'cancelada' AND (od.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate)::int AS canceladas,
                   count(*) FILTER (WHERE od.situacao IN ('aguardando', 'lavando', 'secando', 'pronto'))::int AS em_andamento,
                   max(od.created_at) AS ultima
              FROM public.lr_ordens od WHERE od.tenant_id = c.tenant_id) o
          CROSS JOIN LATERAL (
            SELECT coalesce(sum(it.preco_aplicado) FILTER (WHERE it.cobertura IS NULL), 0) AS faturado,
                   count(*) FILTER (WHERE it.cobertura = 'assinatura')::int AS cobertos_plano,
                   count(*) FILTER (WHERE it.cobertura = 'fidelidade')::int AS cobertos_brinde
              FROM public.lr_ordem_itens it JOIN public.lr_ordens od2 ON od2.id = it.ordem_id
             WHERE od2.tenant_id = c.tenant_id AND od2.situacao = 'entregue'
               AND (od2.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate) i
          CROSS JOIN LATERAL (
            SELECT count(*) FILTER (WHERE s.situacao = 'ativa' AND s.vence_em >= v_hoje)::int AS ativas,
                   count(*) FILTER (WHERE s.comprado_em BETWEEN p_de AND p_ate AND s.situacao = 'ativa')::int AS vendidas,
                   coalesce(sum(s.valor) FILTER (WHERE s.comprado_em BETWEEN p_de AND p_ate AND s.situacao = 'ativa'), 0) AS valor
              FROM public.lr_assinaturas s WHERE s.tenant_id = c.tenant_id) a
          CROSS JOIN LATERAL (SELECT count(*)::int AS total FROM public.lr_veiculos ve WHERE ve.tenant_id = c.tenant_id AND ve.ativo) v
          CROSS JOIN LATERAL (
            SELECT count(*)::int AS total FROM public.lr_fotos ft
             WHERE ft.tenant_id = c.tenant_id AND ft.situacao = 'ativa' AND (ft.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate) f
          CROSS JOIN LATERAL (
            SELECT coalesce(sum(cm.valor) FILTER (WHERE cm.situacao IN ('a_aprovar', 'aprovada')), 0) AS a_pagar
              FROM public.lr_comissoes cm WHERE cm.tenant_id = c.tenant_id) k
          CROSS JOIN LATERAL (
            SELECT count(*) FILTER (WHERE bx.situacao = 'falhou')::int AS falhas FROM public.lr_insumo_baixas bx WHERE bx.tenant_id = c.tenant_id) b
         WHERE c.tenant_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.empresas e
            WHERE e.tenant_id = c.tenant_id AND (
              EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'lavarapido')
              OR (length(regexp_replace(coalesce(e.cnpj, ''), '[^0-9A-Za-z]', '', 'g')) < 14 AND 'lavarapido' = ANY (e.modulos_sem_cnpj))
              OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae, '') || ',' || coalesce(e.cnae_secundarios, ''), '[,;\n|]+')) cn
                          WHERE regexp_replace(cn, '\D', '', 'g') LIKE '4520006%')))
      ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.saas_lava_rapido_por_cliente(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_lava_rapido_por_cliente(date, date) TO authenticated;
