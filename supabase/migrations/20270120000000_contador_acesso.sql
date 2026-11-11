-- Acesso do contador: pessoa de fora da empresa que pega os XMLs das notas e, se a empresa permitir, ajusta
-- a parte tributária (ajustes de tributos aproximados e regras fiscais da empresa). Menor privilégio:
--   * o papel 'contador' é restrito: qualquer pessoa que o tenha (mesmo junto de outro papel) fica sem acesso
--     a toda tabela e função que não esteja numa lista liberada (mesma ideia do salão, mas com lista própria);
--   * o acesso vale para UMA empresa, concedido pelo administrador, revogável. Revogar mantém o papel e marca
--     o acesso como encerrado: a pessoa fica sem empresa e, portanto, sem ver nada (falha fechada);
--   * a leitura de notas é só das notas autorizadas ou canceladas da empresa autorizada, nunca escrita;
--   * a edição tributária é uma permissão à parte (pode_editar_tributos) e só pode ser dada quando a conta tem
--     UMA empresa, porque as regras fiscais e os ajustes são da conta inteira, não de cada CNPJ.

-- ===== 1. Acessos =====
CREATE TABLE IF NOT EXISTS public.contador_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  user_id uuid NOT NULL,
  pode_editar_tributos boolean NOT NULL DEFAULT false,
  concedido_por uuid NOT NULL,
  concedido_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  revogado_por uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS contador_acessos_ativo_idx ON public.contador_acessos (user_id) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS contador_acessos_tenant_idx ON public.contador_acessos (tenant_id, concedido_em DESC);
ALTER TABLE public.contador_acessos ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.contador_acessos TO authenticated;
GRANT ALL ON public.contador_acessos TO service_role;
DROP POLICY IF EXISTS contador_acessos_leitura ON public.contador_acessos;
CREATE POLICY contador_acessos_leitura ON public.contador_acessos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
DROP POLICY IF EXISTS salao_restrito ON public.contador_acessos;
CREATE POLICY salao_restrito ON public.contador_acessos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- ===== 2. Quem é o contador e o que ele pode =====
CREATE OR REPLACE FUNCTION public.eh_contador_restrito()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'contador')
$$;
REVOKE ALL ON FUNCTION public.eh_contador_restrito() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_contador_restrito() TO authenticated;

-- Empresa autorizada do contador logado; NULL se não é contador ou se o acesso foi revogado.
CREATE OR REPLACE FUNCTION public.contador_empresa_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.empresa_id
    FROM public.contador_acessos a
    JOIN public.profiles p ON p.id = a.user_id AND p.tenant_id = a.tenant_id AND p.empresa_id = a.empresa_id
    JOIN public.empresas e ON e.id = a.empresa_id AND e.tenant_id = a.tenant_id
   WHERE a.user_id = auth.uid() AND a.revogado_em IS NULL AND public.eh_contador_restrito()
$$;
REVOKE ALL ON FUNCTION public.contador_empresa_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contador_empresa_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.contador_edita_tributos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT a.pode_editar_tributos FROM public.contador_acessos a
                    WHERE a.user_id = auth.uid() AND a.revogado_em IS NULL
                      AND a.empresa_id = public.contador_empresa_id()), false)
     -- revalidado a cada chamada: se a conta passar a ter mais de uma empresa ativa, a edição fecha sozinha
     AND (SELECT count(*) FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND e.ativo) = 1
$$;
REVOKE ALL ON FUNCTION public.contador_edita_tributos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contador_edita_tributos() TO authenticated;

-- Trava das funções de uso geral: o contador não passa.
CREATE OR REPLACE FUNCTION public.exige_nao_contador()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.eh_contador_restrito() THEN
    RAISE EXCEPTION 'Seu perfil não tem acesso a esta operação';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.exige_nao_contador() FROM PUBLIC, anon, authenticated;

-- Trava das funções tributárias que o contador pode usar: só com acesso ativo e a permissão de editar.
CREATE OR REPLACE FUNCTION public.exige_contador_tributos()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.eh_contador_restrito() AND NOT public.contador_edita_tributos() THEN
    RAISE EXCEPTION 'Seu acesso de contador não permite alterar a parte tributária';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.exige_contador_tributos() FROM PUBLIC, anon, authenticated;

-- ===== 3. Tabelas =====
-- Liberadas ao contador (só leitura, sempre limitada à empresa autorizada): a sessão, as notas e a base de tributos aproximados.
CREATE OR REPLACE FUNCTION public._contador_travas_tabelas() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t text;
  liberadas constant text[] := ARRAY['profiles', 'user_roles', 'empresas', 'filiais', 'tenants', 'nfe', 'nfe_itens',
                                     'tributos_aprox_ncm', 'tributos_aprox_ajuste'];
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT (c.relname = ANY (liberadas))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS contador_restrito ON public.%I', t);
    EXECUTE format($f$CREATE POLICY contador_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT NOT public.eh_contador_restrito()))$f$, t);
  END LOOP;
  FOREACH t IN ARRAY liberadas LOOP
    -- escrita: nunca direta (os ajustes e os acessos passam pelas funções)
    EXECUTE format('DROP POLICY IF EXISTS contador_sem_escrita_i ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS contador_sem_escrita_u ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS contador_sem_escrita_d ON public.%I', t);
    EXECUTE format('CREATE POLICY contador_sem_escrita_i ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT NOT public.eh_contador_restrito()))', t);
    EXECUTE format('CREATE POLICY contador_sem_escrita_u ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT NOT public.eh_contador_restrito()))', t);
    EXECUTE format('CREATE POLICY contador_sem_escrita_d ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT NOT public.eh_contador_restrito()))', t);
  END LOOP;
END $$;
SELECT public._contador_travas_tabelas();

-- leitura limitada à empresa autorizada (sem acesso ativo, contador_empresa_id() é NULL e nada passa)
DROP POLICY IF EXISTS contador_leitura ON public.profiles;
CREATE POLICY contador_leitura ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR id = auth.uid());
DROP POLICY IF EXISTS contador_leitura ON public.user_roles;
CREATE POLICY contador_leitura ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR user_id = auth.uid());
DROP POLICY IF EXISTS contador_leitura ON public.empresas;
CREATE POLICY contador_leitura ON public.empresas AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR id = (SELECT public.contador_empresa_id()));
DROP POLICY IF EXISTS contador_leitura ON public.filiais;
CREATE POLICY contador_leitura ON public.filiais AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR empresa_id = (SELECT public.contador_empresa_id()));
DROP POLICY IF EXISTS contador_leitura ON public.tenants;
CREATE POLICY contador_leitura ON public.tenants AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR (SELECT public.contador_empresa_id()) IS NOT NULL);
DROP POLICY IF EXISTS contador_leitura ON public.nfe;
CREATE POLICY contador_leitura ON public.nfe AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito())
         OR (empresa_id = (SELECT public.contador_empresa_id()) AND situacao IN ('autorizada', 'cancelada')));
DROP POLICY IF EXISTS contador_leitura ON public.nfe_itens;
CREATE POLICY contador_leitura ON public.nfe_itens AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito())
         OR EXISTS (SELECT 1 FROM public.nfe n WHERE n.id = nfe_itens.nfe_id
                       AND n.empresa_id = (SELECT public.contador_empresa_id()) AND n.situacao IN ('autorizada', 'cancelada')));
DROP POLICY IF EXISTS contador_leitura ON public.tributos_aprox_ncm;
CREATE POLICY contador_leitura ON public.tributos_aprox_ncm AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR (SELECT public.contador_edita_tributos()));
DROP POLICY IF EXISTS contador_leitura ON public.tributos_aprox_ajuste;
CREATE POLICY contador_leitura ON public.tributos_aprox_ajuste AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()) OR (SELECT public.contador_edita_tributos()));

-- Arquivos: o contador não lê nem grava nada no armazenamento (fotos, anexos, logos). Os XMLs não ficam aqui.
DROP POLICY IF EXISTS contador_restrito ON storage.objects;
CREATE POLICY contador_restrito ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));

-- ===== 4. Funções =====
-- Trava de contador em toda função SECURITY DEFINER chamável, menos as de sessão e as tributárias liberadas
-- (estas recebem a trava própria exige_contador_tributos logo abaixo).
CREATE OR REPLACE FUNCTION public._contador_travas_funcoes() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  f record;
  def text;
  novo text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, l.lanname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public' AND p.prosecdef
       AND pg_get_function_result(p.oid) <> 'trigger'
       AND has_function_privilege('authenticated', p.oid, 'execute')
       AND p.proname NOT IN ('current_tenant_id', 'current_motorista_id', 'has_role', 'eh_motorista_restrito',
                             'eh_saas_operador', 'eh_salao_restrito', 'onboarding_criar_espaco',
                             'eh_contador_restrito', 'contador_empresa_id', 'contador_edita_tributos', 'contador_meu_acesso',
                             'filial_irrestrita', 'pode_filial', 'eh_profissional_restrito',
                             'fiscal_empresa_globais', 'fiscal_empresa_minhas', 'fiscal_empresa_ocultar',
                             'fiscal_empresa_perfis', 'fiscal_empresa_reexibir', 'fiscal_empresa_regra_encerrar',
                             'fiscal_empresa_regra_salvar', 'fiscal_sugerir', 'fiscal_sugerir_lote',
                             'tributos_aprox_ajustar', 'tributos_aprox_ajuste_remover')
  LOOP
    def := pg_get_functiondef(f.oid);
    CONTINUE WHEN def LIKE '%exige_nao_contador%';
    IF f.lanname = 'plpgsql' THEN
      -- primeiro BEGIN do corpo (a função pode estar em uma linha só)
      novo := regexp_replace(def, E'(AS \\$function\\$.*?\\yBEGIN\\y)', E'\\1 PERFORM public.exige_nao_contador();', 'is');
    ELSIF f.lanname = 'sql' THEN
      novo := regexp_replace(def, E'(AS \\$function\\$)', E'\\1\n  SELECT public.exige_nao_contador();', 'i');
    ELSE
      RAISE EXCEPTION 'Linguagem não tratada em %: %', f.proname, f.lanname;
    END IF;
    IF novo = def THEN
      RAISE EXCEPTION 'Não foi possível inserir a trava do contador em %', f.proname;
    END IF;
    EXECUTE novo;
  END LOOP;
END $$;
SELECT public._contador_travas_funcoes();

-- Funções tributárias liberadas: o contador só passa com a permissão de editar tributos; quem não é contador
-- segue com a regra de papel que já tinha.
DO $$
DECLARE
  f record;
  def text;
  novo text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND p.proname IN ('fiscal_empresa_globais', 'fiscal_empresa_minhas', 'fiscal_empresa_ocultar',
                         'fiscal_empresa_perfis', 'fiscal_empresa_reexibir', 'fiscal_empresa_regra_encerrar',
                         'fiscal_empresa_regra_salvar', 'fiscal_sugerir', 'fiscal_sugerir_lote',
                         'tributos_aprox_ajustar', 'tributos_aprox_ajuste_remover')
  LOOP
    def := pg_get_functiondef(f.oid);
    CONTINUE WHEN def LIKE '%exige_contador_tributos%';
    novo := replace(def, 'PERFORM public.exige_nao_salao();', E'PERFORM public.exige_nao_salao();\n  PERFORM public.exige_contador_tributos();');
    IF novo = def THEN
      RAISE EXCEPTION 'Não foi possível inserir a trava do contador em %', f.proname;
    END IF;
    -- a regra de papel original não vale para o contador: a trava acima já exigiu a permissão dele
    novo := replace(novo, E'PERFORM public.exige_papel(ARRAY[''administrador'', ''gestor'']);',
                    E'IF NOT public.eh_contador_restrito() THEN PERFORM public.exige_papel(ARRAY[''administrador'', ''gestor'']); END IF;');
    novo := replace(novo, E'IF NOT (public.has_role(auth.uid(), ''administrador'') OR public.has_role(auth.uid(), ''gestor'')\n          OR public.has_role(auth.uid(), ''financeiro'')) THEN',
                    E'IF NOT (public.has_role(auth.uid(), ''administrador'') OR public.has_role(auth.uid(), ''gestor'')\n          OR public.has_role(auth.uid(), ''financeiro'') OR public.eh_contador_restrito()) THEN');
    EXECUTE novo;
  END LOOP;
END $$;

-- Reaplicável: as tabelas e funções criadas depois (as migrations do drizzle rodam depois destas) recebem a trava
-- quando drizzle/migrations/0087 chama estas duas funções de novo. O CI reprova o que ficar sem a trava.
REVOKE ALL ON FUNCTION public._contador_travas_tabelas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._contador_travas_funcoes() FROM PUBLIC, anon, authenticated;

-- ===== 5. Conceder, revogar e consultar =====
CREATE OR REPLACE FUNCTION public.contador_conceder(p_user uuid, p_empresa uuid, p_edita_tributos boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_perfil public.profiles%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  IF NOT public.has_role(auth.uid(), 'administrador') THEN
    RAISE EXCEPTION 'Somente o administrador libera o acesso do contador';
  END IF;
  IF p_user IS NULL OR p_empresa IS NULL THEN RAISE EXCEPTION 'Informe a pessoa e a empresa'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Você não pode se dar o acesso de contador'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = p_empresa AND e.tenant_id = v_tenant AND e.ativo) THEN
    RAISE EXCEPTION 'Empresa não encontrada';
  END IF;
  SELECT * INTO v_perfil FROM public.profiles WHERE id = p_user AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada'; END IF;
  -- a conta de quem já trabalha na empresa não vira contador: o acesso externo nasce numa conta própria
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user AND r.role <> 'contador') THEN
    RAISE EXCEPTION 'Esta pessoa já tem outro perfil na empresa; use uma conta própria para o contador';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contador_acessos a WHERE a.user_id = p_user AND a.revogado_em IS NULL) THEN
    RAISE EXCEPTION 'Esta pessoa já tem acesso de contador ativo; revogue antes de mudar a empresa';
  END IF;
  IF coalesce(p_edita_tributos, false)
     AND (SELECT count(*) FROM public.empresas e WHERE e.tenant_id = v_tenant AND e.ativo) > 1 THEN
    RAISE EXCEPTION 'A edição tributária vale para a conta inteira: com mais de uma empresa, libere só o acesso aos XMLs';
  END IF;

  UPDATE public.profiles SET empresa_id = p_empresa, filial_id = NULL WHERE id = p_user;
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (p_user, v_tenant, 'contador')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.contador_acessos (tenant_id, empresa_id, user_id, pode_editar_tributos, concedido_por)
  VALUES (v_tenant, p_empresa, p_user, coalesce(p_edita_tributos, false), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (v_tenant, auth.uid(), 'contador_acessos', v_id, 'insert', NULL,
          jsonb_build_object('user_id', p_user, 'empresa_id', p_empresa, 'pode_editar_tributos', coalesce(p_edita_tributos, false)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.contador_revogar(p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_acesso public.contador_acessos%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  IF NOT public.has_role(auth.uid(), 'administrador') THEN
    RAISE EXCEPTION 'Somente o administrador revoga o acesso do contador';
  END IF;
  SELECT * INTO v_acesso FROM public.contador_acessos
   WHERE user_id = p_user AND tenant_id = v_tenant AND revogado_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acesso de contador não encontrado'; END IF;
  -- o papel fica (a pessoa continua restrita e sem empresa autorizada, então não enxerga nada)
  UPDATE public.contador_acessos SET revogado_em = now(), revogado_por = auth.uid() WHERE id = v_acesso.id;
  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (v_tenant, auth.uid(), 'contador_acessos', v_acesso.id, 'update',
          jsonb_build_object('user_id', p_user, 'empresa_id', v_acesso.empresa_id, 'pode_editar_tributos', v_acesso.pode_editar_tributos),
          jsonb_build_object('revogado', true));
END $$;

-- Lista dos acessos da conta (administrador e gestor).
CREATE OR REPLACE FUNCTION public.contador_acessos_listar()
RETURNS TABLE (id uuid, user_id uuid, nome text, email text, empresa_id uuid, empresa_nome text,
               pode_editar_tributos boolean, concedido_em timestamptz, revogado_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')) THEN
    RAISE EXCEPTION 'Somente administrador ou gestor vê os acessos de contador';
  END IF;
  RETURN QUERY
    SELECT a.id, a.user_id, p.nome, p.email, a.empresa_id, coalesce(e.nome_fantasia, e.razao_social),
           a.pode_editar_tributos, a.concedido_em, a.revogado_em
      FROM public.contador_acessos a
      LEFT JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN public.empresas e ON e.id = a.empresa_id
     WHERE a.tenant_id = public.current_tenant_id()
     ORDER BY a.concedido_em DESC;
END $$;

-- O contador consulta o próprio acesso (empresa, permissão); sem acesso ativo devolve vazio.
CREATE OR REPLACE FUNCTION public.contador_meu_acesso()
RETURNS TABLE (empresa_id uuid, empresa_nome text, cnpj text, pode_editar_tributos boolean, concedido_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT a.empresa_id, coalesce(e.nome_fantasia, e.razao_social), e.cnpj, a.pode_editar_tributos, a.concedido_em
      FROM public.contador_acessos a JOIN public.empresas e ON e.id = a.empresa_id
     WHERE a.user_id = auth.uid() AND a.revogado_em IS NULL AND a.empresa_id = public.contador_empresa_id();
END $$;

REVOKE ALL ON FUNCTION public.contador_conceder(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contador_revogar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contador_acessos_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contador_meu_acesso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contador_conceder(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contador_revogar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contador_acessos_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.contador_meu_acesso() TO authenticated;
