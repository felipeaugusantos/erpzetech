-- Monitoramento de erros do sistema: cada erro (do navegador ou do servidor) vira UMA linha, agrupada por impressão digital,
-- com contador de ocorrências. O texto chega já limpo de dados pessoais (src/lib/monitoramento.ts). A tabela não tem acesso direto:
-- quem grava é o servidor (service_role, função erro_app_registrar) e quem lê e fecha é só a equipe EZRA (funções saas_erro*).
CREATE TABLE IF NOT EXISTS public.erros_app (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impressao text NOT NULL UNIQUE CHECK (length(impressao) BETWEEN 8 AND 128),
  origem text NOT NULL CHECK (origem IN ('navegador', 'servidor')),
  mensagem text NOT NULL CHECK (length(mensagem) <= 1000),
  stack text CHECK (stack IS NULL OR length(stack) <= 6000),
  rota text CHECK (rota IS NULL OR length(rota) <= 300),
  navegador text CHECK (navegador IS NULL OR length(navegador) <= 200),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ocorrencias integer NOT NULL DEFAULT 1,
  primeira_vez timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultima_vez timestamptz NOT NULL DEFAULT clock_timestamp(),
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'resolvido', 'ignorado')),
  situacao_em timestamptz
);
CREATE INDEX IF NOT EXISTS erros_app_situacao_idx ON public.erros_app (situacao, ultima_vez DESC);
CREATE INDEX IF NOT EXISTS erros_app_primeira_idx ON public.erros_app (primeira_vez);
ALTER TABLE public.erros_app ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erros_app FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erros_app TO service_role;
CREATE POLICY salao_restrito ON public.erros_app AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY contador_restrito ON public.erros_app AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));

-- Registra uma ocorrência (só o servidor chama). Erro repetido soma no contador; erro já resolvido que volta é reaberto.
-- Teto contra enxurrada: no máximo 500 erros NOVOS por hora; passando disso, só os já conhecidos continuam somando.
CREATE OR REPLACE FUNCTION public.erro_app_registrar(
  p_impressao text, p_origem text, p_mensagem text, p_stack text, p_rota text, p_navegador text, p_tenant uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_impressao IS NULL OR length(p_impressao) < 8 OR p_origem NOT IN ('navegador', 'servidor') OR coalesce(p_mensagem, '') = '' THEN
    RAISE EXCEPTION 'Erro inválido para registro';
  END IF;
  UPDATE public.erros_app
     SET ocorrencias = ocorrencias + 1,
         ultima_vez = clock_timestamp(),
         tenant_id = coalesce(p_tenant, tenant_id),
         situacao = CASE WHEN situacao = 'resolvido' THEN 'aberto' ELSE situacao END,
         situacao_em = CASE WHEN situacao = 'resolvido' THEN clock_timestamp() ELSE situacao_em END
   WHERE impressao = p_impressao;
  IF FOUND THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.erros_app WHERE primeira_vez > clock_timestamp() - interval '1 hour') >= 500 THEN RETURN; END IF;
  INSERT INTO public.erros_app (impressao, origem, mensagem, stack, rota, navegador, tenant_id)
  VALUES (p_impressao, p_origem, left(p_mensagem, 1000), left(p_stack, 6000), left(p_rota, 300), left(p_navegador, 200), p_tenant)
  ON CONFLICT (impressao) DO UPDATE SET ocorrencias = public.erros_app.ocorrencias + 1, ultima_vez = clock_timestamp();
END
$fn$;
REVOKE ALL ON FUNCTION public.erro_app_registrar(text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erro_app_registrar(text, text, text, text, text, text, uuid) TO service_role;

-- Lista para a equipe EZRA (operador): por situação, mais recentes primeiro, com o nome do cliente quando o erro veio de uma empresa.
CREATE OR REPLACE FUNCTION public.saas_erros_listar(p_situacao text DEFAULT 'aberto', p_limite integer DEFAULT 100)
RETURNS TABLE (
  id uuid, origem text, mensagem text, stack text, rota text, navegador text, cliente text,
  ocorrencias integer, primeira_vez timestamptz, ultima_vez timestamptz, situacao text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe EZRA'; END IF;
  IF p_situacao NOT IN ('aberto', 'resolvido', 'ignorado', 'todos') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  RETURN QUERY
  SELECT e.id, e.origem, e.mensagem, e.stack, e.rota, e.navegador,
         (SELECT c.nome FROM public.saas_clientes c WHERE c.tenant_id = e.tenant_id ORDER BY c.inicio DESC LIMIT 1),
         e.ocorrencias, e.primeira_vez, e.ultima_vez, e.situacao
    FROM public.erros_app e
   WHERE p_situacao = 'todos' OR e.situacao = p_situacao
   ORDER BY e.ultima_vez DESC
   LIMIT least(greatest(coalesce(p_limite, 100), 1), 500);
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_erros_listar(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_erros_listar(text, integer) TO authenticated;

-- Marca como resolvido, ignorado ou aberto (só a equipe).
CREATE OR REPLACE FUNCTION public.saas_erro_situacao(p_id uuid, p_situacao text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe EZRA'; END IF;
  IF p_situacao NOT IN ('aberto', 'resolvido', 'ignorado') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  UPDATE public.erros_app SET situacao = p_situacao, situacao_em = clock_timestamp() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Erro não encontrado'; END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_erro_situacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_erro_situacao(uuid, text) TO authenticated;

-- Retenção: apaga erros resolvidos ou ignorados há mais de 90 dias (chamada pela rotina de manutenção da equipe).
CREATE OR REPLACE FUNCTION public.erros_app_limpar() RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH d AS (DELETE FROM public.erros_app WHERE situacao <> 'aberto' AND situacao_em < clock_timestamp() - interval '90 days' RETURNING 1)
  SELECT count(*)::integer FROM d
$fn$;
REVOKE ALL ON FUNCTION public.erros_app_limpar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erros_app_limpar() TO service_role;
