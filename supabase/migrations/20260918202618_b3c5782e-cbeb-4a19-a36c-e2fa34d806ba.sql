-- ============ contas bancárias ============
CREATE TABLE public.contas_bancarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  filial_id uuid REFERENCES public.filiais(id),
  apelido text NOT NULL,
  banco_codigo text,
  banco_nome text,
  agencia text,
  conta text,
  conta_digito text,
  tipo text NOT NULL DEFAULT 'corrente',
  chave_pix text,
  saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  saldo_inicial_data date NOT NULL DEFAULT current_date,
  padrao boolean NOT NULL DEFAULT false,
  ativa boolean NOT NULL DEFAULT true,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contas_bancarias_tenant ON public.contas_bancarias (tenant_id, ativa);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contas_bancarias TO authenticated;
GRANT ALL ON public.contas_bancarias TO service_role;
ALTER TABLE public.contas_bancarias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant ve contas bancarias" ON public.contas_bancarias
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Financeiro cria conta bancaria" ON public.contas_bancarias
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_role(auth.uid(), 'financeiro'))
  );
CREATE POLICY "Financeiro edita conta bancaria" ON public.contas_bancarias
  FOR UPDATE TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_role(auth.uid(), 'financeiro'))
  ) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER trg_contas_bancarias_updated BEFORE UPDATE ON public.contas_bancarias
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ movimentação bancária ============
CREATE TABLE public.banco_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  conta_id uuid NOT NULL REFERENCES public.contas_bancarias(id),
  conta_destino_id uuid REFERENCES public.contas_bancarias(id),
  data date NOT NULL DEFAULT current_date,
  tipo text NOT NULL,
  categoria text,
  valor numeric(14,2) NOT NULL,
  descricao text NOT NULL,
  documento text,
  forma text,
  origem text NOT NULL DEFAULT 'manual',
  origem_id uuid,
  conciliado boolean NOT NULL DEFAULT false,
  conciliado_em timestamptz,
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_banco_mov_conta ON public.banco_movimentos (conta_id, data);
CREATE INDEX idx_banco_mov_tenant ON public.banco_movimentos (tenant_id, data);
GRANT SELECT, INSERT, UPDATE ON public.banco_movimentos TO authenticated;
GRANT ALL ON public.banco_movimentos TO service_role;
ALTER TABLE public.banco_movimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant ve extrato bancario" ON public.banco_movimentos
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Financeiro lanca no banco" ON public.banco_movimentos
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa'))
  );
-- só a conciliação pode ser alterada; valor, data e conta ficam imutáveis
CREATE OR REPLACE FUNCTION public.banco_mov_somente_conciliar()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.conta_id <> OLD.conta_id OR NEW.valor <> OLD.valor OR NEW.data <> OLD.data
     OR NEW.tipo <> OLD.tipo OR COALESCE(NEW.descricao,'') <> COALESCE(OLD.descricao,'') THEN
    RAISE EXCEPTION 'Lançamento bancário não pode ser alterado: registre um lançamento de ajuste';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_banco_mov_imutavel BEFORE UPDATE ON public.banco_movimentos
  FOR EACH ROW EXECUTE FUNCTION public.banco_mov_somente_conciliar();
CREATE TRIGGER trg_banco_mov_sem_delete BEFORE DELETE ON public.banco_movimentos
  FOR EACH ROW EXECUTE FUNCTION public.block_delete();

CREATE POLICY "Financeiro concilia" ON public.banco_movimentos
  FOR UPDATE TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
         OR public.has_role(auth.uid(), 'financeiro'))
  ) WITH CHECK (tenant_id = public.current_tenant_id());

-- ============ rotinas ============
CREATE OR REPLACE FUNCTION public.banco_saldo(p_conta_id uuid, p_ate date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(c.saldo_inicial, 0) + COALESCE((
    SELECT SUM(CASE WHEN m.tipo IN ('saida','tarifa','transferencia_saida','pagamento') THEN -m.valor ELSE m.valor END)
    FROM public.banco_movimentos m
    WHERE m.conta_id = c.id AND (p_ate IS NULL OR m.data <= p_ate)
  ), 0)
  FROM public.contas_bancarias c
  WHERE c.id = p_conta_id AND c.tenant_id = public.current_tenant_id()
$$;

CREATE OR REPLACE FUNCTION public.banco_lancar(
  p_conta_id uuid,
  p_tipo text,
  p_valor numeric,
  p_descricao text,
  p_data date DEFAULT current_date,
  p_categoria text DEFAULT NULL,
  p_documento text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_tenant uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')
          OR public.has_role(auth.uid(),'financeiro') OR public.has_role(auth.uid(),'caixa')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar no banco';
  END IF;
  IF p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  IF p_tipo NOT IN ('entrada','saida','tarifa','rendimento','deposito_caixa') THEN
    RAISE EXCEPTION 'Tipo de lançamento inválido';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.contas_bancarias
  WHERE id = p_conta_id AND tenant_id = public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Conta bancária não encontrada'; END IF;

  INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, documento, origem, usuario_id)
  VALUES (v_tenant, p_conta_id, COALESCE(p_data, current_date),
          CASE WHEN p_tipo = 'rendimento' THEN 'entrada' ELSE p_tipo END,
          COALESCE(p_categoria, p_tipo), p_valor, p_descricao, p_documento, 'manual', auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.banco_transferir(
  p_origem_id uuid,
  p_destino_id uuid,
  p_valor numeric,
  p_data date DEFAULT current_date,
  p_observacao text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_id uuid; v_org text; v_dst text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')
          OR public.has_role(auth.uid(),'financeiro')) THEN
    RAISE EXCEPTION 'Sem permissão para transferir entre contas';
  END IF;
  IF p_origem_id = p_destino_id THEN RAISE EXCEPTION 'Escolha contas diferentes'; END IF;
  IF p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;

  SELECT tenant_id, apelido INTO v_tenant, v_org FROM public.contas_bancarias
  WHERE id = p_origem_id AND tenant_id = public.current_tenant_id();
  SELECT apelido INTO v_dst FROM public.contas_bancarias
  WHERE id = p_destino_id AND tenant_id = public.current_tenant_id();
  IF v_tenant IS NULL OR v_dst IS NULL THEN RAISE EXCEPTION 'Conta bancária não encontrada'; END IF;

  INSERT INTO public.banco_movimentos (tenant_id, conta_id, conta_destino_id, data, tipo, categoria, valor, descricao, origem, usuario_id)
  VALUES (v_tenant, p_origem_id, p_destino_id, COALESCE(p_data, current_date), 'transferencia_saida', 'transferencia',
          p_valor, COALESCE(p_observacao, 'Transferência para ' || v_dst), 'transferencia', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.banco_movimentos (tenant_id, conta_id, conta_destino_id, data, tipo, categoria, valor, descricao, origem, origem_id, usuario_id)
  VALUES (v_tenant, p_destino_id, p_origem_id, COALESCE(p_data, current_date), 'transferencia_entrada', 'transferencia',
          p_valor, COALESCE(p_observacao, 'Transferência de ' || v_org), 'transferencia', v_id, auth.uid());

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.banco_conciliar(p_mov_id uuid, p_conciliado boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')
          OR public.has_role(auth.uid(),'financeiro')) THEN
    RAISE EXCEPTION 'Sem permissão para conciliar';
  END IF;
  UPDATE public.banco_movimentos
  SET conciliado = p_conciliado,
      conciliado_em = CASE WHEN p_conciliado THEN now() ELSE NULL END
  WHERE id = p_mov_id AND tenant_id = public.current_tenant_id();
END;
$$;

-- ============ alimentação automática ============
/** Conta padrão do tenant (preferindo a filial informada). */
CREATE OR REPLACE FUNCTION public.banco_conta_padrao(p_tenant uuid, p_filial uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.contas_bancarias
  WHERE tenant_id = p_tenant AND ativa
  ORDER BY (p_filial IS NOT NULL AND filial_id = p_filial) DESC, padrao DESC, created_at
  LIMIT 1
$$;

/** Baixa de título fora do caixa entra/sai da conta bancária padrão. */
CREATE OR REPLACE FUNCTION public.banco_da_baixa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conta uuid; v_desc text; v_num integer;
BEGIN
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
CREATE TRIGGER trg_banco_da_baixa AFTER INSERT ON public.financeiro_baixas
  FOR EACH ROW EXECUTE FUNCTION public.banco_da_baixa();

/** Sangria do caixa vira depósito em banco. */
CREATE OR REPLACE FUNCTION public.banco_da_sangria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conta uuid; v_filial uuid;
BEGIN
  IF NEW.tipo <> 'sangria' THEN RETURN NEW; END IF;
  SELECT filial_id INTO v_filial FROM public.caixas WHERE id = NEW.caixa_id;
  v_conta := public.banco_conta_padrao(NEW.tenant_id, v_filial);
  IF v_conta IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, origem, origem_id, usuario_id)
  VALUES (NEW.tenant_id, v_conta, COALESCE(NEW.created_at::date, current_date), 'deposito_caixa', 'deposito',
          NEW.valor, COALESCE(NEW.descricao, 'Sangria do caixa depositada em banco'), 'caixa', NEW.id, auth.uid());
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_banco_da_sangria AFTER INSERT ON public.caixa_movimentos
  FOR EACH ROW EXECUTE FUNCTION public.banco_da_sangria();

REVOKE EXECUTE ON FUNCTION public.banco_saldo(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.banco_lancar(uuid, text, numeric, text, date, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.banco_transferir(uuid, uuid, numeric, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.banco_conciliar(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.banco_conta_padrao(uuid, uuid) FROM anon;

-- conta inicial de exemplo para a loja já existente
INSERT INTO public.contas_bancarias (tenant_id, filial_id, apelido, banco_codigo, banco_nome, agencia, conta, conta_digito, tipo, chave_pix, saldo_inicial, saldo_inicial_data, padrao)
SELECT f.tenant_id, f.id, 'Conta movimento', '341', 'Itaú Unibanco', '1234', '56789', '0', 'corrente',
       'contato@zeregistra.com.br', 0, current_date, true
FROM public.filiais f
ORDER BY f.created_at
LIMIT 1;