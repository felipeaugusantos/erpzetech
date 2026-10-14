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

-- Cada insucesso de entrega fica guardado: reagendar muda a mesma linha de volta para "planejada" e o motivo
-- da tentativa que falhou se perderia. O histórico da obra lê desta tabela.
CREATE TABLE IF NOT EXISTS public.entrega_tentativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  entrega_id uuid NOT NULL REFERENCES public.entregas(id) ON DELETE CASCADE,
  motivo text,
  observacao text,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entrega_tentativas_entrega_idx ON public.entrega_tentativas (entrega_id);
GRANT SELECT ON public.entrega_tentativas TO authenticated;
GRANT ALL ON public.entrega_tentativas TO service_role;
ALTER TABLE public.entrega_tentativas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entrega_tentativas_read ON public.entrega_tentativas;
CREATE POLICY entrega_tentativas_read ON public.entrega_tentativas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS salao_restrito ON public.entrega_tentativas;
CREATE POLICY salao_restrito ON public.entrega_tentativas AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.entrega_registrar_tentativa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.entrega_tentativas (tenant_id, entrega_id, motivo, observacao, usuario_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.motivo_insucesso, NEW.observacao, auth.uid());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.entrega_registrar_tentativa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS entrega_tentativa_trg ON public.entregas;
CREATE TRIGGER entrega_tentativa_trg AFTER UPDATE OF situacao ON public.entregas
  FOR EACH ROW WHEN (NEW.situacao = 'insucesso' AND OLD.situacao IS DISTINCT FROM 'insucesso')
  EXECUTE FUNCTION public.entrega_registrar_tentativa();

-- o que já deu errado antes desta migration entra com a data registrada na entrega
INSERT INTO public.entrega_tentativas (tenant_id, entrega_id, motivo, observacao, created_at)
SELECT e.tenant_id, e.id, e.motivo_insucesso, e.observacao, e.data_entrega
  FROM public.entregas e
 WHERE e.situacao = 'insucesso'
   AND NOT EXISTS (SELECT 1 FROM public.entrega_tentativas t WHERE t.entrega_id = e.id);