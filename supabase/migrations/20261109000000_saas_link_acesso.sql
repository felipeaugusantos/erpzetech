-- Link de acesso (nome do link da tela de login) no cadastro do cliente assinante. A equipe Ze Tech informa o link ao cadastrar o assinante; a
-- empresa passa a usá-lo (empresas.slug, usado pelo login /nome-da-empresa) assim que existir, ou na hora se já existir. Se o administrador
-- da loja mudar o link na tela Empresa, o cadastro do assinante acompanha. O link é único entre assinantes e entre empresas.
ALTER TABLE public.saas_clientes ADD COLUMN IF NOT EXISTS link_acesso text;
CREATE UNIQUE INDEX IF NOT EXISTS saas_clientes_link_acesso_uq ON public.saas_clientes (lower(link_acesso)) WHERE link_acesso IS NOT NULL;

-- valida o formato e conflito com outra empresa
CREATE OR REPLACE FUNCTION public.saas_clientes_link_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.link_acesso := nullif(lower(btrim(coalesce(NEW.link_acesso, ''))), '');
  IF NEW.link_acesso IS NOT NULL THEN
    IF NEW.link_acesso !~ '^[a-z0-9-]{3,50}$' THEN
      RAISE EXCEPTION 'O link de acesso aceita de 3 a 50 letras minúsculas, números e hífen';
    END IF;
    IF EXISTS (SELECT 1 FROM public.empresas e WHERE e.slug = NEW.link_acesso AND e.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
      RAISE EXCEPTION 'Esse link já é usado por outra empresa';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.saas_clientes_link_valida() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_saas_clientes_link_valida ON public.saas_clientes;
CREATE TRIGGER trg_saas_clientes_link_valida BEFORE INSERT OR UPDATE OF link_acesso, tenant_id ON public.saas_clientes
  FOR EACH ROW EXECUTE FUNCTION public.saas_clientes_link_valida();

-- do cadastro do assinante para a empresa que já existe
CREATE OR REPLACE FUNCTION public.saas_clientes_link_aplica() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    UPDATE public.empresas SET slug = NEW.link_acesso
     WHERE id = (SELECT id FROM public.empresas WHERE tenant_id = NEW.tenant_id ORDER BY created_at LIMIT 1)
       AND slug IS DISTINCT FROM NEW.link_acesso
       AND (NEW.link_acesso IS NOT NULL OR TG_OP = 'UPDATE');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.saas_clientes_link_aplica() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_saas_clientes_link_aplica ON public.saas_clientes;
CREATE TRIGGER trg_saas_clientes_link_aplica AFTER INSERT OR UPDATE OF link_acesso, tenant_id ON public.saas_clientes
  FOR EACH ROW EXECUTE FUNCTION public.saas_clientes_link_aplica();

-- empresa nova nasce com o link combinado (se o administrador não informou outro)
CREATE OR REPLACE FUNCTION public.empresas_link_do_assinante() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.slug IS NULL AND NEW.tenant_id IS NOT NULL THEN
    SELECT s.link_acesso INTO NEW.slug FROM public.saas_clientes s WHERE s.tenant_id = NEW.tenant_id AND s.link_acesso IS NOT NULL LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.empresas_link_do_assinante() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_empresas_link_do_assinante ON public.empresas;
CREATE TRIGGER trg_empresas_link_do_assinante BEFORE INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.empresas_link_do_assinante();

-- do administrador da loja para o cadastro do assinante (só se o link tem o formato aceito no login)
CREATE OR REPLACE FUNCTION public.empresas_link_para_assinante() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND (NEW.slug IS NULL OR NEW.slug ~ '^[a-z0-9-]{3,50}$') THEN
    UPDATE public.saas_clientes SET link_acesso = NEW.slug
     WHERE tenant_id = NEW.tenant_id AND link_acesso IS DISTINCT FROM NEW.slug;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.empresas_link_para_assinante() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_empresas_link_para_assinante ON public.empresas;
CREATE TRIGGER trg_empresas_link_para_assinante AFTER INSERT OR UPDATE OF slug ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.empresas_link_para_assinante();
