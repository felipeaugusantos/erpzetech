-- Dashboard gerencial da equipe EZRA (/ze-tech-monitoramento): erro e uso num só painel.
-- Erros vêm de erros_app (navegador + servidor, texto já limpo de dados pessoais). Uso vem da
-- auditoria (cada ação gravada no sistema — só contagens, nunca conteúdo de registros) e do
-- último login registrado na autenticação. Tudo restrito ao operador (eh_saas_operador):
-- nenhuma tabela é lida direto pelo aplicativo, só por estas funções.

-- Acelera as contagens por período sem mudar o que já existe.
CREATE INDEX IF NOT EXISTS auditoria_criado_idx ON public.auditoria (created_at);
CREATE INDEX IF NOT EXISTS auditoria_tenant_criado_idx ON public.auditoria (tenant_id, created_at);

-- Números do topo do painel: saúde (erros) e adoção (uso) no período escolhido.
CREATE OR REPLACE FUNCTION public.saas_monitoramento_resumo(p_de date, p_ate date)
RETURNS TABLE (
  erros_abertos bigint,
  erros_novos bigint,
  erros_reincidentes bigint,
  clientes_com_erro bigint,
  clientes_ativos bigint,
  clientes_sem_uso bigint,
  usuarios_ativos bigint,
  acoes bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe EZRA'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.erros_app e WHERE e.situacao = 'aberto'),
    (SELECT count(*) FROM public.erros_app e WHERE e.primeira_vez::date BETWEEN p_de AND p_ate),
    (SELECT count(*) FROM public.erros_app e
      WHERE e.ultima_vez::date BETWEEN p_de AND p_ate AND e.primeira_vez::date < p_de),
    (SELECT count(DISTINCT e.tenant_id) FROM public.erros_app e
      WHERE e.tenant_id IS NOT NULL AND e.ultima_vez::date BETWEEN p_de AND p_ate),
    (SELECT count(DISTINCT a.tenant_id) FROM public.auditoria a
      WHERE a.created_at::date BETWEEN p_de AND p_ate),
    (SELECT count(*) FROM public.saas_clientes c
      WHERE c.tenant_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.auditoria a
         WHERE a.tenant_id = c.tenant_id AND a.created_at::date BETWEEN p_de AND p_ate)),
    (SELECT count(DISTINCT a.usuario_id) FROM public.auditoria a
      WHERE a.usuario_id IS NOT NULL AND a.created_at::date BETWEEN p_de AND p_ate),
    (SELECT count(*) FROM public.auditoria a WHERE a.created_at::date BETWEEN p_de AND p_ate);
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_monitoramento_resumo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_monitoramento_resumo(date, date) TO authenticated;

-- Série diária do gráfico: erros novos e uso, dia a dia (dias sem movimento voltam com zero).
CREATE OR REPLACE FUNCTION public.saas_monitoramento_dia(p_de date, p_ate date)
RETURNS TABLE (dia date, erros_novos bigint, usuarios_ativos bigint, acoes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe EZRA'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  IF p_ate - p_de > 366 THEN RAISE EXCEPTION 'Período máximo de 366 dias'; END IF;
  RETURN QUERY
  SELECT d.dia::date,
         coalesce(e.novos, 0),
         coalesce(a.usuarios, 0),
         coalesce(a.acoes, 0)
    FROM generate_series(p_de::timestamptz, p_ate::timestamptz, interval '1 day') AS d(dia)
    LEFT JOIN (
      SELECT er.primeira_vez::date AS dia, count(*) AS novos
        FROM public.erros_app er
       WHERE er.primeira_vez::date BETWEEN p_de AND p_ate
       GROUP BY 1
    ) e ON e.dia = d.dia::date
    LEFT JOIN (
      SELECT au.created_at::date AS dia,
             count(DISTINCT au.usuario_id) AS usuarios,
             count(*) AS acoes
        FROM public.auditoria au
       WHERE au.created_at::date BETWEEN p_de AND p_ate
       GROUP BY 1
    ) a ON a.dia = d.dia::date
   ORDER BY d.dia;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_monitoramento_dia(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_monitoramento_dia(date, date) TO authenticated;

-- Uso por cliente: quem entrou e operou no período, última atividade, último login e erros.
-- Cliente cadastrado sem nenhuma ação no período aparece com zeros — é o sinal de abandono.
CREATE OR REPLACE FUNCTION public.saas_monitoramento_uso_cliente(p_de date, p_ate date)
RETURNS TABLE (
  cliente text,
  tenant_id uuid,
  usuarios_ativos bigint,
  acoes bigint,
  ultima_atividade timestamptz,
  ultimo_login timestamptz,
  erros_abertos bigint,
  erros_periodo bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe EZRA'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  RETURN QUERY
  SELECT c.nome,
         c.tenant_id,
         coalesce(a.usuarios, 0),
         coalesce(a.acoes, 0),
         a.ultima,
         l.ultimo_login,
         coalesce(e.abertos, 0),
         coalesce(e.no_periodo, 0)
    FROM public.saas_clientes c
    LEFT JOIN (
      SELECT au.tenant_id,
             count(DISTINCT au.usuario_id) AS usuarios,
             count(*) AS acoes,
             max(au.created_at) AS ultima
        FROM public.auditoria au
       WHERE au.created_at::date BETWEEN p_de AND p_ate
       GROUP BY au.tenant_id
    ) a ON a.tenant_id = c.tenant_id
    LEFT JOIN (
      SELECT p.tenant_id, max(u.last_sign_in_at) AS ultimo_login
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
       WHERE p.tenant_id IS NOT NULL
       GROUP BY p.tenant_id
    ) l ON l.tenant_id = c.tenant_id
    LEFT JOIN (
      SELECT er.tenant_id,
             count(*) FILTER (WHERE er.situacao = 'aberto') AS abertos,
             count(*) FILTER (WHERE er.ultima_vez::date BETWEEN p_de AND p_ate) AS no_periodo
        FROM public.erros_app er
       WHERE er.tenant_id IS NOT NULL
       GROUP BY er.tenant_id
    ) e ON e.tenant_id = c.tenant_id
   WHERE c.tenant_id IS NOT NULL
   ORDER BY coalesce(a.acoes, 0) DESC, c.nome;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_monitoramento_uso_cliente(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_monitoramento_uso_cliente(date, date) TO authenticated;

-- Erros abertos que mais se repetiram e voltaram a aparecer no período, com o cliente afetado.
CREATE OR REPLACE FUNCTION public.saas_monitoramento_top_erros(p_de date, p_ate date, p_limite integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  mensagem text,
  rota text,
  origem text,
  cliente text,
  ocorrencias integer,
  ultima_vez timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe EZRA'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  RETURN QUERY
  SELECT e.id,
         e.mensagem,
         e.rota,
         e.origem,
         (SELECT c.nome FROM public.saas_clientes c
           WHERE c.tenant_id = e.tenant_id ORDER BY c.inicio DESC LIMIT 1),
         e.ocorrencias,
         e.ultima_vez
    FROM public.erros_app e
   WHERE e.situacao = 'aberto' AND e.ultima_vez::date BETWEEN p_de AND p_ate
   ORDER BY e.ocorrencias DESC, e.ultima_vez DESC
   LIMIT least(greatest(coalesce(p_limite, 10), 1), 50);
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_monitoramento_top_erros(date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_monitoramento_top_erros(date, date, integer) TO authenticated;
