ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS cnae_secundarios text;
ALTER TABLE public.os_ordens ADD COLUMN IF NOT EXISTS horas_trabalhadas numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.saas_custo_por_tecnico(p_de date, p_ate date)
RETURNS TABLE (
  cliente_id uuid,
  cliente text,
  tenant_id uuid,
  tecnico_id uuid,
  tecnico text,
  cargo text,
  especialidade text,
  custo_hora numeric,
  comissao_percentual numeric,
  ordens bigint,
  encerradas bigint,
  horas numeric,
  custo_mao_obra numeric,
  valor_servicos numeric,
  valor_pecas numeric,
  comissao numeric,
  custo_total numeric,
  ultima_ordem timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.nome,
    c.tenant_id,
    t.id,
    t.nome,
    t.cargo,
    t.especialidade,
    COALESCE(t.custo_hora, 0),
    COALESCE(t.comissao_percentual, 0),
    COUNT(o.id),
    COUNT(o.id) FILTER (WHERE o.situacao = 'entregue'),
    COALESCE(SUM(o.horas_trabalhadas), 0),
    COALESCE(SUM(o.horas_trabalhadas), 0) * COALESCE(t.custo_hora, 0),
    COALESCE(SUM(o.valor_servicos), 0),
    COALESCE(SUM(o.valor_pecas), 0),
    ROUND(COALESCE(SUM(o.valor_servicos), 0) * COALESCE(t.comissao_percentual, 0) / 100, 2),
    COALESCE(SUM(o.horas_trabalhadas), 0) * COALESCE(t.custo_hora, 0)
      + COALESCE(SUM(o.valor_pecas), 0)
      + ROUND(COALESCE(SUM(o.valor_servicos), 0) * COALESCE(t.comissao_percentual, 0) / 100, 2),
    MAX(o.abertura)
  FROM public.saas_clientes c
  JOIN public.tecnicos t ON t.tenant_id = c.tenant_id
  LEFT JOIN public.os_ordens o
    ON o.tecnico_id = t.id
   AND o.abertura >= p_de
   AND o.abertura < (p_ate + 1)
  WHERE public.eh_saas_operador()
    AND c.tenant_id IS NOT NULL
  GROUP BY c.id, c.nome, c.tenant_id, t.id, t.nome, t.cargo, t.especialidade, t.custo_hora, t.comissao_percentual
  ORDER BY c.nome, t.nome
$$;

REVOKE ALL ON FUNCTION public.saas_custo_por_tecnico(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.saas_custo_por_tecnico(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.assistencia_ordens_relatorio(p_de date, p_ate date, p_filial_id uuid DEFAULT NULL)
RETURNS TABLE (
  os_id uuid,
  numero integer,
  abertura timestamptz,
  entregue_em timestamptz,
  situacao text,
  prioridade text,
  filial_id uuid,
  filial text,
  cliente text,
  equipamento text,
  marca text,
  modelo text,
  defeito_relatado text,
  laudo text,
  tecnico text,
  horas_trabalhadas numeric,
  valor_pecas numeric,
  valor_servicos numeric,
  desconto numeric,
  valor_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.numero,
    o.abertura,
    o.entregue_em,
    o.situacao::text,
    o.prioridade,
    o.filial_id,
    f.nome,
    cl.nome,
    o.equipamento,
    o.marca,
    o.modelo,
    o.defeito_relatado,
    o.laudo,
    COALESCE(t.nome, o.tecnico_nome),
    COALESCE(o.horas_trabalhadas, 0),
    COALESCE(o.valor_pecas, 0),
    COALESCE(o.valor_servicos, 0),
    COALESCE(o.desconto, 0),
    COALESCE(o.valor_total, 0)
  FROM public.os_ordens o
  LEFT JOIN public.filiais f ON f.id = o.filial_id
  LEFT JOIN public.clientes cl ON cl.id = o.cliente_id
  LEFT JOIN public.tecnicos t ON t.id = o.tecnico_id
  WHERE o.tenant_id = public.current_tenant_id()
    AND o.abertura >= p_de
    AND o.abertura < (p_ate + 1)
    AND (p_filial_id IS NULL OR o.filial_id = p_filial_id)
  ORDER BY o.abertura DESC
$$;

REVOKE ALL ON FUNCTION public.assistencia_ordens_relatorio(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assistencia_ordens_relatorio(date, date, uuid) TO authenticated;