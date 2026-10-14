-- Atendimento de obra: romaneio por entrega e histórico da obra.
--
-- As tabelas pedido_ocorrencias e entrega_reagendamentos (drizzle 0017) já filtram o perfil do salão na
-- própria política de leitura; aqui entra também a política restritiva padrão, que o smoke.sql exige de toda
-- tabela com RLS fora da lista liberada.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedido_ocorrencias', 'entrega_reagendamentos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format($f$CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT NOT public.eh_salao_restrito()))$f$, t);
  END LOOP;
END $$;

-- pedido_registrar_entrega é só um atalho para pedido_registrar_saida; sem a trava e sem fechar a porta do
-- anon ela seria a única função de atendimento fora do padrão.
CREATE OR REPLACE FUNCTION public.pedido_registrar_entrega(
  p_pedido_id uuid, p_itens jsonb, p_recebedor text DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.exige_nao_salao();
  SELECT public.pedido_registrar_saida(p_pedido_id, p_itens, 'entrega', p_recebedor, p_observacao, NULL)
$$;

REVOKE ALL ON FUNCTION public.pedido_registrar_entrega(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_registrar_entrega(uuid, jsonb, text, text) TO authenticated;
