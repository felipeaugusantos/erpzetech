CREATE TABLE public.assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  plano text NOT NULL DEFAULT 'loja',
  valor_mensal numeric NOT NULL DEFAULT 299,
  filiais_extras integer NOT NULL DEFAULT 0,
  valor_filial_extra numeric NOT NULL DEFAULT 390,
  valor_implantacao numeric NOT NULL DEFAULT 1500,
  implantacao_paga boolean NOT NULL DEFAULT false,
  situacao text NOT NULL DEFAULT 'teste',
  teste_ate date,
  dia_vencimento integer NOT NULL DEFAULT 10,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.assinaturas TO authenticated;
GRANT ALL ON public.assinaturas TO service_role;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assinaturas_select" ON public.assinaturas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "assinaturas_insert" ON public.assinaturas FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
CREATE POLICY "assinaturas_update" ON public.assinaturas FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));

CREATE TABLE public.assinatura_faturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  assinatura_id uuid NOT NULL REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'mensalidade',
  descricao text NOT NULL,
  competencia date,
  valor numeric NOT NULL DEFAULT 0,
  vencimento date NOT NULL,
  valor_pago numeric NOT NULL DEFAULT 0,
  pago_em date,
  forma_pagamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assinatura_faturas_tenant_idx ON public.assinatura_faturas (tenant_id, vencimento);

GRANT SELECT, INSERT, UPDATE ON public.assinatura_faturas TO authenticated;
GRANT ALL ON public.assinatura_faturas TO service_role;
ALTER TABLE public.assinatura_faturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assinatura_faturas_select" ON public.assinatura_faturas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "assinatura_faturas_insert" ON public.assinatura_faturas FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
CREATE POLICY "assinatura_faturas_update" ON public.assinatura_faturas FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));

CREATE TABLE public.contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text,
  whatsapp text,
  plano_interesse text,
  mensagem text,
  situacao text NOT NULL DEFAULT 'novo',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.contatos TO anon;
GRANT SELECT, INSERT, UPDATE ON public.contatos TO authenticated;
GRANT ALL ON public.contatos TO service_role;
ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contatos_insert_publico" ON public.contatos FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(nome) > 1 AND (email IS NOT NULL OR whatsapp IS NOT NULL));
CREATE POLICY "contatos_select" ON public.contatos FOR SELECT TO authenticated USING (true);
CREATE POLICY "contatos_update" ON public.contatos FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER trg_assinaturas_touch BEFORE UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_assinatura_faturas_touch BEFORE UPDATE ON public.assinatura_faturas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.assinaturas (id, tenant_id, plano, valor_mensal, filiais_extras, situacao, teste_ate, dia_vencimento, implantacao_paga)
VALUES ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'loja', 299, 1, 'ativa', NULL, 10, true);

INSERT INTO public.assinatura_faturas (tenant_id, assinatura_id, tipo, descricao, competencia, valor, vencimento, valor_pago, pago_em, forma_pagamento) VALUES
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','implantacao','Implantação: cadastro inicial, importação de produtos e treinamento', date_trunc('month', now() - interval '2 month')::date, 1500, (date_trunc('month', now() - interval '2 month') + interval '9 day')::date, 1500, (date_trunc('month', now() - interval '2 month') + interval '9 day')::date, 'pix'),
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','mensalidade','Plano Loja', date_trunc('month', now() - interval '2 month')::date, 299, (date_trunc('month', now() - interval '2 month') + interval '9 day')::date, 299, (date_trunc('month', now() - interval '2 month') + interval '9 day')::date, 'pix'),
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','mensalidade','Plano Loja', date_trunc('month', now() - interval '1 month')::date, 299, (date_trunc('month', now() - interval '1 month') + interval '9 day')::date, 299, (date_trunc('month', now() - interval '1 month') + interval '9 day')::date, 'boleto'),
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','filial_extra','Filial extra (1)', date_trunc('month', now() - interval '1 month')::date, 390, (date_trunc('month', now() - interval '1 month') + interval '9 day')::date, 390, (date_trunc('month', now() - interval '1 month') + interval '9 day')::date, 'boleto'),
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','mensalidade','Plano Loja', date_trunc('month', now())::date, 299, (date_trunc('month', now()) + interval '9 day')::date, 0, NULL, NULL),
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','filial_extra','Filial extra (1)', date_trunc('month', now())::date, 390, (date_trunc('month', now()) + interval '9 day')::date, 0, NULL, NULL),
('11111111-1111-1111-1111-111111111111','77777777-0000-0000-0000-000000000001','implantacao','Implantação da filial extra: Loja Norte', date_trunc('month', now())::date, 1500, (date_trunc('month', now()) + interval '19 day')::date, 500, CURRENT_DATE, 'pix');