-- Painel de TV: acrescenta o resumo AGREGADO do backup por cliente (rotina noturna, tabela backup_execucoes).
-- Só contagens e datas: sem nome de cliente, sem caminho de arquivo e sem texto de erro. Mesma função, mesmas permissões
-- (só service_role). Nenhuma tabela nova. Um cliente está "em dia" se tem backup concluído nas últimas 26 horas.

CREATE OR REPLACE FUNCTION public.saas_monitoramento_tv()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  RETURN jsonb_build_object(
    'gerado_em', now(),
    'erros_abertos', (SELECT count(*) FROM public.erros_app e WHERE e.situacao = 'aberto'),
    'erros_novos_1h', (SELECT count(*) FROM public.erros_app e WHERE e.primeira_vez >= now() - interval '1 hour'),
    'erros_novos_24h', (SELECT count(*) FROM public.erros_app e WHERE e.primeira_vez >= now() - interval '24 hours'),
    'usuarios_ativos_24h', (SELECT count(DISTINCT a.usuario_id) FROM public.auditoria a
                             WHERE a.usuario_id IS NOT NULL AND a.created_at >= now() - interval '24 hours'),
    'acoes_24h', (SELECT count(*) FROM public.auditoria a WHERE a.created_at >= now() - interval '24 hours'),
    'clientes_ativos_24h', (SELECT count(DISTINCT a.tenant_id) FROM public.auditoria a
                             WHERE a.tenant_id IS NOT NULL AND a.created_at >= now() - interval '24 hours'),
    'clientes_sem_uso_7d', (SELECT count(*) FROM public.saas_clientes c
                             WHERE c.tenant_id IS NOT NULL AND NOT EXISTS (
                               SELECT 1 FROM public.auditoria a
                                WHERE a.tenant_id = c.tenant_id AND a.created_at >= now() - interval '7 days')),
    'backup', (
      WITH ativos AS (
        SELECT t.id FROM public.tenants t WHERE t.ativo = true
      ), ultimo AS (
        SELECT a.id,
               (SELECT max(b.concluido_em) FROM public.backup_execucoes b
                 WHERE b.tenant_id = a.id AND b.situacao = 'concluido') AS concluido_em,
               EXISTS (SELECT 1 FROM public.backup_execucoes b
                        WHERE b.tenant_id = a.id AND b.situacao = 'erro'
                          AND b.iniciado_em >= now() - interval '26 hours') AS teve_erro
          FROM ativos a
      )
      SELECT jsonb_build_object(
               'clientes_ativos', count(*),
               'em_dia', count(*) FILTER (WHERE u.concluido_em >= now() - interval '26 hours'),
               'atrasados', count(*) FILTER (WHERE u.concluido_em IS NOT NULL AND u.concluido_em < now() - interval '26 hours'),
               'sem_backup', count(*) FILTER (WHERE u.concluido_em IS NULL),
               'com_erro', count(*) FILTER (WHERE u.teve_erro AND (u.concluido_em IS NULL OR u.concluido_em < now() - interval '26 hours')),
               'ultimo_em', max(u.concluido_em),
               'mais_antigo_em', CASE WHEN count(*) FILTER (WHERE u.concluido_em IS NULL) > 0 THEN NULL ELSE min(u.concluido_em) END)
        FROM ultimo u
    ),
    'serie', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'dia', d.dia,
               'erros_novos', coalesce(e.novos, 0),
               'acoes', coalesce(a.acoes, 0),
               'usuarios_ativos', coalesce(a.usuarios, 0)) ORDER BY d.dia), '[]'::jsonb)
        FROM (SELECT g::date AS dia FROM generate_series(v_hoje - 6, v_hoje, interval '1 day') AS g) d
        LEFT JOIN (
          SELECT (er.primeira_vez AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*) AS novos
            FROM public.erros_app er
           WHERE er.primeira_vez >= now() - interval '8 days'
           GROUP BY 1
        ) e ON e.dia = d.dia
        LEFT JOIN (
          SELECT (au.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                 count(*) AS acoes, count(DISTINCT au.usuario_id) AS usuarios
            FROM public.auditoria au
           WHERE au.created_at >= now() - interval '8 days'
           GROUP BY 1
        ) a ON a.dia = d.dia
    ),
    'top_erros', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'rota', left(t.rota, 80), 'origem', t.origem, 'ocorrencias', t.ocorrencias)), '[]'::jsonb)
        FROM (
          SELECT e.rota, e.origem, e.ocorrencias
            FROM public.erros_app e
           WHERE e.situacao = 'aberto' AND e.ultima_vez >= now() - interval '24 hours'
           ORDER BY e.ocorrencias DESC, e.ultima_vez DESC
           LIMIT 3
        ) t
    )
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_monitoramento_tv() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_monitoramento_tv() TO service_role;
