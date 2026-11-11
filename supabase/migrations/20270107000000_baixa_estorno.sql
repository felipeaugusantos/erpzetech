-- Estorno de baixa e fechamento da escrita direta no financeiro.
--
-- 1) financeiro_baixas nasceu com INSERT liberado a qualquer usuário da empresa (política
--    financeiro_baixas_insert + GRANT INSERT): dava para registrar baixa sem passar por baixar_conta
--    (sem conferir saldo, sem atualizar o título, e ainda gerava lançamento no banco pelo gatilho).
--    Agora só as funções (SECURITY DEFINER) gravam.
-- 2) contas_pagar ainda tinha a política "for all" da empresa inteira, e contas_receber/contas_pagar
--    deixavam o cliente mudar valor_recebido/valor_pago/situacao direto. Um gatilho passa a recusar isso
--    para quem não é função do banco; cancelar título com pagamento exige estornar antes.
-- 3) baixa_estornar: baixa é imutável, então o estorno é uma NOVA baixa ligada à original
--    (estorno_de), com motivo, que reabre o saldo do título e desfaz o efeito no caixa e no banco.

ALTER TABLE public.financeiro_baixas
  ADD COLUMN IF NOT EXISTS estorno_de uuid REFERENCES public.financeiro_baixas(id),
  ADD COLUMN IF NOT EXISTS motivo_estorno text;

-- uma baixa só pode ser estornada uma vez
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_baixas_estorno_unico
  ON public.financeiro_baixas (estorno_de) WHERE estorno_de IS NOT NULL;

ALTER TABLE public.financeiro_baixas DROP CONSTRAINT IF EXISTS financeiro_baixas_estorno_motivo;
ALTER TABLE public.financeiro_baixas ADD CONSTRAINT financeiro_baixas_estorno_motivo
  CHECK (estorno_de IS NULL OR length(btrim(coalesce(motivo_estorno, ''))) >= 3);

-- ===== 1) baixa só por função =====
DROP POLICY IF EXISTS financeiro_baixas_insert ON public.financeiro_baixas;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.financeiro_baixas FROM authenticated, anon;

-- o lançamento automático no banco não vale para o estorno (a função faz o lançamento inverso)
CREATE OR REPLACE FUNCTION public.banco_da_baixa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conta uuid; v_desc text; v_num integer;
BEGIN
  IF NEW.estorno_de IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.caixa_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.forma_pagamento NOT IN ('pix','boleto','transferencia','cartao_credito','cartao_debito') THEN
    RETURN NEW;
  END IF;

  v_conta := public.banco_conta_padrao(NEW.tenant_id, NULL);
  IF v_conta IS NULL THEN RETURN NEW; END IF;

  IF NEW.conta_receber_id IS NOT NULL THEN
    SELECT numero INTO v_num FROM public.contas_receber WHERE id = NEW.conta_receber_id;
    v_desc := 'Recebimento do título nº ' || COALESCE(v_num::text, '—');
    INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, forma, origem, origem_id, usuario_id)
    VALUES (NEW.tenant_id, v_conta, NEW.data_baixa, 'entrada', 'recebimento', NEW.valor, v_desc,
            NEW.forma_pagamento::text, 'contas_receber', NEW.id, NEW.usuario_id);
  ELSIF NEW.conta_pagar_id IS NOT NULL THEN
    SELECT numero INTO v_num FROM public.contas_pagar WHERE id = NEW.conta_pagar_id;
    v_desc := 'Pagamento do título nº ' || COALESCE(v_num::text, '—');
    INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, forma, origem, origem_id, usuario_id)
    VALUES (NEW.tenant_id, v_conta, NEW.data_baixa, 'saida', 'pagamento', NEW.valor, v_desc,
            NEW.forma_pagamento::text, 'contas_pagar', NEW.id, NEW.usuario_id);
  END IF;

  RETURN NEW;
END;
$$;

-- ===== 2) títulos: sem mexer em valor pago/recebido nem situação direto =====
DROP POLICY IF EXISTS contas_pagar_tenant ON public.contas_pagar;
REVOKE DELETE ON public.contas_pagar FROM authenticated, anon;
CREATE POLICY contas_pagar_leitura ON public.contas_pagar FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY contas_pagar_insere ON public.contas_pagar FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa')
                   OR public.has_role(auth.uid(), 'comprador')));
CREATE POLICY contas_pagar_altera ON public.contas_pagar FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa')
              OR public.has_role(auth.uid(), 'comprador')))
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.conta_titulo_protege()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pago_old numeric; v_pago_new numeric;
BEGIN
  -- funções do banco (SECURITY DEFINER) rodam como dono e passam; o cliente (authenticated) não
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'contas_receber' THEN
    v_pago_old := OLD.valor_recebido; v_pago_new := NEW.valor_recebido;
  ELSE
    v_pago_old := OLD.valor_pago; v_pago_new := NEW.valor_pago;
  END IF;

  IF v_pago_new IS DISTINCT FROM v_pago_old OR NEW.valor IS DISTINCT FROM OLD.valor THEN
    RAISE EXCEPTION 'Valor do título e valor já quitado só mudam por baixa ou estorno';
  END IF;
  IF NEW.situacao IS DISTINCT FROM OLD.situacao THEN
    IF NEW.situacao <> 'cancelado' THEN
      RAISE EXCEPTION 'A situação do título muda por baixa ou estorno; só o cancelamento é manual';
    END IF;
    IF v_pago_old > 0.001 THEN
      RAISE EXCEPTION 'Título com pagamento não pode ser cancelado: estorne as baixas antes';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conta_receber_protege_trg ON public.contas_receber;
CREATE TRIGGER conta_receber_protege_trg BEFORE UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.conta_titulo_protege();
DROP TRIGGER IF EXISTS conta_pagar_protege_trg ON public.contas_pagar;
CREATE TRIGGER conta_pagar_protege_trg BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.conta_titulo_protege();

-- ===== 3) estorno =====
CREATE OR REPLACE FUNCTION public.baixa_estornar(p_baixa_id uuid, p_motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  b public.financeiro_baixas;
  v_id uuid;
  v_numero bigint; v_situacao public.conta_situacao; v_quitado numeric;
  v_cliente uuid; v_forma_orig public.forma_pagamento;
  v_cx uuid; v_cx_filial uuid; v_cx_sit public.caixa_situacao;
  bm public.banco_movimentos;
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Estorno de baixa só pelo administrador, gestor ou financeiro';
  END IF;
  IF length(v_motivo) < 3 THEN RAISE EXCEPTION 'Informe o motivo do estorno'; END IF;

  SELECT * INTO b FROM public.financeiro_baixas WHERE id = p_baixa_id AND tenant_id = v_tenant FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Baixa não encontrada'; END IF;
  IF b.estorno_de IS NOT NULL THEN RAISE EXCEPTION 'Um estorno não pode ser estornado'; END IF;
  IF EXISTS (SELECT 1 FROM public.financeiro_baixas WHERE estorno_de = b.id) THEN
    RAISE EXCEPTION 'Esta baixa já foi estornada';
  END IF;

  -- trava o título
  IF b.conta_receber_id IS NOT NULL THEN
    SELECT numero, situacao, valor_recebido, cliente_id, forma_pagamento
      INTO v_numero, v_situacao, v_quitado, v_cliente, v_forma_orig
      FROM public.contas_receber WHERE id = b.conta_receber_id AND tenant_id = v_tenant FOR UPDATE;
  ELSE
    SELECT numero, situacao, valor_pago INTO v_numero, v_situacao, v_quitado
      FROM public.contas_pagar WHERE id = b.conta_pagar_id AND tenant_id = v_tenant FOR UPDATE;
  END IF;
  IF v_situacao IS NULL THEN RAISE EXCEPTION 'Título da baixa não encontrado'; END IF;
  IF v_situacao = 'cancelado' THEN RAISE EXCEPTION 'Título cancelado: não há o que estornar'; END IF;
  IF v_quitado + 0.001 < b.valor THEN RAISE EXCEPTION 'O título quitado é menor que a baixa: confira com o suporte'; END IF;

  -- dinheiro que passou pelo caixa volta pelo caixa: o da baixa, se ainda aberto; senão o aberto da mesma filial
  IF b.caixa_id IS NOT NULL THEN
    SELECT situacao, filial_id INTO v_cx_sit, v_cx_filial FROM public.caixas WHERE id = b.caixa_id AND tenant_id = v_tenant;
    IF v_cx_sit = 'aberto' THEN
      v_cx := b.caixa_id;
    ELSE
      SELECT id INTO v_cx FROM public.caixas
       WHERE tenant_id = v_tenant AND situacao = 'aberto' AND filial_id IS NOT DISTINCT FROM v_cx_filial
       ORDER BY (aberto_por = auth.uid()) DESC, aberto_em DESC LIMIT 1;
      IF v_cx IS NULL THEN
        RAISE EXCEPTION 'O caixa desta baixa já foi fechado: abra o caixa da filial para registrar o estorno';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.financeiro_baixas (tenant_id, conta_receber_id, conta_pagar_id, caixa_id, valor,
    forma_pagamento, data_baixa, observacao, usuario_id, estorno_de, motivo_estorno)
  VALUES (v_tenant, b.conta_receber_id, b.conta_pagar_id, v_cx, b.valor, b.forma_pagamento, v_hoje,
    'Estorno: ' || v_motivo, auth.uid(), b.id, v_motivo)
  RETURNING id INTO v_id;

  IF b.conta_receber_id IS NOT NULL THEN
    UPDATE public.contas_receber
       SET valor_recebido = valor_recebido - b.valor,
           situacao = CASE WHEN valor_recebido - b.valor <= 0.001 THEN 'aberto'::public.conta_situacao
                           ELSE 'parcial'::public.conta_situacao END
     WHERE id = b.conta_receber_id;
    IF v_forma_orig = 'crediario' AND v_cliente IS NOT NULL THEN
      UPDATE public.clientes SET saldo_utilizado = saldo_utilizado + b.valor WHERE id = v_cliente;
    END IF;
  ELSE
    UPDATE public.contas_pagar
       SET valor_pago = valor_pago - b.valor,
           situacao = CASE WHEN valor_pago - b.valor <= 0.001 THEN 'aberto'::public.conta_situacao
                           ELSE 'parcial'::public.conta_situacao END
     WHERE id = b.conta_pagar_id;
  END IF;

  -- caixa: movimento inverso do original (recebimento sai; pagamento volta)
  IF v_cx IS NOT NULL THEN
    INSERT INTO public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
    VALUES (v_tenant, v_cx,
      CASE WHEN b.conta_receber_id IS NOT NULL THEN 'saida'::public.caixa_mov_tipo ELSE 'entrada'::public.caixa_mov_tipo END,
      b.valor, b.forma_pagamento,
      'Estorno de ' || CASE WHEN b.conta_receber_id IS NOT NULL THEN 'recebimento' ELSE 'pagamento' END
        || ' do título nº ' || coalesce(v_numero::text, '—') || ': ' || v_motivo,
      auth.uid());
  END IF;

  -- banco: lançamento inverso na mesma conta bancária (o original fica; quem concilia vê os dois)
  SELECT * INTO bm FROM public.banco_movimentos
   WHERE tenant_id = v_tenant AND origem_id = b.id AND origem IN ('contas_receber', 'contas_pagar') LIMIT 1;
  IF bm.id IS NOT NULL THEN
    INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, forma, origem, origem_id, usuario_id)
    VALUES (v_tenant, bm.conta_id, v_hoje,
      CASE WHEN bm.tipo = 'entrada' THEN 'saida' ELSE 'entrada' END,
      'estorno', bm.valor,
      'Estorno de ' || CASE WHEN b.conta_receber_id IS NOT NULL THEN 'recebimento' ELSE 'pagamento' END
        || ' do título nº ' || coalesce(v_numero::text, '—') || ': ' || v_motivo,
      bm.forma, 'estorno_baixa', v_id, auth.uid());
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.baixa_estornar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.baixa_estornar(uuid, text) TO authenticated;
