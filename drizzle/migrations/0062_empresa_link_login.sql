ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS empresas_slug_unico ON public.empresas (lower(slug)) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.empresa_slug_valida()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    NEW.slug := lower(trim(NEW.slug));
    IF NEW.slug = '' THEN NEW.slug := NULL; RETURN NEW; END IF;
    IF NEW.slug !~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$' THEN
      RAISE EXCEPTION 'Link inválido: use de 3 a 50 letras minúsculas, números ou hífen, sem acento.';
    END IF;
    IF NEW.slug IN ('auth','api','contato','boas-vindas','ze-tech','ze-tech-login','dashboard','admin','login','app','www','empresa','assets','static') THEN
      RAISE EXCEPTION 'Esse link é reservado pelo sistema. Escolha outro.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS empresas_slug_valida ON public.empresas;
CREATE TRIGGER empresas_slug_valida BEFORE INSERT OR UPDATE OF slug ON public.empresas
FOR EACH ROW EXECUTE FUNCTION public.empresa_slug_valida();

CREATE OR REPLACE FUNCTION public.empresa_por_slug(p_slug text)
RETURNS TABLE(nome text, cor_primaria text, logo_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(e.nome_fantasia,''), e.razao_social), e.cor_primaria, e.logo_path
  FROM public.empresas e
  WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(trim(p_slug)) AND e.ativo
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.empresa_por_slug(text) FROM public;
GRANT EXECUTE ON FUNCTION public.empresa_por_slug(text) TO anon, authenticated, service_role;