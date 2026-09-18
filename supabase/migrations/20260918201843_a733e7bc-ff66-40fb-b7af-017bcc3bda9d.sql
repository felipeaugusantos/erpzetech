-- ============ operadores da Ze Tech ============
CREATE TABLE public.saas_operadores (
  user_id uuid PRIMARY KEY,
  nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.saas_operadores TO authenticated;
GRANT ALL ON public.saas_operadores TO service_role;
ALTER TABLE public.saas_operadores ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.eh_saas_operador()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.saas_operadores WHERE user_id = auth.uid())
$$;

CREATE POLICY "Operador ve operadores" ON public.saas_operadores
  FOR SELECT TO authenticated USING (public.eh_saas_operador());

INSERT INTO public.saas_operadores (user_id, nome)
SELECT id, 'Ze Tech' FROM auth.users WHERE email = 'felipeaugu.santos@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- ============ catálogo de planos ============
CREATE TABLE public.saas_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  resumo text,
  valor_mensal numeric(12,2) NOT NULL DEFAULT 0,
  prazo_meses integer NOT NULL DEFAULT 12,
  dias_teste integer NOT NULL DEFAULT 0,
  valor_filial_extra numeric(12,2) NOT NULL DEFAULT 0,
  valor_implantacao numeric(12,2) NOT NULL DEFAULT 0,
  recursos text[] NOT NULL DEFAULT '{}',
  ordem integer NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saas_planos TO authenticated;
GRANT ALL ON public.saas_planos TO service_role;
ALTER TABLE public.saas_planos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planos ativos visiveis" ON public.saas_planos
  FOR SELECT TO authenticated USING (ativo OR public.eh_saas_operador());
CREATE POLICY "Operador cria plano" ON public.saas_planos
  FOR INSERT TO authenticated WITH CHECK (public.eh_saas_operador());
CREATE POLICY "Operador edita plano" ON public.saas_planos
  FOR UPDATE TO authenticated USING (public.eh_saas_operador()) WITH CHECK (public.eh_saas_operador());
CREATE POLICY "Operador apaga plano" ON public.saas_planos
  FOR DELETE TO authenticated USING (public.eh_saas_operador());

CREATE TRIGGER trg_saas_planos_updated BEFORE UPDATE ON public.saas_planos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.saas_planos (codigo, nome, resumo, valor_mensal, prazo_meses, dias_teste, valor_filial_extra, valor_implantacao, recursos, ordem) VALUES
  ('balcao','Balcão','1 loja, 1 depósito, 5 usuários',149,12,0,390,1500,
    ARRAY['Clientes e obras','Produtos e estoque','Orçamento','Pedidos'],1),
  ('loja','Loja','1 loja, depósitos ilimitados, 15 usuários',299,12,15,390,1500,
    ARRAY['Tudo do Balcão','Compras com cotação','Separação e conferência','Entregas','Financeiro completo','NF-e'],2),
  ('rede','Rede','Multiempresa e filiais, usuários ilimitados',599,12,15,390,1500,
    ARRAY['Tudo do Loja','Roteirização automática','Tela do motorista','Custo por depósito','Balanço fiscal','Relatórios gerenciais'],3);

-- ============ clientes assinantes ============
CREATE TABLE public.saas_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  documento text,
  responsavel text,
  email text,
  whatsapp text,
  cidade text,
  uf text,
  plano_id uuid REFERENCES public.saas_planos(id),
  tenant_id uuid REFERENCES public.tenants(id),
  inicio date NOT NULL DEFAULT current_date,
  prazo_meses integer NOT NULL DEFAULT 12,
  dia_vencimento integer NOT NULL DEFAULT 10,
  filiais_extras integer NOT NULL DEFAULT 0,
  situacao text NOT NULL DEFAULT 'teste',
  teste_ate date,
  implantacao_paga boolean NOT NULL DEFAULT false,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saas_clientes TO authenticated;
GRANT ALL ON public.saas_clientes TO service_role;
ALTER TABLE public.saas_clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operador gerencia clientes saas" ON public.saas_clientes
  FOR ALL TO authenticated USING (public.eh_saas_operador()) WITH CHECK (public.eh_saas_operador());

CREATE TRIGGER trg_saas_clientes_updated BEFORE UPDATE ON public.saas_clientes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ faturas ============
CREATE TABLE public.saas_faturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.saas_clientes(id) ON DELETE CASCADE,
  competencia date,
  descricao text NOT NULL,
  tipo text NOT NULL DEFAULT 'mensalidade',
  valor numeric(12,2) NOT NULL DEFAULT 0,
  valor_pago numeric(12,2) NOT NULL DEFAULT 0,
  vencimento date NOT NULL,
  pago_em date,
  forma_pagamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_saas_faturas_cliente ON public.saas_faturas (cliente_id, vencimento);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saas_faturas TO authenticated;
GRANT ALL ON public.saas_faturas TO service_role;
ALTER TABLE public.saas_faturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operador gerencia faturas saas" ON public.saas_faturas
  FOR ALL TO authenticated USING (public.eh_saas_operador()) WITH CHECK (public.eh_saas_operador());

CREATE TRIGGER trg_saas_faturas_updated BEFORE UPDATE ON public.saas_faturas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ rotinas ============
CREATE OR REPLACE FUNCTION public.saas_gerar_faturas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cli record;
  v_comp date := date_trunc('month', current_date)::date;
  v_venc date;
  v_plano record;
  v_criadas integer := 0;
BEGIN
  IF NOT public.eh_saas_operador() THEN
    RAISE EXCEPTION 'Apenas operadores da Ze Tech podem gerar faturas';
  END IF;

  FOR v_cli IN SELECT * FROM public.saas_clientes WHERE situacao IN ('ativo','suspenso') LOOP
    SELECT * INTO v_plano FROM public.saas_planos WHERE id = v_cli.plano_id;
    IF v_plano IS NULL THEN CONTINUE; END IF;

    v_venc := v_comp + (LEAST(GREATEST(v_cli.dia_vencimento,1),28) - 1);

    IF NOT EXISTS (
      SELECT 1 FROM public.saas_faturas
      WHERE cliente_id = v_cli.id AND competencia = v_comp AND tipo = 'mensalidade'
    ) THEN
      INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento)
      VALUES (v_cli.id, v_comp, 'Mensalidade plano ' || v_plano.nome, 'mensalidade', v_plano.valor_mensal, v_venc);
      v_criadas := v_criadas + 1;
    END IF;

    IF v_cli.filiais_extras > 0 AND NOT EXISTS (
      SELECT 1 FROM public.saas_faturas
      WHERE cliente_id = v_cli.id AND competencia = v_comp AND tipo = 'filial_extra'
    ) THEN
      INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento)
      VALUES (v_cli.id, v_comp,
        v_cli.filiais_extras || ' filial(is) extra(s)', 'filial_extra',
        v_cli.filiais_extras * v_plano.valor_filial_extra, v_venc);
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;

  RETURN v_criadas;
END;
$$;

CREATE OR REPLACE FUNCTION public.saas_baixar_fatura(
  p_fatura_id uuid,
  p_valor numeric,
  p_forma text DEFAULT 'pix',
  p_data date DEFAULT current_date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_f record;
BEGIN
  IF NOT public.eh_saas_operador() THEN
    RAISE EXCEPTION 'Apenas operadores da Ze Tech podem registrar pagamentos';
  END IF;
  SELECT * INTO v_f FROM public.saas_faturas WHERE id = p_fatura_id;
  IF v_f IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada'; END IF;
  IF p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;

  UPDATE public.saas_faturas
  SET valor_pago = LEAST(valor, valor_pago + p_valor),
      forma_pagamento = p_forma,
      pago_em = CASE WHEN valor_pago + p_valor >= valor THEN p_data ELSE pago_em END
  WHERE id = p_fatura_id;
END;
$$;

-- ============ dados iniciais ============
INSERT INTO public.saas_clientes (nome, documento, responsavel, email, whatsapp, cidade, uf, plano_id, tenant_id, inicio, prazo_meses, dia_vencimento, filiais_extras, situacao, implantacao_paga)
SELECT 'Constrular Materiais para Construção', '12.345.678/0001-90', 'Felipe Augusto Santos',
       'contato@zeregistra.com.br', '16 99799-4239', 'Franca', 'SP',
       (SELECT id FROM public.saas_planos WHERE codigo = 'rede'),
       (SELECT id FROM public.tenants ORDER BY created_at LIMIT 1),
       (current_date - INTERVAL '4 months')::date, 12, 10, 1, 'ativo', true;

INSERT INTO public.saas_clientes (nome, documento, responsavel, email, whatsapp, cidade, uf, plano_id, inicio, prazo_meses, dia_vencimento, situacao, teste_ate)
VALUES
  ('Depósito Vila Nova', '23.456.789/0001-11', 'Marcos Pereira', 'marcos@vilanova.com.br', '16 98111-2233', 'Ribeirão Preto', 'SP',
   (SELECT id FROM public.saas_planos WHERE codigo = 'loja'),
   (current_date - INTERVAL '8 days')::date, 12, 15, 'teste', (current_date + INTERVAL '7 days')::date),
  ('Casa do Construtor Sul', '34.567.890/0001-22', 'Ana Lúcia Dias', 'ana@casadoconstrutor.com.br', '16 98444-5566', 'Batatais', 'SP',
   (SELECT id FROM public.saas_planos WHERE codigo = 'balcao'),
   (current_date - INTERVAL '10 months')::date, 12, 5, 'ativo', NULL);

-- competência anterior paga e competência atual em aberto
INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, valor_pago, vencimento, pago_em, forma_pagamento)
SELECT c.id,
       (date_trunc('month', current_date) - INTERVAL '1 month')::date,
       'Mensalidade plano ' || p.nome, 'mensalidade', p.valor_mensal, p.valor_mensal,
       (date_trunc('month', current_date) - INTERVAL '1 month')::date + (LEAST(c.dia_vencimento,28) - 1),
       (date_trunc('month', current_date) - INTERVAL '1 month')::date + (LEAST(c.dia_vencimento,28) - 1),
       'pix'
FROM public.saas_clientes c JOIN public.saas_planos p ON p.id = c.plano_id
WHERE c.situacao = 'ativo';

INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento)
SELECT c.id, date_trunc('month', current_date)::date,
       'Mensalidade plano ' || p.nome, 'mensalidade', p.valor_mensal,
       date_trunc('month', current_date)::date + (LEAST(c.dia_vencimento,28) - 1)
FROM public.saas_clientes c JOIN public.saas_planos p ON p.id = c.plano_id
WHERE c.situacao = 'ativo';

INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento)
SELECT c.id, date_trunc('month', current_date)::date,
       c.filiais_extras || ' filial(is) extra(s)', 'filial_extra',
       c.filiais_extras * p.valor_filial_extra,
       date_trunc('month', current_date)::date + (LEAST(c.dia_vencimento,28) - 1)
FROM public.saas_clientes c JOIN public.saas_planos p ON p.id = c.plano_id
WHERE c.filiais_extras > 0 AND c.situacao = 'ativo';