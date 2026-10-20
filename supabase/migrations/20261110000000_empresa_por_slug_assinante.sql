-- O link de acesso combinado no cadastro do assinante já abre a tela de login da loja, mesmo antes de o administrador cadastrar a empresa
-- (até então só existia o link no cadastro do assinante, e o endereço mostrava "Empresa não encontrada"). A empresa, quando existe, tem
-- prioridade; sem ela, vale o nome do cadastro do assinante (que não esteja cancelado), com a cor e a logo padrão.
CREATE OR REPLACE FUNCTION public.empresa_por_slug(p_slug text)
RETURNS TABLE(nome text, cor_primaria text, logo_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.nome, r.cor_primaria, r.logo_path FROM (
    SELECT 1 AS ordem, coalesce(nullif(e.nome_fantasia, ''), e.razao_social) AS nome, e.cor_primaria, e.logo_path
      FROM public.empresas e
     WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(trim(p_slug)) AND e.ativo
    UNION ALL
    SELECT 2, s.nome, NULL::text, NULL::text
      FROM public.saas_clientes s
     WHERE s.link_acesso IS NOT NULL AND lower(s.link_acesso) = lower(trim(p_slug)) AND s.situacao <> 'cancelado'
  ) r
  ORDER BY r.ordem
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.empresa_por_slug(text) FROM public;
GRANT EXECUTE ON FUNCTION public.empresa_por_slug(text) TO anon, authenticated, service_role;
