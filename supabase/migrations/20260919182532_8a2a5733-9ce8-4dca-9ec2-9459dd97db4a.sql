CREATE TABLE public.tecnicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  filial_id uuid REFERENCES public.filiais(id) ON DELETE SET NULL,
  nome text NOT NULL,
  cargo text,
  especialidade text,
  telefone text,
  email text,
  documento text,
  custo_hora numeric NOT NULL DEFAULT 0,
  comissao_percentual numeric NOT NULL DEFAULT 0,
  admissao date,
  demissao date,
  ativo boolean NOT NULL DEFAULT true,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tecnicos TO authenticated;
GRANT ALL ON public.tecnicos TO service_role;

ALTER TABLE public.tecnicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tecnicos visiveis no tenant" ON public.tecnicos
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "Gestor cadastra tecnico" ON public.tecnicos
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'administrador') OR has_role(auth.uid(),'gestor')));

CREATE POLICY "Gestor edita tecnico" ON public.tecnicos
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id()
    AND (has_role(auth.uid(),'administrador') OR has_role(auth.uid(),'gestor')))
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "Administrador remove tecnico" ON public.tecnicos
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND has_role(auth.uid(),'administrador'));

CREATE TRIGGER tecnicos_updated_at BEFORE UPDATE ON public.tecnicos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.os_ordens
  ADD COLUMN IF NOT EXISTS tecnico_id uuid REFERENCES public.tecnicos(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.assistencia_por_filial(p_de date, p_ate date)
RETURNS TABLE(filial_id uuid, filial text, codigo text,
  abertas bigint, encerradas bigint, em_reparo bigint, pendentes bigint, canceladas bigint,
  valor_pecas numeric, valor_servicos numeric, valor_total numeric,
  ticket_medio numeric, ultima_abertura timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if current_tenant_id() is null then
    raise exception 'Usuário sem empresa vinculada';
  end if;
  return query
    select f.id,
           f.nome,
           f.codigo,
           count(o.id),
           count(o.id) filter (where o.situacao = 'entregue'),
           count(o.id) filter (where o.situacao = 'em_reparo'),
           count(o.id) filter (where o.situacao not in ('entregue','cancelada')),
           count(o.id) filter (where o.situacao = 'cancelada'),
           coalesce(sum(o.valor_pecas),0),
           coalesce(sum(o.valor_servicos),0),
           coalesce(sum(o.valor_total),0),
           case when count(o.id) filter (where o.situacao <> 'cancelada') > 0
             then coalesce(sum(o.valor_total) filter (where o.situacao <> 'cancelada'),0)
                  / count(o.id) filter (where o.situacao <> 'cancelada')
             else 0 end,
           max(o.abertura)
      from public.filiais f
      left join public.os_ordens o
        on o.filial_id = f.id
       and o.tenant_id = f.tenant_id
       and o.abertura::date between p_de and p_ate
     where f.tenant_id = current_tenant_id()
     group by f.id, f.nome, f.codigo
     order by count(o.id) desc, f.nome;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.assistencia_por_filial(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistencia_por_filial(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.saas_tempo_real_por_cliente(p_de date, p_ate date)
RETURNS TABLE(cliente_id uuid, cliente text, plano text, tenant_id uuid, situacao text,
  pedidos bigint, valor_vendas numeric, ultima_venda timestamptz,
  notas bigint, notas_autorizadas bigint, valor_notas numeric, impostos numeric, ultima_nota timestamptz,
  os_abertas bigint, os_pendentes bigint, os_custo numeric, ultima_os timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not eh_saas_operador() then
    raise exception 'Acesso restrito à equipe Ze Tech';
  end if;
  return query
    select c.id,
           c.nome,
           p.nome,
           c.tenant_id,
           c.situacao::text,
           coalesce(v.pedidos,0),
           coalesce(v.valor,0),
           v.ultima,
           coalesce(n.notas,0),
           coalesce(n.autorizadas,0),
           coalesce(n.valor,0),
           coalesce(n.impostos,0),
           n.ultima,
           coalesce(o.abertas,0),
           coalesce(o.pendentes,0),
           coalesce(o.custo,0),
           o.ultima
      from public.saas_clientes c
      left join public.saas_planos p on p.id = c.plano_id
      left join (
        select pe.tenant_id,
               count(*) as pedidos,
               sum(pe.valor_total) as valor,
               max(pe.created_at) as ultima
          from public.pedidos pe
         where pe.created_at::date between p_de and p_ate
           and pe.situacao <> 'cancelado'
         group by pe.tenant_id
      ) v on v.tenant_id = c.tenant_id
      left join (
        select nf.tenant_id,
               count(*) as notas,
               count(*) filter (where nf.situacao in ('autorizada','emitida')) as autorizadas,
               sum(nf.valor_total) as valor,
               sum(coalesce(nf.valor_icms,0) + coalesce(nf.valor_icms_st,0)
                   + coalesce(nf.valor_pis,0) + coalesce(nf.valor_cofins,0)
                   + coalesce(nf.valor_iss,0)) as impostos,
               max(coalesce(nf.autorizada_em, nf.created_at)) as ultima
          from public.nfe nf
         where coalesce(nf.autorizada_em, nf.created_at)::date between p_de and p_ate
         group by nf.tenant_id
      ) n on n.tenant_id = c.tenant_id
      left join (
        select os.tenant_id,
               count(*) as abertas,
               count(*) filter (where os.situacao not in ('entregue','cancelada')) as pendentes,
               sum(os.valor_total) as custo,
               max(os.abertura) as ultima
          from public.os_ordens os
         where os.abertura::date between p_de and p_ate
         group by os.tenant_id
      ) o on o.tenant_id = c.tenant_id
     order by coalesce(v.valor,0) desc, c.nome;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.saas_tempo_real_por_cliente(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_tempo_real_por_cliente(date, date) TO authenticated;