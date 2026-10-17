-- Achado da revisão do PR do botão de NFC-e: cancelar a venda de balcão deixava a NFC-e ativa.
-- Agora, no mesmo cancelamento (uma transação):
--   NFC-e em rascunho (ainda sem número) é apagada;
--   NFC-e pronta ou rejeitada (nunca autorizada) fica cancelada, com o motivo (o número usado entra depois na inutilização);
--   NFC-e já enviada à Sefaz (transmitida, autorizada ou em contingência) impede o cancelamento da venda: a nota é
--   cancelada primeiro, no próprio fluxo fiscal.
DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.frente_cancelar_venda(uuid, uuid, text)'::regprocedure);
  novo := replace(def,
    $q$v_gestor := public.consumir_autorizacao(p_autorizacao, 'cancelar_venda');$q$,
    $q$v_gestor := public.consumir_autorizacao(p_autorizacao, 'cancelar_venda');
  IF EXISTS (SELECT 1 FROM public.nfe n JOIN public.nfe_pedidos np ON np.nfe_id = n.id
              WHERE np.pedido_id = p_pedido_id AND n.modelo = 'nfce'
                AND n.situacao IN ('transmitida', 'autorizada', 'contingencia')) THEN
    RAISE EXCEPTION 'Esta venda tem NFC-e enviada à Sefaz. Cancele a nota fiscal antes de cancelar a venda';
  END IF;
  DELETE FROM public.nfe WHERE modelo = 'nfce' AND situacao = 'rascunho'
     AND id IN (SELECT nfe_id FROM public.nfe_pedidos WHERE pedido_id = p_pedido_id);
  UPDATE public.nfe SET situacao = 'cancelada', cancelada_em = now(),
         motivo_cancelamento = 'Venda cancelada antes da transmissão',
         mensagem = 'NFC-e cancelada porque a venda foi cancelada antes de ser transmitida.'
   WHERE modelo = 'nfce' AND situacao IN ('pronta', 'rejeitada')
     AND id IN (SELECT nfe_id FROM public.nfe_pedidos WHERE pedido_id = p_pedido_id);$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar frente_cancelar_venda'; END IF;
  EXECUTE novo;
END $$;
