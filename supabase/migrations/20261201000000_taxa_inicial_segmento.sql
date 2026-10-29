-- Taxa inicial por segmento: Clínica Veterinária e Lava-Rápido pagam R$ 299 de treinamento e configuração inicial, taxa única, no lugar
-- da implantação inicial do plano. Só a taxa inicial muda: a implantação de filial/empresa adicional (assinaturas.valor_implantacao,
-- saas_planos.valor_implantacao nas cobranças de loja) e as mensalidades seguem como estão. Nada é gravado: as funções só calculam o valor
-- para mostrar e sugerir a cobrança. O segmento é o ramo de atividade da empresa (empresas.ramo_atividade).

-- Regra em um só lugar. Devolve uma linha só para os segmentos com taxa própria; nos demais não devolve linha.
CREATE OR REPLACE FUNCTION public.taxa_inicial_segmento(p_ramo text)
RETURNS TABLE (valor numeric, rotulo text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT 299::numeric, 'Treinamento e configuração inicial'::text
   WHERE p_ramo IN ('clinica', 'lavarapido')
$$;

-- Taxa inicial da própria empresa (a tela Plano e assinatura). Sem SECURITY DEFINER: a leitura segue a RLS da assinatura e da empresa.
CREATE OR REPLACE FUNCTION public.assinatura_taxa_inicial()
RETURNS TABLE (valor numeric, rotulo text, excecao boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(t.valor, a.valor_implantacao), COALESCE(t.rotulo, 'Implantação'), t.valor IS NOT NULL
    FROM public.assinaturas a
    LEFT JOIN LATERAL (SELECT e.ramo_atividade FROM public.empresas e WHERE e.tenant_id = a.tenant_id ORDER BY e.created_at LIMIT 1) emp ON true
    LEFT JOIN LATERAL public.taxa_inicial_segmento(emp.ramo_atividade) t ON true
   LIMIT 1
$$;

-- Taxa inicial de um assinante, para a equipe sugerir a cobrança. Só operador.
CREATE OR REPLACE FUNCTION public.saas_taxa_inicial_cliente(p_cliente_id uuid)
RETURNS TABLE (valor numeric, rotulo text, excecao boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Área exclusiva da Ze Tech'; END IF;
  RETURN QUERY
  SELECT COALESCE(t.valor, p.valor_implantacao, 1500::numeric), COALESCE(t.rotulo, 'Implantação'), t.valor IS NOT NULL
    FROM public.saas_clientes c
    LEFT JOIN public.saas_planos p ON p.id = c.plano_id
    LEFT JOIN LATERAL (SELECT e.ramo_atividade FROM public.empresas e WHERE e.tenant_id = c.tenant_id ORDER BY e.created_at LIMIT 1) emp ON true
    LEFT JOIN LATERAL public.taxa_inicial_segmento(emp.ramo_atividade) t ON true
   WHERE c.id = p_cliente_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.taxa_inicial_segmento(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assinatura_taxa_inicial() FROM anon;
REVOKE EXECUTE ON FUNCTION public.saas_taxa_inicial_cliente(uuid) FROM anon;
