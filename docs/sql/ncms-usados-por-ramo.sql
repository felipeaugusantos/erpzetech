-- NCMs que as empresas já usam, por segmento (ramo de atividade) e regime, com a combinação de tributação mais comum.
-- Serve para escolher por onde começar a carga fiscal inicial e para montar a lista de NCMs de cada rodada
-- (veja docs/carga-fiscal-inicial.md). SÓ LEITURA: roda no editor SQL do Supabase como dono do banco; não altera nada.
--
-- O que entra: NCMs de 8 dígitos dos produtos ativos e dos itens de notas AUTORIZADAS pela Sefaz (a Sefaz já aceitou aqueles dados,
-- então pesam mais do que o cadastro de produto). Só saem NCMs usados por pelo menos 2 empresas (mude `minimo_empresas` abaixo).
-- Privacidade: a saída traz só NCM, contagens e códigos fiscais, nunca nome de empresa, de produto ou de cliente. Mesmo assim, confira
-- o contrato antes de usar dados dos clientes para montar uma base que as outras empresas vão ver.
--
-- Colunas: ramo | regime (pelo código: 3 dígitos = CSOSN/simples, 2 = CST/normal) | ncm | empresas | produtos | itens_autorizados |
--          cst_csosn_mais_comum | cfop_mais_comum | concordancia_pct (% das linhas com a MESMA combinação CST/CSOSN + CFOP).
-- Leitura: concordância alta (acima de 90%) em várias empresas é um bom candidato; concordância baixa quer dizer que os clientes
-- tributam o mesmo NCM de jeitos diferentes, e o contador precisa decidir (ou o NCM fica de fora da carga).
WITH parametros AS (
  SELECT 2 AS minimo_empresas
), base AS (
  SELECT p.tenant_id, regexp_replace(p.ncm, '[^0-9]', '', 'g') AS ncm, p.cfop, p.cst_csosn, 'produto'::text AS fonte
    FROM public.produtos p
   WHERE p.ativo AND p.deleted_at IS NULL
     AND length(regexp_replace(coalesce(p.ncm, ''), '[^0-9]', '', 'g')) = 8
  UNION ALL
  SELECT i.tenant_id, regexp_replace(i.ncm, '[^0-9]', '', 'g'), i.cfop, i.cst_csosn, 'nota'::text
    FROM public.nfe_itens i JOIN public.nfe n ON n.id = i.nfe_id
   WHERE n.situacao = 'autorizada'
     AND length(regexp_replace(coalesce(i.ncm, ''), '[^0-9]', '', 'g')) = 8
), classificada AS (
  SELECT b.tenant_id, b.ncm, b.fonte,
         nullif(regexp_replace(coalesce(b.cfop, ''), '[^0-9]', '', 'g'), '') AS cfop,
         regexp_replace(b.cst_csosn, '[^0-9]', '', 'g') AS codigo,
         -- uma empresa pode ter mais de um CNPJ: vale o ramo da primeira
         (SELECT e.ramo_atividade FROM public.empresas e WHERE e.tenant_id = b.tenant_id ORDER BY e.created_at, e.id LIMIT 1) AS ramo
    FROM base b
   WHERE nullif(regexp_replace(coalesce(b.cst_csosn, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
), com_regime AS (
  SELECT c.*, CASE length(c.codigo) WHEN 3 THEN 'simples' WHEN 2 THEN 'normal' END AS regime
    FROM classificada c
), combinacoes AS (
  SELECT ramo, regime, ncm, codigo, cfop, count(*) AS n
    FROM com_regime WHERE regime IS NOT NULL GROUP BY ramo, regime, ncm, codigo, cfop
), mais_comum AS (
  SELECT DISTINCT ON (ramo, regime, ncm) ramo, regime, ncm, codigo, cfop, n
    FROM combinacoes ORDER BY ramo, regime, ncm, n DESC, codigo, cfop NULLS LAST
), totais AS (
  SELECT ramo, regime, ncm,
         count(DISTINCT tenant_id) AS empresas,
         count(*) FILTER (WHERE fonte = 'produto') AS produtos,
         count(*) FILTER (WHERE fonte = 'nota') AS itens_autorizados,
         count(*) AS linhas
    FROM com_regime WHERE regime IS NOT NULL GROUP BY ramo, regime, ncm
)
SELECT t.ramo, t.regime, t.ncm, t.empresas, t.produtos, t.itens_autorizados,
       m.codigo AS cst_csosn_mais_comum, m.cfop AS cfop_mais_comum,
       round(100.0 * m.n / t.linhas)::int AS concordancia_pct
  FROM totais t
  JOIN mais_comum m USING (ramo, regime, ncm)
  CROSS JOIN parametros p
 WHERE t.empresas >= p.minimo_empresas
 ORDER BY t.ramo, t.regime, t.empresas DESC, t.itens_autorizados DESC, t.ncm;
