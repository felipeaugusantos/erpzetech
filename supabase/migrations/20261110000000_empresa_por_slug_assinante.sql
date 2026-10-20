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

-- No primeiro acesso, a tela Empresa mostra o link que a equipe Ze Tech combinou no cadastro do assinante (só o do próprio tenant).
CREATE OR REPLACE FUNCTION public.assinante_link_sugerido()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.link_acesso FROM public.saas_clientes s
   WHERE s.tenant_id = public.current_tenant_id() AND s.link_acesso IS NOT NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.assinante_link_sugerido() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinante_link_sugerido() TO authenticated;

-- Ajuste do espelho empresa -> assinante: se o link já é de outro cadastro (por exemplo, o que acabou de aplicá-lo à empresa), não se repete.
CREATE OR REPLACE FUNCTION public.empresas_link_para_assinante() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND (NEW.slug IS NULL OR NEW.slug ~ '^[a-z0-9-]{3,50}$') THEN
    UPDATE public.saas_clientes SET link_acesso = NEW.slug
     WHERE tenant_id = NEW.tenant_id AND link_acesso IS DISTINCT FROM NEW.slug
       AND (NEW.slug IS NULL OR NOT EXISTS (SELECT 1 FROM public.saas_clientes o WHERE lower(o.link_acesso) = lower(NEW.slug)));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.empresas_link_para_assinante() FROM PUBLIC, anon, authenticated;

-- O link reservado no cadastro de outro assinante (que ainda não cadastrou a empresa) não pode ser tomado por outra empresa: a empresa tem
-- prioridade na busca, então ela desviaria o endereço do assinante. O link do próprio tenant continua valendo.
CREATE OR REPLACE FUNCTION public.empresas_link_livre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.slug IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.saas_clientes s
        WHERE lower(s.link_acesso) = lower(NEW.slug) AND s.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'Esse link já é usado por outra empresa.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.empresas_link_livre() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_empresas_link_livre ON public.empresas;
CREATE TRIGGER trg_empresas_link_livre BEFORE INSERT OR UPDATE OF slug ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.empresas_link_livre();
