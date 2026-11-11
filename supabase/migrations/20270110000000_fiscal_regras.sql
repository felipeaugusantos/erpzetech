-- Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 2).
-- Base GLOBAL de regras mantida pela equipe Ze Tech + sobrescritas e ocultações por empresa.
-- As tabelas NÃO têm acesso direto: a empresa só consulta pela função fiscal_sugerir, que descobre a empresa pela sessão.
-- É só sugestão: nada aqui altera produto, nota ou imposto. A escrita (carga da equipe, sobrescrita da empresa) vem nos PRs seguintes;
-- por ora as tabelas só recebem dados por service_role.
-- A função espelha src/lib/fiscal-regras.ts (precedência, especificidade, vigência e empate).

-- ===== 1. Perfis tributários =====
-- tenant_id nulo = perfil global (da equipe); preenchido = perfil próprio da empresa (só ela usa).
CREATE TABLE IF NOT EXISTS public.fiscal_perfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  descricao text CHECK (descricao IS NULL OR length(descricao) <= 500),
  cst_icms text CHECK (cst_icms IS NULL OR cst_icms ~ '^[0-9]{2}$'),
  csosn text CHECK (csosn IS NULL OR csosn ~ '^[0-9]{3}$'),
  cfop text CHECK (cfop IS NULL OR cfop ~ '^[0-9]{4}$'),
  aliq_icms numeric(7, 4) CHECK (aliq_icms IS NULL OR aliq_icms BETWEEN 0 AND 100),
  reducao_base_icms numeric(7, 4) CHECK (reducao_base_icms IS NULL OR reducao_base_icms BETWEEN 0 AND 100),
  mva_st numeric(8, 4) CHECK (mva_st IS NULL OR mva_st BETWEEN 0 AND 1000),
  cst_pis text CHECK (cst_pis IS NULL OR cst_pis ~ '^[0-9]{2}$'),
  aliq_pis numeric(7, 4) CHECK (aliq_pis IS NULL OR aliq_pis BETWEEN 0 AND 100),
  cst_cofins text CHECK (cst_cofins IS NULL OR cst_cofins ~ '^[0-9]{2}$'),
  aliq_cofins numeric(7, 4) CHECK (aliq_cofins IS NULL OR aliq_cofins BETWEEN 0 AND 100),
  cst_ibs_cbs text CHECK (cst_ibs_cbs IS NULL OR cst_ibs_cbs ~ '^[0-9]{3}$'),
  cclasstrib text CHECK (cclasstrib IS NULL OR cclasstrib ~ '^[0-9]{6}$'),
  origem text CHECK (origem IS NULL OR origem ~ '^[0-8]$'),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_perfis_nome_uk
  ON public.fiscal_perfis (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nome)));

-- O dono do perfil (global ou empresa) não muda: regras já apontam para ele.
CREATE OR REPLACE FUNCTION public.fiscal_perfis_dono_fixo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'O dono do perfil fiscal não pode mudar';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiscal_perfis_dono_fixo_trg ON public.fiscal_perfis;
CREATE TRIGGER fiscal_perfis_dono_fixo_trg BEFORE UPDATE OF tenant_id ON public.fiscal_perfis
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_perfis_dono_fixo();

-- ===== 2. Regras globais =====
CREATE TABLE IF NOT EXISTS public.fiscal_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id uuid NOT NULL REFERENCES public.fiscal_perfis(id) ON DELETE RESTRICT,
  ncm_prefixo text NOT NULL CHECK (ncm_prefixo ~ '^[0-9]{2,8}$'),
  cest text CHECK (cest IS NULL OR cest ~ '^[0-9]{7}$'),
  operacao text CHECK (operacao IS NULL OR operacao ~ '^[a-z_]{1,30}$'),
  regime text CHECK (regime IS NULL OR regime IN ('normal', 'simples', 'mei')),
  uf_destino text CHECK (uf_destino IS NULL OR uf_destino ~ '^[A-Z]{2}$'),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  ativa boolean NOT NULL DEFAULT true,
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 500),
  fonte text CHECK (fonte IS NULL OR length(fonte) <= 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS fiscal_regras_ncm_idx ON public.fiscal_regras (ncm_prefixo);
CREATE INDEX IF NOT EXISTS fiscal_regras_perfil_idx ON public.fiscal_regras (perfil_id);

-- ===== 3. Sobrescritas da empresa =====
CREATE TABLE IF NOT EXISTS public.fiscal_empresa_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  perfil_id uuid NOT NULL REFERENCES public.fiscal_perfis(id) ON DELETE RESTRICT,
  ncm_prefixo text NOT NULL CHECK (ncm_prefixo ~ '^[0-9]{2,8}$'),
  cest text CHECK (cest IS NULL OR cest ~ '^[0-9]{7}$'),
  operacao text CHECK (operacao IS NULL OR operacao ~ '^[a-z_]{1,30}$'),
  regime text CHECK (regime IS NULL OR regime IN ('normal', 'simples', 'mei')),
  uf_destino text CHECK (uf_destino IS NULL OR uf_destino ~ '^[A-Z]{2}$'),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  ativa boolean NOT NULL DEFAULT true,
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS fiscal_empresa_regras_tenant_idx ON public.fiscal_empresa_regras (tenant_id, ncm_prefixo);

-- Regras globais que a empresa decidiu ignorar (o motivo é obrigatório).
CREATE TABLE IF NOT EXISTS public.fiscal_empresa_ocultas (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  regra_id uuid NOT NULL REFERENCES public.fiscal_regras(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 300),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  PRIMARY KEY (tenant_id, regra_id)
);

-- A regra global só aponta para perfil global; a da empresa, para perfil global ou da própria empresa.
CREATE OR REPLACE FUNCTION public.fiscal_regra_perfil_confere()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_dono uuid;
BEGIN
  SELECT p.tenant_id INTO v_dono FROM public.fiscal_perfis p WHERE p.id = NEW.perfil_id;
  IF TG_TABLE_NAME = 'fiscal_regras' THEN
    IF v_dono IS NOT NULL THEN RAISE EXCEPTION 'Regra global só pode usar perfil global'; END IF;
  ELSIF v_dono IS NOT NULL AND v_dono <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Regra da empresa não pode usar perfil de outra empresa';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiscal_regras_perfil_trg ON public.fiscal_regras;
CREATE TRIGGER fiscal_regras_perfil_trg BEFORE INSERT OR UPDATE OF perfil_id ON public.fiscal_regras
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_regra_perfil_confere();
DROP TRIGGER IF EXISTS fiscal_empresa_regras_perfil_trg ON public.fiscal_empresa_regras;
CREATE TRIGGER fiscal_empresa_regras_perfil_trg BEFORE INSERT OR UPDATE OF perfil_id, tenant_id ON public.fiscal_empresa_regras
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_regra_perfil_confere();

-- ===== 4. Sem acesso direto + trava do salão =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiscal_perfis', 'fiscal_regras', 'fiscal_empresa_regras', 'fiscal_empresa_ocultas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

-- ===== 5. Sugestão =====
-- Devolve a regra mais específica que vale para o NCM (e CEST, operação, UF de destino) na data, sem aplicar nada.
-- Precedência entre níveis: qualquer regra da empresa que case vence a global (mesmo menos específica); regra global ocultada pela
-- empresa é ignorada; dentro do mesmo nível vence a mais específica (NCM com mais dígitos, CEST, operação e regime, UF).
-- Empate real NÃO é desempatado: devolve as candidatas para a pessoa escolher.
-- Regime: o da empresa (simples, mei; o restante é normal, como crtDoRegime) ou o informado em p_regime.
-- Retorno: { status: regra | sem_regra | empate | ncm_invalido, regra: {id, versao, origem} | null,
--            candidatas: [...] (só no empate), perfil: {...} (só quando há regra; chaves em camelCase, sem nulos) }.
-- Qualquer pessoa da empresa (exceto o perfil restrito do salão): é referência de consulta, nunca grava.
CREATE OR REPLACE FUNCTION public.fiscal_sugerir(
  p_ncm text, p_cest text DEFAULT NULL, p_operacao text DEFAULT 'venda',
  p_data date DEFAULT NULL, p_uf_destino text DEFAULT NULL, p_regime text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_ncm text := regexp_replace(coalesce(p_ncm, ''), '[^0-9]', '', 'g');
  v_cest text := nullif(regexp_replace(coalesce(p_cest, ''), '[^0-9]', '', 'g'), '');
  v_op text := nullif(lower(btrim(coalesce(p_operacao, ''))), '');
  v_uf text := nullif(upper(btrim(coalesce(p_uf_destino, ''))), '');
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_regime text := nullif(lower(btrim(coalesce(p_regime, ''))), '');
  v_regime_empresa text;
  v_cand jsonb;
  v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF v_regime IS NOT NULL AND v_regime NOT IN ('normal', 'simples', 'mei') THEN
    RAISE EXCEPTION 'Regime inválido';
  END IF;
  IF length(v_ncm) <> 8 THEN
    RETURN jsonb_build_object('status', 'ncm_invalido', 'regra', NULL, 'candidatas', '[]'::jsonb, 'perfil', '{}'::jsonb);
  END IF;
  IF v_regime IS NULL THEN
    SELECT e.regime_tributario INTO v_regime_empresa FROM public.empresas e
     WHERE e.tenant_id = v_tenant ORDER BY e.created_at, e.id LIMIT 1;
    v_regime := CASE v_regime_empresa WHEN 'simples' THEN 'simples' WHEN 'mei' THEN 'mei' ELSE 'normal' END;
  END IF;

  WITH base AS (
    SELECT 'empresa'::text AS origem, r.id, r.perfil_id, r.ncm_prefixo, r.cest, r.operacao, r.regime, r.uf_destino,
           r.vigencia_inicio, r.vigencia_fim, r.versao, r.ativa
      FROM public.fiscal_empresa_regras r WHERE r.tenant_id = v_tenant
    UNION ALL
    SELECT 'global'::text, r.id, r.perfil_id, r.ncm_prefixo, r.cest, r.operacao, r.regime, r.uf_destino,
           r.vigencia_inicio, r.vigencia_fim, r.versao, r.ativa
      FROM public.fiscal_regras r
     WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_empresa_ocultas o WHERE o.tenant_id = v_tenant AND o.regra_id = r.id)
  ), casam AS (
    SELECT b.*, ARRAY[length(b.ncm_prefixo), (b.cest IS NOT NULL)::int,
                      (b.operacao IS NOT NULL)::int + (b.regime IS NOT NULL)::int, (b.uf_destino IS NOT NULL)::int] AS esp
      FROM base b
     WHERE b.ativa
       AND v_data >= b.vigencia_inicio AND (b.vigencia_fim IS NULL OR v_data <= b.vigencia_fim)
       AND left(v_ncm, length(b.ncm_prefixo)) = b.ncm_prefixo
       AND (b.cest IS NULL OR b.cest = v_cest)
       AND (b.operacao IS NULL OR b.operacao = v_op)
       AND (b.regime IS NULL OR b.regime = v_regime)
       AND (b.uf_destino IS NULL OR b.uf_destino = v_uf)
  ), nivel AS (
    SELECT c.origem FROM casam c ORDER BY (c.origem = 'empresa') DESC LIMIT 1
  ), topo AS (
    SELECT c.* FROM casam c
     WHERE c.origem = (SELECT origem FROM nivel)
       AND c.esp = (SELECT max(c2.esp) FROM casam c2 WHERE c2.origem = c.origem)
  )
  SELECT count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'versao', t.versao, 'origem', t.origem, 'ncmPrefixo', t.ncm_prefixo,
           'perfilId', p.id, 'perfilNome', p.nome,
           'perfil', jsonb_strip_nulls(jsonb_build_object(
             'cstIcms', p.cst_icms, 'csosn', p.csosn, 'cfop', p.cfop, 'aliqIcms', p.aliq_icms,
             'reducaoBaseIcms', p.reducao_base_icms, 'mvaSt', p.mva_st, 'cstPis', p.cst_pis, 'aliqPis', p.aliq_pis,
             'cstCofins', p.cst_cofins, 'aliqCofins', p.aliq_cofins, 'cstIbsCbs', p.cst_ibs_cbs,
             'cclasstrib', p.cclasstrib, 'origem', p.origem))) ORDER BY t.id), '[]'::jsonb)
    INTO v_n, v_cand
    FROM topo t JOIN public.fiscal_perfis p ON p.id = t.perfil_id;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('status', 'sem_regra', 'regra', NULL, 'candidatas', '[]'::jsonb, 'perfil', '{}'::jsonb);
  ELSIF v_n > 1 THEN
    RETURN jsonb_build_object('status', 'empate', 'regra', NULL, 'candidatas', v_cand, 'perfil', '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'status', 'regra',
    'regra', jsonb_build_object('id', v_cand -> 0 -> 'id', 'versao', v_cand -> 0 -> 'versao', 'origem', v_cand -> 0 -> 'origem'),
    'candidatas', '[]'::jsonb,
    'perfil', v_cand -> 0 -> 'perfil');
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_sugerir(text, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sugerir(text, text, text, date, text, text) TO authenticated;
