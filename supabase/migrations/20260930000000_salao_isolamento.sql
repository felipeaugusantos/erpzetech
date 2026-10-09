-- Isolamento dos perfis do salão (garçom e cozinha).
--
-- Até aqui as políticas das tabelas valiam para qualquer usuário da empresa, então um garçom ou cozinheiro
-- leria clientes, produtos, financeiro e fiscal, e poderia chamar as funções de venda, caixa e relatórios.
-- Esta migration fecha as duas portas, no estilo do motorista restrito, mas sem lista de exceções por tabela:
--   1. política RESTRITIVA em toda tabela com RLS: o perfil restrito só enxerga o que está numa lista liberada;
--   2. trava no início de toda função SECURITY DEFINER que o usuário pode chamar.
-- O smoke.sql falha se surgir tabela ou função nova sem a proteção.

-- Perfil restrito: tem garçom e/ou cozinha e nenhum outro papel na empresa. Quem acumula outro papel
-- (caixa, gestor, vendedor...) segue com o acesso desse papel.
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
            WHERE r.user_id = auth.uid() AND r.role IN ('garcom', 'cozinha'))
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles r
             JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = r.tenant_id
            WHERE r.user_id = auth.uid() AND r.role NOT IN ('garcom', 'cozinha'))
$$;

REVOKE ALL ON FUNCTION public.eh_salao_restrito() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_salao_restrito() TO authenticated;

-- Trava usada dentro das funções (executam como o dono, então o usuário não precisa de EXECUTE aqui).
CREATE OR REPLACE FUNCTION public.exige_nao_salao()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.eh_salao_restrito() THEN
    RAISE EXCEPTION 'Seu perfil não tem acesso a esta operação';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.exige_nao_salao() FROM PUBLIC, anon, authenticated;

-- ===== 1. Tabelas =====
-- Liberadas ao perfil do salão: a sessão (perfil, papéis, empresa, filiais), o cardápio, as mesas e as comandas.
DO $$
DECLARE
  t text;
  liberadas constant text[] := ARRAY[
    'profiles', 'user_roles', 'empresas', 'filiais', 'tenants',
    'cardapio_categorias', 'cardapio_itens', 'cardapio_grupos', 'cardapio_opcoes',
    'mesas', 'comandas', 'comanda_itens', 'comanda_pagamentos'];
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT (c.relname = ANY (liberadas))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format($f$CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT NOT public.eh_salao_restrito()))$f$, t);
  END LOOP;
END $$;

-- ===== 2. Funções =====
-- Insere a trava na primeira linha de cada função SECURITY DEFINER chamável pelo usuário. As do restaurante
-- já conferem o próprio perfil; as auxiliares de permissão não podem se travar.
DO $$
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
       AND p.proname NOT LIKE 'restaurante\_%'
       AND p.proname NOT IN ('current_tenant_id', 'current_motorista_id', 'has_role', 'eh_motorista_restrito',
                             'eh_saas_operador', 'eh_salao_restrito', 'onboarding_criar_espaco')
  LOOP
    def := pg_get_functiondef(f.oid);
    CONTINUE WHEN def LIKE '%exige_nao_salao%';
    IF f.lanname = 'plpgsql' THEN
      novo := regexp_replace(def, E'(\\n[ \\t]*BEGIN)[ \\t]*\\n', E'\\1\n  PERFORM public.exige_nao_salao();\n', 'i');
    ELSIF f.lanname = 'sql' THEN
      -- função SQL com vários comandos devolve o resultado do último
      novo := regexp_replace(def, E'(AS \\$function\\$)', E'\\1\n  SELECT public.exige_nao_salao();', 'i');
    ELSE
      RAISE EXCEPTION 'Linguagem não tratada em %: %', f.proname, f.lanname;
    END IF;
    IF novo = def THEN
      RAISE EXCEPTION 'Não foi possível inserir a trava em %', f.proname;
    END IF;
    EXECUTE novo;
  END LOOP;
END $$;

-- Receber a conta é do caixa e da gestão (a tela já era assim): o garçom não fecha comanda nem lança no caixa.
-- Sem isso, o perfil do salão chegaria às funções de caixa por dentro de restaurante_fechar_comanda.
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_fechar_comanda(uuid, jsonb, uuid, numeric, boolean)'::regprocedure);
  novo text;
BEGIN
  novo := replace(def, $q$ARRAY['administrador', 'gestor', 'garcom', 'caixa']$q$, $q$ARRAY['administrador', 'gestor', 'caixa']$q$);
  IF novo = def THEN
    RAISE EXCEPTION 'Não foi possível restringir restaurante_fechar_comanda a gestão e caixa';
  END IF;
  EXECUTE novo;
END $$;

-- Item de categoria desativada não pode ser lançado (a tela já o esconde do cardápio).
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_lancar_item(uuid, uuid, numeric, uuid[], text)'::regprocedure);
  novo text;
BEGIN
  novo := replace(def, 'WHERE id = p_cardapio_item_id AND tenant_id = v_tenant AND ativo;',
    $q$WHERE id = p_cardapio_item_id AND tenant_id = v_tenant AND ativo
     AND (categoria_id IS NULL
          OR EXISTS (SELECT 1 FROM public.cardapio_categorias cc WHERE cc.id = categoria_id AND cc.ativo));$q$);
  IF novo = def THEN
    RAISE EXCEPTION 'Não foi possível filtrar categoria inativa em restaurante_lancar_item';
  END IF;
  EXECUTE novo;
END $$;
