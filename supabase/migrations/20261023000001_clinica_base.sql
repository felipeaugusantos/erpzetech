-- Clínica veterinária (Fase 3, PR 1): base. O veterinário entra com a conta ligada ao cadastro do profissional (com CRMV), no mesmo
-- isolamento do profissional do pet shop: não lê nada da loja nem do restaurante. A leitura do que a clínica precisa (pets, agenda)
-- e o texto clínico chegam no PR 2, só para o perfil veterinário. Serviços ganham as categorias de consulta, vacina e exame.

-- ============ isolamento: veterinário entra na lista dos perfis restritos ============
CREATE OR REPLACE FUNCTION public.eh_salao_restrito()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role IN ('garcom', 'cozinha', 'profissional', 'veterinario'))
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role NOT IN ('garcom', 'cozinha', 'profissional', 'veterinario'))
$$;

-- Só profissional e/ou veterinário (sem garçom nem cozinha): ficam de fora também das telas do salão que o garçom enxerga.
CREATE OR REPLACE FUNCTION public.eh_profissional_restrito()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role IN ('profissional', 'veterinario'))
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role NOT IN ('profissional', 'veterinario'))
$$;

-- ============ CRMV no cadastro do profissional ============
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS crmv text;
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS crmv_uf text;
ALTER TABLE public.pet_profissionais DROP CONSTRAINT IF EXISTS pet_profissionais_crmv_chk;
ALTER TABLE public.pet_profissionais ADD CONSTRAINT pet_profissionais_crmv_chk CHECK (
  (crmv IS NULL AND crmv_uf IS NULL)
  OR (crmv IS NOT NULL AND crmv_uf IS NOT NULL AND crmv ~ '^[0-9A-Z]{3,12}$' AND crmv_uf ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$')
);

-- Veterinário exige CRMV e UF; os demais não guardam CRMV. A conta ligada precisa combinar com a função
-- (veterinário ↔ perfil Veterinário; os outros ↔ perfil Profissional).
CREATE OR REPLACE FUNCTION public.pet_profissional_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_funcao text := coalesce(nullif(p_dados ->> 'funcao', ''), 'tosador');
  v_com numeric := coalesce(nullif(p_dados ->> 'comissao_percentual', '')::numeric, 0);
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_crmv text := upper(regexp_replace(coalesce(p_dados ->> 'crmv', ''), '[^0-9A-Za-z]', '', 'g'));
  v_uf text := upper(btrim(coalesce(p_dados ->> 'crmv_uf', '')));
  v_profile uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do profissional'; END IF;
  IF v_funcao NOT IN ('banhista', 'tosador', 'groomer', 'veterinario', 'auxiliar', 'outro') THEN RAISE EXCEPTION 'Função inválida'; END IF;
  IF v_com < 0 OR v_com > 100 THEN RAISE EXCEPTION 'A comissão precisa ficar entre 0 e 100%%'; END IF;
  IF v_filial IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filiais f WHERE f.id = v_filial AND f.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  IF v_funcao = 'veterinario' THEN
    IF v_crmv !~ '^[0-9A-Z]{3,12}$' THEN RAISE EXCEPTION 'Informe o CRMV do veterinário'; END IF;
    IF v_uf !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$' THEN
      RAISE EXCEPTION 'Informe a UF do CRMV';
    END IF;
  ELSE
    v_crmv := NULL; v_uf := NULL;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_profissionais (tenant_id, filial_id, nome, funcao, comissao_percentual, ativo, crmv, crmv_uf)
    VALUES (v_tenant, v_filial, v_nome, v_funcao, v_com, coalesce((p_dados ->> 'ativo')::boolean, true), v_crmv, v_uf)
    RETURNING id INTO v_id;
  ELSE
    SELECT profile_id INTO v_profile FROM public.pet_profissionais WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
    -- mudar a função com a conta ligada deixaria o acesso com o perfil errado: a gestão desfaz o vínculo antes
    IF v_profile IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.user_roles r WHERE r.user_id = v_profile AND r.tenant_id = v_tenant
            AND r.role = (CASE WHEN v_funcao = 'veterinario' THEN 'veterinario' ELSE 'profissional' END)::public.app_role) THEN
      RAISE EXCEPTION 'A conta ligada não tem o perfil desta função: desfaça o vínculo da conta antes de mudar a função';
    END IF;
    UPDATE public.pet_profissionais SET filial_id = v_filial, nome = v_nome, funcao = v_funcao, comissao_percentual = v_com,
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true), crmv = v_crmv, crmv_uf = v_uf
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_profissional_vincular(p_profissional_id uuid, p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_funcao text;
  v_papel public.app_role;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  SELECT funcao INTO v_funcao FROM public.pet_profissionais WHERE id = p_profissional_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  v_papel := (CASE WHEN v_funcao = 'veterinario' THEN 'veterinario' ELSE 'profissional' END)::public.app_role;
  IF p_profile_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.tenant_id = p.tenant_id AND r.role = v_papel
     WHERE p.id = p_profile_id AND p.tenant_id = v_tenant AND p.ativo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escolha um usuário ativo desta empresa com o perfil %', CASE WHEN v_papel = 'veterinario' THEN 'Veterinário' ELSE 'Profissional' END;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pet_profissionais x WHERE x.profile_id = p_profile_id AND x.id <> p_profissional_id) THEN
      RAISE EXCEPTION 'Este usuário já está ligado a outro profissional';
    END IF;
  END IF;
  UPDATE public.pet_profissionais SET profile_id = p_profile_id WHERE id = p_profissional_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_vincular(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_vincular(uuid, uuid) TO authenticated;

-- ============ a agenda própria vale também para o veterinário ============
DO $$
DECLARE
  f text;
  def text;
  nova text;
BEGIN
  FOREACH f IN ARRAY ARRAY['pet_minha_agenda', 'pet_minha_situacao'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF def IS NULL THEN RAISE EXCEPTION '% não encontrada', f; END IF;
    IF position('''veterinario''' IN def) > 0 THEN CONTINUE; END IF;
    nova := replace(def, 'ARRAY[''profissional'']', 'ARRAY[''profissional'', ''veterinario'']');
    IF nova = def THEN RAISE EXCEPTION '%: trecho esperado não encontrado', f; END IF;
    EXECUTE nova;
  END LOOP;
END $$;

-- ============ categorias de serviço da clínica ============
ALTER TABLE public.pet_servicos DROP CONSTRAINT IF EXISTS pet_servicos_categoria_check;
ALTER TABLE public.pet_servicos ADD CONSTRAINT pet_servicos_categoria_check
  CHECK (categoria IN ('banho', 'tosa', 'estetica', 'consulta', 'vacina', 'exame', 'outro'));

DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_servico_salvar';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_servico_salvar não encontrada'; END IF;
  IF position('''consulta''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, '(''banho'', ''tosa'', ''estetica'', ''outro'')', '(''banho'', ''tosa'', ''estetica'', ''consulta'', ''vacina'', ''exame'', ''outro'')');
  IF nova = def THEN RAISE EXCEPTION 'pet_servico_salvar: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;
