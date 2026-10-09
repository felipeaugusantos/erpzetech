-- Endurecimento de segurança: SECURITY DEFINER e RLS
-- Migration aditiva; não altera migrations anteriores.

-- =====================================================================
-- 1. CRÍTICO: cadastro público não pode virar administrador de um tenant existente
--    Antes: todo novo usuário entrava no primeiro tenant como 'administrador'.
--    Agora: o perfil nasce SEM tenant e SEM papel (falha fechada). Os fluxos de
--    provisionamento (cliente-admin, usuario-admin, motorista-login) já fazem upsert
--    do perfil e dos papéis com service role, então continuam funcionando.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, tenant_id, empresa_id, filial_id, nome, email)
  VALUES (
    NEW.id, NULL, NULL, NULL,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Para revisar contas que já entraram no primeiro tenant por esse caminho (NÃO removidas aqui):
--   SELECT u.email, u.created_at, r.role
--   FROM public.user_roles r
--   JOIN auth.users u ON u.id = r.user_id
--   WHERE r.tenant_id = (SELECT id FROM public.tenants ORDER BY created_at LIMIT 1)
--   ORDER BY u.created_at;

-- =====================================================================
-- 2. recalcular_*: só no tenant do usuário (chamadas sem sessão, como service role, seguem permitidas)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.recalcular_orcamento(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub numeric;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO v_sub FROM public.orcamento_itens WHERE orcamento_id = p_id;
  UPDATE public.orcamentos
     SET subtotal = v_sub, total = GREATEST(0, v_sub - desconto + frete)
   WHERE id = p_id
     AND (auth.uid() IS NULL OR tenant_id = public.current_tenant_id());
END; $$;

CREATE OR REPLACE FUNCTION public.recalcular_pedido(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub numeric;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO v_sub FROM public.pedido_itens WHERE pedido_id = p_id;
  UPDATE public.pedidos
     SET subtotal = v_sub, total = GREATEST(0, v_sub - desconto + frete)
   WHERE id = p_id
     AND (auth.uid() IS NULL OR tenant_id = public.current_tenant_id());
END; $$;

CREATE OR REPLACE FUNCTION public.recalcular_compra(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub numeric;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO v_sub FROM public.compra_itens WHERE compra_id = p_id;
  UPDATE public.compras
     SET subtotal = v_sub, total = GREATEST(0, v_sub - desconto + frete)
   WHERE id = p_id
     AND (auth.uid() IS NULL OR tenant_id = public.current_tenant_id());
END; $$;

-- =====================================================================
-- 3. banco_conta_padrao: auxiliar de triggers; não deve ser chamável pela API
--    (devolvia o id da conta bancária de qualquer tenant informado)
-- =====================================================================
REVOKE ALL ON FUNCTION public.banco_conta_padrao(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 4. user_roles: o usuário que recebe o papel precisa pertencer ao tenant do administrador
-- =====================================================================
DROP POLICY IF EXISTS roles_admin_insert ON public.user_roles;
DROP POLICY IF EXISTS roles_admin_update ON public.user_roles;

CREATE POLICY roles_admin_insert ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'administrador')
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = user_roles.user_id AND p.tenant_id = public.current_tenant_id())
  );

CREATE POLICY roles_admin_update ON public.user_roles
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = user_roles.user_id AND p.tenant_id = public.current_tenant_id())
  );

-- =====================================================================
-- 5. Escrita direta em estoque e caixa: apenas pelas RPCs (SECURITY DEFINER ignoram RLS)
--    Movimentações e lançamentos de caixa não têm escrita direta no cliente.
--    Saldos/custos em 'estoques' ficam restritos a papéis de gestão de estoque.
-- =====================================================================
DROP POLICY IF EXISTS mov_insert ON public.estoque_movimentacoes;
DROP POLICY IF EXISTS caixa_movimentos_insert ON public.caixa_movimentos;

DROP POLICY IF EXISTS tenant_insert_estoques ON public.estoques;
DROP POLICY IF EXISTS tenant_update_estoques ON public.estoques;

CREATE POLICY tenant_insert_estoques ON public.estoques
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_role(auth.uid(), 'estoquista') OR public.has_role(auth.uid(), 'comprador'))
  );

CREATE POLICY tenant_update_estoques ON public.estoques
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_role(auth.uid(), 'estoquista') OR public.has_role(auth.uid(), 'comprador'))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

-- =====================================================================
-- 6. Privilégios de execução: anon fora de tudo, inclusive de funções futuras
-- =====================================================================
REVOKE ALL ON FUNCTION public.saas_custo_por_tecnico(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assistencia_ordens_relatorio(date, date, uuid) FROM PUBLIC, anon;

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, pg_get_function_result(p.oid) AS ret
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.ret = 'trigger' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.sig);
    END IF;
  END LOOP;
END;
$$;

-- Funções criadas daqui em diante não nascem executáveis por anon/PUBLIC.
-- Quem precisar expor uma função deve conceder o EXECUTE explicitamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
