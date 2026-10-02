-- Políticas de caixas e auditoria.
--
-- caixas: antes, "for all" para qualquer usuário do tenant (inclusive motorista). Nenhuma tela grava
--   em caixas direto: abertura, fechamento e lançamentos passam por RPCs SECURITY DEFINER
--   (abrir_caixa, fechar_caixa, frente_abrir_caixa, caixa_lancar), que ignoram a RLS.
--   Agora: só leitura pelo tenant (exceto motorista restrito) e nenhuma escrita direta.
-- caixa_movimentos: leitura também fora do alcance do motorista restrito (a escrita direta já foi
--   removida na migration 20260925000000).
-- auditoria: registro de auditoria é imutável e só deve ser lido por administrador e gestor.
--   Nenhuma tela ou função grava nela direto hoje.

-- ===== caixas =====
DROP POLICY IF EXISTS caixas_tenant ON public.caixas;
DROP POLICY IF EXISTS caixas_select ON public.caixas;

CREATE POLICY caixas_select ON public.caixas
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND NOT public.eh_motorista_restrito());

REVOKE INSERT, UPDATE, DELETE ON public.caixas FROM authenticated;

-- ===== caixa_movimentos =====
DROP POLICY IF EXISTS caixa_movimentos_read ON public.caixa_movimentos;

CREATE POLICY caixa_movimentos_read ON public.caixa_movimentos
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND NOT public.eh_motorista_restrito());

REVOKE INSERT, UPDATE, DELETE ON public.caixa_movimentos FROM authenticated;

-- ===== auditoria =====
DROP POLICY IF EXISTS audit_read ON public.auditoria;
DROP POLICY IF EXISTS audit_insert ON public.auditoria;

CREATE POLICY audit_read ON public.auditoria
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
  );

REVOKE INSERT, UPDATE, DELETE ON public.auditoria FROM authenticated;
