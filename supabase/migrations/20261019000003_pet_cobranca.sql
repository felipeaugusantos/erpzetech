-- Pet shop (PR 4): cobrança do atendimento pronto ("Retirar e cobrar"), comissão do profissional e NFS-e em rascunho.
-- A venda é feita pela frente de caixa de sempre (o operador escolhe a forma de pagamento); depois pet_agenda_retirar
-- confere que a venda é aquela mesma, liga os dois, calcula a comissão e deixa a NFS-e do serviço em rascunho.

CREATE UNIQUE INDEX IF NOT EXISTS pet_agendamentos_venda_idx ON public.pet_agendamentos (venda_id) WHERE venda_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pet_comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  agendamento_id uuid NOT NULL UNIQUE REFERENCES public.pet_agendamentos(id),
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id),
  base numeric(14,2) NOT NULL CHECK (base >= 0),
  percentual numeric(5,2) NOT NULL CHECK (percentual BETWEEN 0 AND 100),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  situacao text NOT NULL DEFAULT 'a_aprovar' CHECK (situacao IN ('a_aprovar', 'aprovada', 'paga', 'cancelada')),
  aprovada_em timestamptz,
  aprovada_por uuid,
  pago_em timestamptz,
  pago_por uuid,
  forma_pagamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_comissoes_prof_idx ON public.pet_comissoes (tenant_id, profissional_id, situacao);

ALTER TABLE public.pet_comissoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_comissoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pet_comissoes TO authenticated;
GRANT ALL ON public.pet_comissoes TO service_role;
CREATE POLICY pet_comissoes_ler ON public.pet_comissoes FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro')));
CREATE POLICY salao_restrito ON public.pet_comissoes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
CREATE TRIGGER trg_pet_comissoes_updated BEFORE UPDATE ON public.pet_comissoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- NFS-e do serviço, como rascunho (com as pendências de configuração) ou pronta, no molde da locação.
-- Interna: só é chamada por pet_agenda_retirar.
CREATE OR REPLACE FUNCTION public._pet_nfse_rascunho(p_agendamento_id uuid, p_pedido_id uuid, p_liquido numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.pet_agendamentos%ROWTYPE;
  v_ped record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_bruto numeric;
BEGIN
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  SELECT * INTO v_cli FROM public.clientes WHERE id = a.cliente_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas
   WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_fil_cfg FROM public.fiscal_config WHERE tenant_id = v_tenant AND filial_id = v_ped.filial_id LIMIT 1;
  SELECT * INTO v_emp_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND filial_id IS NULL AND (empresa_id = v_emp.id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;
  IF v_fil_cfg IS NULL AND v_emp_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_emp_cfg;
  END IF;
  -- registro não encontrado vira linha de campos nulos: escolhe pela chave, não por coalesce
  IF v_fil_cfg.id IS NOT NULL THEN v_cfg := v_fil_cfg; ELSE v_cfg := v_emp_cfg; END IF;

  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''), coalesce(v_fil.cidade, v_emp.cidade, ''));

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\D', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do tutor inválido ou ausente');
  END IF;
  IF coalesce(v_emp.cnpj, '') = '' THEN v_pend := array_append(v_pend, 'CNPJ da empresa ausente'); END IF;
  IF coalesce(v_emp.inscricao_municipal, '') = '' THEN
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  END IF;
  IF v_codigo = '' THEN v_pend := array_append(v_pend, 'Código do serviço municipal não configurado'); END IF;
  IF v_iss <= 0 THEN v_pend := array_append(v_pend, 'Alíquota de ISS não configurada'); END IF;
  IF v_cert = '' THEN v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado'); END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    UPDATE public.fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = v_cfg.id;
  END IF;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.pet_agendamento_itens WHERE agendamento_id = a.id;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, a.cliente_id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    'Prestação de serviço — banho, tosa e estética de animais', NULL,
    v_bruto, greatest(v_bruto - p_liquido, 0), p_liquido, round(p_liquido * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj, 'inscricao_municipal', v_emp.inscricao_municipal,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero, 'bairro', v_cli.bairro, 'cidade', v_cli.cidade,
      'estado', v_cli.estado, 'cep', v_cli.cep, 'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      ELSE 'NFS-e em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_pedidos (tenant_id, nfe_id, pedido_id) VALUES (v_tenant, v_nfe, p_pedido_id);

  INSERT INTO public.nfe_itens (tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total, cst_csosn)
  SELECT v_tenant, v_nfe, s.nome || ' — ' || pt.nome, 'UN', 1, i.preco_aplicado, i.preco_aplicado, '400'
    FROM public.pet_agendamento_itens i
    JOIN public.pet_servicos s ON s.id = i.servico_id
    JOIN public.pets pt ON pt.id = a.pet_id
   WHERE i.agendamento_id = a.id;

  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN v_nfe;
END $$;
REVOKE ALL ON FUNCTION public._pet_nfse_rascunho(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Retirar e cobrar: liga o atendimento "pronto" à venda do caixa (por pedido ou pela chave da venda).
CREATE OR REPLACE FUNCTION public.pet_agenda_retirar(p_agendamento_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.pet_agendamentos%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  r record;
  v_bruto numeric; v_liquido numeric; v_valor numeric; v_nfe uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao = 'retirado' AND a.venda_id IS NOT NULL AND (a.venda_id = p_pedido_id OR p_pedido_id IS NULL) THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    RETURN jsonb_build_object('pedido_id', a.venda_id, 'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = a.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1), 'repetido', true);
  END IF;
  IF a.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para retirar e cobrar atendimento pronto (situação atual: %)', a.situacao; END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A cobrança do pet shop é feita na frente de caixa'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_agendamentos o WHERE o.venda_id = v_pedido AND o.id <> a.id) THEN
    RAISE EXCEPTION 'Esta venda já cobrou outro atendimento';
  END IF;

  -- a venda precisa ter cada serviço do atendimento, pelo valor combinado
  FOR r IN SELECT i.servico_id, i.preco_aplicado, s.produto_id, s.nome
             FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
            WHERE i.agendamento_id = a.id LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                    AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
      RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
    END IF;
  END LOOP;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.pet_agendamento_itens WHERE agendamento_id = a.id;
  -- o desconto da venda reparte-se por igual entre todos os itens: o serviço fica com a parte proporcional
  v_liquido := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(v_bruto * v_ped.total / v_ped.subtotal, 2) ELSE v_bruto END;

  UPDATE public.pet_agendamentos SET situacao = 'retirado', venda_id = v_pedido WHERE id = a.id;

  SELECT * INTO pf FROM public.pet_profissionais WHERE id = a.profissional_id;
  v_valor := round(v_liquido * pf.comissao_percentual / 100, 2);
  IF v_valor > 0 THEN
    INSERT INTO public.pet_comissoes (tenant_id, profissional_id, agendamento_id, pedido_id, base, percentual, valor)
    VALUES (v_tenant, a.profissional_id, a.id, v_pedido, v_liquido, pf.comissao_percentual, v_valor)
    -- cobrar de novo depois de uma venda cancelada reativa a comissão cancelada (uma por atendimento)
    ON CONFLICT (agendamento_id) DO UPDATE
       SET pedido_id = EXCLUDED.pedido_id, base = EXCLUDED.base, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor,
           situacao = 'a_aprovar', aprovada_em = NULL, aprovada_por = NULL
     WHERE public.pet_comissoes.situacao = 'cancelada';
  END IF;

  v_nfe := public._pet_nfse_rascunho(a.id, v_pedido, v_liquido);
  RETURN jsonb_build_object('pedido_id', v_pedido, 'nfe_id', v_nfe, 'comissao', v_valor, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid) TO authenticated;

-- Venda cancelada no caixa: o atendimento volta a "pronto", a comissão não paga é cancelada e o rascunho da NFS-e sai.
CREATE OR REPLACE FUNCTION public.pet_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado'
     AND EXISTS (SELECT 1 FROM public.pet_agendamentos WHERE venda_id = NEW.id) THEN
    UPDATE public.pet_comissoes SET situacao = 'cancelada' WHERE pedido_id = NEW.id AND situacao IN ('a_aprovar', 'aprovada');
    DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
    UPDATE public.pet_agendamentos SET situacao = 'pronto', venda_id = NULL WHERE venda_id = NEW.id AND situacao = 'retirado';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pet_venda_cancelada() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_pet_venda_cancelada AFTER UPDATE OF situacao ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pet_venda_cancelada();

-- Comissão: a_aprovar → aprovada → paga (o pagamento em si é feito fora; aqui fica o registro de quem e quando).
CREATE OR REPLACE FUNCTION public.pet_comissao_aprovar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  UPDATE public.pet_comissoes SET situacao = 'aprovada', aprovada_em = now(), aprovada_por = auth.uid()
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'a_aprovar';
  IF NOT FOUND THEN RAISE EXCEPTION 'Comissão não encontrada ou já tratada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_comissao_aprovar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_comissao_aprovar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_comissao_pagar(p_id uuid, p_forma text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  UPDATE public.pet_comissoes SET situacao = 'paga', pago_em = now(), pago_por = auth.uid(), forma_pagamento = nullif(btrim(p_forma), '')
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'aprovada';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só dá para pagar comissão aprovada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_comissao_pagar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_comissao_pagar(uuid, text) TO authenticated;

-- Relatório "Serviços por profissional" (atendimentos retirados no período).
CREATE OR REPLACE FUNCTION public.pet_servicos_por_profissional(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Informe um período válido'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(l ORDER BY l ->> 'nome') FROM (
      SELECT jsonb_build_object(
        'profissional_id', pf.id, 'nome', pf.nome,
        'atendimentos', count(DISTINCT a.id),
        'servicos', coalesce(sum(it.qtd), 0),
        'faturamento', coalesce(sum(it.valor), 0),
        'comissao_a_aprovar', coalesce((SELECT sum(c.valor) FROM public.pet_comissoes c JOIN public.pet_agendamentos x ON x.id = c.agendamento_id
                                         WHERE c.profissional_id = pf.id AND c.situacao = 'a_aprovar' AND x.inicio::date BETWEEN p_de AND p_ate), 0),
        'comissao_aprovada', coalesce((SELECT sum(c.valor) FROM public.pet_comissoes c JOIN public.pet_agendamentos x ON x.id = c.agendamento_id
                                        WHERE c.profissional_id = pf.id AND c.situacao = 'aprovada' AND x.inicio::date BETWEEN p_de AND p_ate), 0),
        'comissao_paga', coalesce((SELECT sum(c.valor) FROM public.pet_comissoes c JOIN public.pet_agendamentos x ON x.id = c.agendamento_id
                                    WHERE c.profissional_id = pf.id AND c.situacao = 'paga' AND x.inicio::date BETWEEN p_de AND p_ate), 0)
      ) AS l
        FROM public.pet_profissionais pf
        JOIN public.pet_agendamentos a ON a.profissional_id = pf.id AND a.tenant_id = v_tenant AND a.situacao = 'retirado'
             AND a.inicio::date BETWEEN p_de AND p_ate
        LEFT JOIN LATERAL (SELECT count(*) AS qtd, sum(i.preco_aplicado) AS valor FROM public.pet_agendamento_itens i WHERE i.agendamento_id = a.id) it ON true
       WHERE pf.tenant_id = v_tenant
       GROUP BY pf.id, pf.nome
    ) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_servicos_por_profissional(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_servicos_por_profissional(date, date) TO authenticated;

-- NFC-e: só a mercadoria entra (serviço vai para a NFS-e). Venda só de serviço não gera NFC-e.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'nfce_criar';
  IF def IS NULL THEN RAISE EXCEPTION 'nfce_criar não encontrada'; END IF;
  IF position('controla_estoque' IN def) > 0 THEN RETURN; END IF;
  nova := def;
  -- 1) declaração
  nova := replace(nova, E'  v_total numeric;\nBEGIN', E'  v_total numeric;\n  v_serv numeric := 0;\nBEGIN');
  -- 2) "tem itens" olha só a mercadoria
  nova := replace(nova, E'IF NOT EXISTS (SELECT 1 FROM public.pedido_itens WHERE pedido_id = p_pedido_id) THEN',
                        E'IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi JOIN public.produtos pp ON pp.id = pi.produto_id WHERE pi.pedido_id = p_pedido_id AND pp.controla_estoque) THEN');
  -- 3) conferência dos itens: só mercadoria
  nova := replace(nova, E'                 WHERE i.pedido_id = p_pedido_id LOOP', E'                 WHERE i.pedido_id = p_pedido_id AND p.controla_estoque LOOP');
  -- 4) totais: tira a parte do serviço (e do desconto proporcional)
  nova := replace(nova, E'  v_total := coalesce(v_ped.total, 0);\n',
    E'  v_total := coalesce(v_ped.total, 0);\n'
    || E'  SELECT coalesce(sum(i.total), 0) INTO v_serv FROM public.pedido_itens i JOIN public.produtos pp ON pp.id = i.produto_id\n'
    || E'   WHERE i.pedido_id = p_pedido_id AND NOT pp.controla_estoque;\n'
    || E'  IF v_serv > 0 THEN\n'
    || E'    IF v_prod <= 0 THEN RAISE EXCEPTION ''A venda só tem serviços: a nota é de serviço (NFS-e)''; END IF;\n'
    || E'    v_desc := round(v_desc * v_prod / (v_prod + v_serv), 2);\n'
    || E'    v_total := greatest(v_prod - v_desc + v_frete, 0);\n'
    || E'  END IF;\n');
  -- 5) itens da nota: só mercadoria
  nova := replace(nova, E'   WHERE i.pedido_id = p_pedido_id;\n\n  PERFORM public.nfe_calcular_impostos(v_nfe);',
                        E'   WHERE i.pedido_id = p_pedido_id AND p.controla_estoque;\n\n  PERFORM public.nfe_calcular_impostos(v_nfe);');
  IF (length(nova) - length(replace(nova, 'controla_estoque', ''))) / length('controla_estoque') <> 4 THEN
    RAISE EXCEPTION 'nfce_criar: algum trecho esperado não foi encontrado';
  END IF;
  EXECUTE nova;
END $$;
