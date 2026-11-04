-- Restaurante: caixa de entrada de pedidos externos (base do iFood) e preco/codigo do canal no item.
--
-- Esta migration NAO fala com o iFood. Ela recebe um pedido ja convertido para o formato interno abaixo (quem
-- converte e o conector, que entra depois), guarda na caixa de entrada e, quando a operacao aceita, abre o
-- delivery normal (canal 'ifood', sem duplicar pelo codigo externo) com os itens e adicionais do pedido.
--
-- Formato interno do pedido (jsonb):
--   { "numero": "1234", "tipo": "entrega" | "retirada" | "local",
--     "cliente": { "nome": "...", "telefone": "..." },
--     "endereco": { "texto": "...", "bairro": "...", "referencia": "..." },
--     "itens": [ { "codigo": "...", "nome": "...", "quantidade": 1, "preco": 25.9, "observacao": "...",
--                  "adicionais": [ { "nome": "...", "preco": 3.5 } ] } ],
--     "taxa_entrega": 6, "desconto": 0, "total": 35.4,
--     "pagamento": "pago_online" | "dinheiro" | "pix" | "cartao_credito" | "cartao_debito", "troco_para": 50,
--     "observacao": "..." }
-- Os precos e adicionais vem do pedido (o que o cliente pagou), nao do cardapio. O desconto/beneficio do canal nao
-- altera os itens: fica anotado na observacao do delivery para a gestao aplicar no fechamento.

-- ===== Item do cardapio: codigo no canal e preco proprio do iFood =====
ALTER TABLE public.cardapio_itens
  ADD COLUMN IF NOT EXISTS codigo_externo text,
  ADD COLUMN IF NOT EXISTS preco_ifood numeric(14,2);
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_codigo_externo_ck;
ALTER TABLE public.cardapio_itens ADD CONSTRAINT cardapio_itens_codigo_externo_ck
  CHECK (codigo_externo IS NULL OR char_length(btrim(codigo_externo)) BETWEEN 1 AND 100);
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_preco_ifood_ck;
ALTER TABLE public.cardapio_itens ADD CONSTRAINT cardapio_itens_preco_ifood_ck
  CHECK (preco_ifood IS NULL OR (preco_ifood >= 0 AND preco_ifood <= 100000));
CREATE UNIQUE INDEX IF NOT EXISTS cardapio_itens_codigo_externo_uk
  ON public.cardapio_itens (tenant_id, codigo_externo) WHERE codigo_externo IS NOT NULL;

-- ===== Caixa de entrada =====
CREATE TABLE IF NOT EXISTS public.restaurante_pedidos_externos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('ifood')),
  codigo_externo text NOT NULL CHECK (char_length(btrim(codigo_externo)) BETWEEN 1 AND 100),
  numero_exibicao text,
  pedido jsonb NOT NULL,
  situacao text NOT NULL DEFAULT 'recebido' CHECK (situacao IN ('recebido', 'aceito', 'recusado')),
  comanda_id uuid,
  motivo text,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  decidido_em timestamptz,
  decidido_por uuid,
  CONSTRAINT restaurante_pedidos_externos_uk UNIQUE (tenant_id, canal, codigo_externo),
  CONSTRAINT restaurante_pedidos_externos_comanda_fk FOREIGN KEY (comanda_id, tenant_id)
    REFERENCES public.comandas (id, tenant_id) ON DELETE SET NULL (comanda_id),
  CONSTRAINT restaurante_pedidos_externos_decisao_ck CHECK ((situacao = 'recebido') = (decidido_em IS NULL))
);
CREATE INDEX IF NOT EXISTS restaurante_pedidos_externos_fila_idx
  ON public.restaurante_pedidos_externos (tenant_id, situacao, recebido_em DESC);

ALTER TABLE public.restaurante_pedidos_externos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurante_pedidos_externos FROM PUBLIC, anon;
GRANT ALL ON public.restaurante_pedidos_externos TO service_role;
GRANT SELECT ON public.restaurante_pedidos_externos TO authenticated;
DROP POLICY IF EXISTS restaurante_pedidos_externos_select ON public.restaurante_pedidos_externos;
CREATE POLICY restaurante_pedidos_externos_select ON public.restaurante_pedidos_externos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                        AND schemaname = 'public' AND tablename = 'restaurante_pedidos_externos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurante_pedidos_externos;
  END IF;
END $$;

-- ===== Receber (so o servidor, com a chave de servico) =====
CREATE OR REPLACE FUNCTION public.restaurante_externo_receber(
  p_tenant uuid,
  p_canal text,
  p_codigo text,
  p_pedido jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_ad jsonb;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF p_canal IS DISTINCT FROM 'ifood' THEN RAISE EXCEPTION 'Canal inválido'; END IF;
  IF coalesce(char_length(btrim(p_codigo)), 0) = 0 THEN RAISE EXCEPTION 'Código do pedido ausente'; END IF;
  IF jsonb_typeof(p_pedido) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Pedido em formato inválido'; END IF;
  IF coalesce(p_pedido ->> 'tipo', 'entrega') NOT IN ('entrega', 'retirada', 'local') THEN
    RAISE EXCEPTION 'Tipo de pedido inválido';
  END IF;
  IF jsonb_typeof(p_pedido -> 'itens') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_pedido -> 'itens') NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'O pedido precisa de 1 a 100 itens';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_pedido -> 'itens') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR coalesce(char_length(btrim(v_item ->> 'codigo')), 0) = 0
       OR coalesce(char_length(btrim(v_item ->> 'nome')), 0) = 0 THEN
      RAISE EXCEPTION 'Item do pedido sem código ou nome';
    END IF;
    BEGIN
      IF (v_item ->> 'quantidade')::numeric <= 0 OR (v_item ->> 'quantidade')::numeric > 999
         OR (v_item ->> 'preco')::numeric < 0 THEN
        RAISE EXCEPTION 'Quantidade ou preço inválido';
      END IF;
      FOR v_ad IN SELECT * FROM jsonb_array_elements(coalesce(v_item -> 'adicionais', '[]'::jsonb)) LOOP
        IF coalesce(char_length(btrim(v_ad ->> 'nome')), 0) = 0 OR (v_ad ->> 'preco')::numeric < 0 THEN
          RAISE EXCEPTION 'Adicional inválido';
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item do pedido inválido: %', coalesce(v_item ->> 'nome', '?');
    END;
  END LOOP;

  -- o mesmo pedido chegando de novo (reenvio do canal) devolve o registro que ja existe
  INSERT INTO public.restaurante_pedidos_externos (tenant_id, canal, codigo_externo, numero_exibicao, pedido)
  VALUES (p_tenant, p_canal, btrim(p_codigo), left(nullif(btrim(p_pedido ->> 'numero'), ''), 30), p_pedido)
  ON CONFLICT (tenant_id, canal, codigo_externo) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.restaurante_pedidos_externos
     WHERE tenant_id = p_tenant AND canal = p_canal AND codigo_externo = btrim(p_codigo);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_externo_receber(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_externo_receber(uuid, text, text, jsonb) TO service_role;

-- ===== Recusar =====
CREATE OR REPLACE FUNCTION public.restaurante_externo_recusar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
BEGIN
  IF coalesce(char_length(btrim(p_motivo)), 0) < 3 THEN RAISE EXCEPTION 'Informe o motivo da recusa'; END IF;
  UPDATE public.restaurante_pedidos_externos
     SET situacao = 'recusado', motivo = left(btrim(p_motivo), 200), decidido_em = now(), decidido_por = auth.uid()
   WHERE id = p_id AND tenant_id = v_tenant AND situacao = 'recebido';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já decidido'; END IF;
END;
$$;

-- ===== Aceitar: abre o delivery com os itens do pedido =====
CREATE OR REPLACE FUNCTION public.restaurante_externo_aceitar(
  p_id uuid,
  p_mapeamento jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_ext public.restaurante_pedidos_externos;
  v_p jsonb;
  v_it jsonb;
  v_card public.cardapio_itens;
  v_map_id uuid;
  v_faltam text[] := '{}';
  v_unit numeric(14,2);
  v_qtd numeric(10,3);
  v_ads jsonb;
  v_tipo text;
  v_endereco text;
  v_fone text;
  v_pagamento text;
  v_taxa numeric(14,2);
  v_obs text;
  v_cmd uuid;
  v_linhas jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(coalesce(p_mapeamento, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'Mapeamento em formato inválido'; END IF;
  SELECT * INTO v_ext FROM public.restaurante_pedidos_externos WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_ext.situacao <> 'recebido' THEN RAISE EXCEPTION 'Pedido não encontrado ou já decidido'; END IF;
  v_p := v_ext.pedido;
  v_tipo := coalesce(v_p ->> 'tipo', 'entrega');

  -- 1) cada item do pedido precisa de um item do cardapio (mapeamento da tela ou codigo ja guardado)
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_p -> 'itens') LOOP
    v_map_id := NULL;
    BEGIN
      v_map_id := nullif(p_mapeamento ->> (v_it ->> 'codigo'), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Mapeamento inválido para %', v_it ->> 'nome';
    END;
    IF v_map_id IS NOT NULL THEN
      SELECT * INTO v_card FROM public.cardapio_itens
       WHERE id = v_map_id AND tenant_id = v_tenant AND ativo AND NOT interno;
    ELSE
      SELECT * INTO v_card FROM public.cardapio_itens
       WHERE tenant_id = v_tenant AND codigo_externo = btrim(v_it ->> 'codigo') AND ativo AND NOT interno;
    END IF;
    IF NOT FOUND THEN
      v_faltam := v_faltam || coalesce(v_it ->> 'nome', '?');
      CONTINUE;
    END IF;
    IF v_card.venda_por_peso THEN
      RAISE EXCEPTION 'O item % é vendido por peso e não pode vir do canal', v_card.nome;
    END IF;

    v_ads := coalesce((SELECT jsonb_agg(jsonb_build_object('nome', left(btrim(a ->> 'nome'), 80),
                                                           'preco_adicional', round((a ->> 'preco')::numeric, 2)) ORDER BY ord)
                         FROM jsonb_array_elements(coalesce(v_it -> 'adicionais', '[]'::jsonb)) WITH ORDINALITY AS t(a, ord)),
                      '[]'::jsonb);
    v_unit := round((v_it ->> 'preco')::numeric, 2)
              + coalesce((SELECT sum((a ->> 'preco_adicional')::numeric) FROM jsonb_array_elements(v_ads) a), 0);
    v_qtd := round((v_it ->> 'quantidade')::numeric, 3);
    v_linhas := v_linhas || jsonb_build_object(
      'item', v_card.id, 'nome', v_card.nome, 'estacao', v_card.estacao, 'opcoes', v_ads,
      'qtd', v_qtd, 'unit', v_unit, 'obs', nullif(btrim(v_it ->> 'observacao'), ''),
      'codigo', btrim(v_it ->> 'codigo'), 'grava_codigo', (v_map_id IS NOT NULL AND v_card.codigo_externo IS NULL));
  END LOOP;
  IF cardinality(v_faltam) > 0 THEN
    RAISE EXCEPTION 'Itens sem correspondência no cardápio: %', array_to_string(v_faltam, ', ');
  END IF;

  -- 2) o delivery
  v_endereco := nullif(btrim(coalesce(v_p -> 'endereco' ->> 'texto', '')), '');
  IF v_tipo <> 'entrega' OR v_endereco IS NULL OR char_length(v_endereco) < 5 THEN
    IF v_tipo = 'entrega' THEN RAISE EXCEPTION 'Pedido de entrega sem endereço'; END IF;
    v_endereco := CASE WHEN v_tipo = 'local' THEN 'Consumo no local (pedido do canal)' ELSE 'Retirada no balcão (pedido do canal)' END;
  END IF;
  v_fone := nullif(btrim(coalesce(v_p -> 'cliente' ->> 'telefone', '')), '');
  IF v_fone IS NOT NULL AND char_length(regexp_replace(v_fone, '\D', '', 'g')) < 8 THEN v_fone := NULL; END IF;
  v_pagamento := nullif(v_p ->> 'pagamento', '');
  IF v_pagamento IS NOT NULL AND v_pagamento NOT IN ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'pago_online') THEN
    v_pagamento := NULL;
  END IF;
  v_taxa := least(greatest(round(coalesce(nullif(v_p ->> 'taxa_entrega', '')::numeric, 0), 2), 0), 1000);
  v_obs := concat_ws(' | ',
    'Pedido iFood ' || coalesce(v_ext.numero_exibicao, v_ext.codigo_externo),
    CASE WHEN coalesce((v_p ->> 'desconto')::numeric, 0) > 0
         THEN 'Desconto/benefício do canal: R$ ' || to_char((v_p ->> 'desconto')::numeric, 'FM999990.00') END,
    CASE WHEN nullif(v_p ->> 'total', '') IS NOT NULL
         THEN 'Total no canal: R$ ' || to_char((v_p ->> 'total')::numeric, 'FM999990.00') END,
    nullif(btrim(v_p ->> 'observacao'), ''));

  v_cmd := public.restaurante_abrir_delivery(
    coalesce(nullif(btrim(v_p -> 'cliente' ->> 'nome'), ''), 'Cliente iFood'),
    v_fone, v_endereco,
    nullif(btrim(v_p -> 'endereco' ->> 'bairro'), ''), nullif(btrim(v_p -> 'endereco' ->> 'referencia'), ''),
    v_taxa, v_pagamento, nullif(v_p ->> 'troco_para', '')::numeric, left(v_obs, 500));
  UPDATE public.comandas SET canal = v_ext.canal, codigo_externo = v_ext.codigo_externo WHERE id = v_cmd;

  -- 3) os itens (preco do pedido) e o envio a cozinha
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_linhas) LOOP
    INSERT INTO public.comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, opcoes, quantidade,
                                      preco_unitario, total, observacao, lancado_por)
    VALUES (v_tenant, v_cmd, (v_it ->> 'item')::uuid, v_it ->> 'nome', v_it ->> 'estacao', v_it -> 'opcoes',
            (v_it ->> 'qtd')::numeric, (v_it ->> 'unit')::numeric,
            round((v_it ->> 'qtd')::numeric * (v_it ->> 'unit')::numeric, 2), v_it ->> 'obs', auth.uid());
    IF (v_it ->> 'grava_codigo')::boolean THEN
      UPDATE public.cardapio_itens SET codigo_externo = v_it ->> 'codigo'
       WHERE id = (v_it ->> 'item')::uuid AND codigo_externo IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.cardapio_itens o
                          WHERE o.tenant_id = v_tenant AND o.codigo_externo = v_it ->> 'codigo');
    END IF;
  END LOOP;
  PERFORM public.restaurante_enviar_cozinha(v_cmd);

  UPDATE public.restaurante_pedidos_externos
     SET situacao = 'aceito', comanda_id = v_cmd, decidido_em = now(), decidido_por = auth.uid()
   WHERE id = p_id;
  RETURN v_cmd;
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_externo_recusar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_externo_aceitar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_externo_recusar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_externo_aceitar(uuid, jsonb) TO authenticated;
