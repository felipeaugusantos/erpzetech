-- Links de acesso personalizados por empresa, criados pela equipe Ze Tech, e registro de qual link cada usuário usou para entrar.
-- O link é qualquer texto livre (3 a 50 letras minúsculas, números e hífen) e não depende do nome da empresa. Uma empresa pode ter vários.
-- Além deles continuam valendo o link principal da empresa (empresas.slug), o combinado no cadastro do assinante e o código da empresa.
-- Link desativado deixa de abrir a tela de login e de aceitar entrada. O link não pode ser trocado depois de criado (o histórico de uso aponta para ele).

CREATE TABLE IF NOT EXISTS public.empresa_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  rotulo text CHECK (rotulo IS NULL OR length(rotulo) <= 80),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS empresa_links_slug_uq ON public.empresa_links (lower(slug));
CREATE INDEX IF NOT EXISTS empresa_links_tenant_idx ON public.empresa_links (tenant_id);

-- Uso: um registro por usuário e link, com a contagem de entradas.
CREATE TABLE IF NOT EXISTS public.link_acesso_usuarios (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  link_slug text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.empresa_links(id) ON DELETE SET NULL,
  origem text NOT NULL CHECK (origem IN ('personalizado', 'principal', 'assinante', 'codigo')),
  acessos integer NOT NULL DEFAULT 1,
  primeiro_em timestamptz NOT NULL DEFAULT now(),
  ultimo_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, link_slug)
);
CREATE INDEX IF NOT EXISTS link_acesso_usuarios_tenant_idx ON public.link_acesso_usuarios (tenant_id, link_slug);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresa_links', 'link_acesso_usuarios'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    -- só a equipe Ze Tech lê
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.eh_saas_operador()))', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
CREATE TRIGGER trg_empresa_links_updated BEFORE UPDATE ON public.empresa_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Formato, nomes reservados e conflito com os outros tipos de link. O texto do link não muda depois de criado.
CREATE OR REPLACE FUNCTION public.empresa_links_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF lower(NEW.slug) IS DISTINCT FROM lower(OLD.slug) OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'O link e a empresa não mudam depois de criados. Crie outro link e desative este';
    END IF;
    RETURN NEW;
  END IF;
  NEW.slug := lower(btrim(coalesce(NEW.slug, '')));
  NEW.rotulo := nullif(btrim(coalesce(NEW.rotulo, '')), '');
  IF NEW.slug !~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$' THEN
    RAISE EXCEPTION 'O link aceita de 3 a 50 letras minúsculas, números e hífen, sem hífen no começo ou no fim';
  END IF;
  IF NEW.slug IN ('auth','api','contato','funcionalidades','boas-vindas','ze-tech','ze-tech-login','dashboard','admin','login','app','www','empresa','assets','static') THEN
    RAISE EXCEPTION 'Esse link é reservado pelo sistema. Escolha outro.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.empresas e WHERE lower(e.slug) = NEW.slug)
     OR EXISTS (SELECT 1 FROM public.saas_clientes s WHERE lower(s.link_acesso) = NEW.slug)
     OR EXISTS (SELECT 1 FROM public.empresa_links l WHERE lower(l.slug) = NEW.slug) THEN
    RAISE EXCEPTION 'Esse link já está em uso. Escolha outro.';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.empresa_links_valida() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_empresa_links_valida ON public.empresa_links;
CREATE TRIGGER trg_empresa_links_valida BEFORE INSERT OR UPDATE ON public.empresa_links
  FOR EACH ROW EXECUTE FUNCTION public.empresa_links_valida();

-- Os outros tipos de link também não podem tomar um link personalizado.
CREATE OR REPLACE FUNCTION public.empresas_link_livre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.slug IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.saas_clientes s
        WHERE lower(s.link_acesso) = lower(NEW.slug) AND s.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'Esse link já é usado por outra empresa.' USING ERRCODE = '23505';
  END IF;
  IF NEW.slug IS NOT NULL AND EXISTS (SELECT 1 FROM public.empresa_links l WHERE lower(l.slug) = lower(NEW.slug)) THEN
    RAISE EXCEPTION 'Esse link já é usado por outra empresa.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.empresas_link_livre() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.saas_clientes_link_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  NEW.link_acesso := nullif(lower(btrim(coalesce(NEW.link_acesso, ''))), '');
  IF NEW.link_acesso IS NOT NULL THEN
    IF NEW.link_acesso !~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$' THEN
      RAISE EXCEPTION 'O link de acesso aceita de 3 a 50 letras minúsculas, números e hífen, sem hífen no começo ou no fim';
    END IF;
    IF NEW.link_acesso IN ('auth','api','contato','boas-vindas','ze-tech','ze-tech-login','dashboard','admin','login','app','www','empresa','assets','static') THEN
      RAISE EXCEPTION 'Esse link é reservado pelo sistema. Escolha outro.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.empresas e WHERE e.slug = NEW.link_acesso AND e.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
      RAISE EXCEPTION 'Esse link já é usado por outra empresa';
    END IF;
    IF EXISTS (SELECT 1 FROM public.empresa_links l WHERE lower(l.slug) = NEW.link_acesso) THEN
      RAISE EXCEPTION 'Esse link já é usado por outra empresa';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.saas_clientes_link_valida() FROM PUBLIC, anon, authenticated;

-- Tela de login pelo link: a empresa do link personalizado aparece com a marca dela.
CREATE OR REPLACE FUNCTION public.empresa_por_slug(p_slug text)
RETURNS TABLE(nome text, cor_primaria text, logo_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT r.nome, r.cor_primaria, r.logo_path FROM (
    SELECT 1 AS ordem, coalesce(nullif(e.nome_fantasia, ''), e.razao_social) AS nome, e.cor_primaria, e.logo_path
      FROM public.empresas e
     WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(trim(p_slug)) AND e.ativo
    UNION ALL
    -- loja ainda sem empresa cadastrada: o link abre com o nome do cadastro do assinante (como o link do próprio cadastro)
    SELECT 2, coalesce(nullif(e2.nome_fantasia, ''), e2.razao_social, sc.nome), e2.cor_primaria, e2.logo_path
      FROM public.empresa_links l
      LEFT JOIN LATERAL (SELECT * FROM public.empresas x WHERE x.tenant_id = l.tenant_id ORDER BY x.created_at, x.id LIMIT 1) e2 ON true
      LEFT JOIN LATERAL (SELECT c.nome FROM public.saas_clientes c WHERE c.tenant_id = l.tenant_id AND c.situacao <> 'cancelado' ORDER BY c.created_at LIMIT 1) sc ON true
     WHERE l.ativo AND lower(l.slug) = lower(trim(p_slug)) AND (e2.id IS NULL OR e2.ativo) AND coalesce(nullif(e2.nome_fantasia, ''), e2.razao_social, sc.nome) IS NOT NULL
    UNION ALL
    SELECT 3, s.nome, NULL::text, NULL::text
      FROM public.saas_clientes s
     WHERE s.link_acesso IS NOT NULL AND lower(s.link_acesso) = lower(trim(p_slug)) AND s.situacao <> 'cancelado'
  ) r
  ORDER BY r.ordem
  LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.empresa_por_slug(text) FROM public;
GRANT EXECUTE ON FUNCTION public.empresa_por_slug(text) TO anon, authenticated, service_role;

-- ===== Equipe Ze Tech =====

CREATE OR REPLACE FUNCTION public.saas_link_criar(p_tenant uuid, p_slug text, p_rotulo text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe Ze Tech'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.saas_clientes WHERE tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'Empresa não encontrada entre os clientes da rede';
  END IF;
  INSERT INTO public.empresa_links (tenant_id, slug, rotulo) VALUES (p_tenant, p_slug, p_rotulo) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.saas_link_criar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_link_criar(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.saas_link_atualizar(p_id uuid, p_rotulo text, p_ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe Ze Tech'; END IF;
  IF length(coalesce(p_rotulo, '')) > 80 THEN RAISE EXCEPTION 'O nome do link aceita até 80 caracteres'; END IF;
  UPDATE public.empresa_links SET rotulo = nullif(btrim(coalesce(p_rotulo, '')), ''), ativo = coalesce(p_ativo, ativo) WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link não encontrado'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.saas_link_atualizar(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_link_atualizar(uuid, text, boolean) TO authenticated;

-- Todos os links das empresas da rede (personalizados, o principal da empresa e o combinado no cadastro), com o uso de cada um.
CREATE OR REPLACE FUNCTION public.saas_links_listar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe Ze Tech'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x.linha ORDER BY x.cliente, x.ordem, x.slug)
      FROM (
        SELECT c.nome AS cliente, u.ordem, u.slug,
               jsonb_build_object(
                 'tenant_id', c.tenant_id, 'cliente', c.nome, 'link_id', u.link_id, 'slug', u.slug, 'rotulo', u.rotulo,
                 'ativo', u.ativo, 'origem', u.origem, 'criado_em', u.criado_em,
                 'usuarios', coalesce(a.usuarios, 0), 'acessos', coalesce(a.acessos, 0), 'ultimo_acesso', a.ultimo) AS linha
          FROM public.saas_clientes c
          CROSS JOIN LATERAL (
            SELECT 1 AS ordem, l.slug, l.id AS link_id, l.rotulo, l.ativo, 'personalizado'::text AS origem, l.created_at AS criado_em
              FROM public.empresa_links l WHERE l.tenant_id = c.tenant_id
            UNION ALL
            SELECT 2, e.slug, NULL::uuid, NULL::text, e.ativo, 'principal', e.created_at
              FROM public.empresas e WHERE e.tenant_id = c.tenant_id AND e.slug IS NOT NULL
            UNION ALL
            SELECT 3, c.link_acesso, NULL::uuid, NULL::text, c.situacao <> 'cancelado', 'assinante', c.created_at
             WHERE c.link_acesso IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.empresas e2 WHERE e2.tenant_id = c.tenant_id AND lower(e2.slug) = lower(c.link_acesso))
          ) u
          LEFT JOIN LATERAL (
            SELECT count(*)::int AS usuarios, sum(k.acessos)::int AS acessos, max(k.ultimo_em) AS ultimo
              FROM public.link_acesso_usuarios k WHERE k.tenant_id = c.tenant_id AND lower(k.link_slug) = lower(u.slug)) a ON true
         WHERE c.tenant_id IS NOT NULL) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.saas_links_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_links_listar() TO authenticated;

-- Usuários da empresa e os links que cada um usou para entrar (o mais recente primeiro).
CREATE OR REPLACE FUNCTION public.saas_link_usuarios(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Acesso restrito à equipe Ze Tech'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'user_id', p.id, 'nome', p.nome, 'usuario', p.usuario, 'email', p.email, 'ativo', p.ativo,
             'ultimo_acesso', (SELECT max(k.ultimo_em) FROM public.link_acesso_usuarios k WHERE k.user_id = p.id),
             'links', coalesce((SELECT jsonb_agg(jsonb_build_object('slug', k.link_slug, 'origem', k.origem, 'rotulo', l.rotulo,
                                                                    'acessos', k.acessos, 'primeiro_em', k.primeiro_em, 'ultimo_em', k.ultimo_em)
                                                 ORDER BY k.ultimo_em DESC)
                                  FROM public.link_acesso_usuarios k LEFT JOIN public.empresa_links l ON l.id = k.link_id
                                 WHERE k.user_id = p.id), '[]'::jsonb))
           ORDER BY p.nome)
      FROM public.profiles p WHERE p.tenant_id = p_tenant), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.saas_link_usuarios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_link_usuarios(uuid) TO authenticated;

-- ===== Só o serviço =====

-- Registra que o usuário entrou por este link. Só vale se o link é da empresa do próprio usuário (senão não grava nada).
-- Aceita o link personalizado, o principal da empresa, o do cadastro do assinante e o código (UUID) da empresa.
CREATE OR REPLACE FUNCTION public.link_acesso_registrar(p_user uuid, p_slug text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_tenant uuid; v_link uuid; v_origem text;
BEGIN
  IF v_slug = '' OR length(v_slug) > 60 THEN RETURN; END IF;
  IF v_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.id = v_slug::uuid;
    v_origem := 'codigo';
  END IF;
  IF v_tenant IS NULL THEN
    SELECT l.tenant_id, l.id INTO v_tenant, v_link FROM public.empresa_links l WHERE l.ativo AND lower(l.slug) = v_slug;
    v_origem := 'personalizado';
  END IF;
  IF v_tenant IS NULL THEN
    SELECT e.tenant_id INTO v_tenant FROM public.empresas e WHERE e.ativo AND lower(e.slug) = v_slug;
    v_origem := 'principal';
  END IF;
  IF v_tenant IS NULL THEN
    SELECT s.tenant_id INTO v_tenant FROM public.saas_clientes s WHERE s.situacao <> 'cancelado' AND lower(s.link_acesso) = v_slug;
    v_origem := 'assinante';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND p.tenant_id = v_tenant) THEN RETURN; END IF;
  INSERT INTO public.link_acesso_usuarios (user_id, link_slug, tenant_id, link_id, origem)
  VALUES (p_user, v_slug, v_tenant, v_link, v_origem)
  ON CONFLICT (user_id, link_slug) DO UPDATE SET acessos = public.link_acesso_usuarios.acessos + 1, ultimo_em = now();
END $fn$;
REVOKE ALL ON FUNCTION public.link_acesso_registrar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_acesso_registrar(uuid, text) TO service_role;
