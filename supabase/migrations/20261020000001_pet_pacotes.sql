-- Pet shop, Fase 2 (PR 6): pacotes de banho. Cada pacote é de um pet, vale 30, 60 ou 90 dias e é vendido adiantado na
-- frente de caixa. Na hora de retirar o pet, o banho sai do pacote em vez de ser cobrado. A NFS-e do pacote nasce na
-- venda (quando o dinheiro entra); o uso não gera outra nota. A comissão do profissional usa o valor de cada uso.

-- Retirada só com pacote não tem venda no caixa: a comissão passa a aceitar pedido vazio.
ALTER TABLE public.pet_comissoes ALTER COLUMN pedido_id DROP NOT NULL;

-- ============ modelos de pacote ============
CREATE TABLE IF NOT EXISTS public.pet_pacote_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id),
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 2 AND 52),
  preco numeric(14,2) NOT NULL CHECK (preco > 0),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_pacote_modelos_nome_idx ON public.pet_pacote_modelos (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS pet_pacote_modelos_produto_idx ON public.pet_pacote_modelos (produto_id);

-- ============ pacotes vendidos (um por pet) ============
CREATE TABLE IF NOT EXISTS public.pet_pacotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  modelo_id uuid NOT NULL REFERENCES public.pet_pacote_modelos(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  -- o que o tutor pagou pelo pacote (já com a parte do desconto da venda)
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  validade_dias integer NOT NULL CHECK (validade_dias IN (30, 60, 90)),
  comprado_em date NOT NULL,
  vence_em date NOT NULL,
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'cancelado')),
  motivo text,
  venda_id uuid NOT NULL REFERENCES public.pedidos(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venda_id)
);
CREATE INDEX IF NOT EXISTS pet_pacotes_pet_idx ON public.pet_pacotes (tenant_id, pet_id, situacao, vence_em);

-- Cada uso é um banho tirado do pacote; "desfeito" devolve o banho ao saldo.
CREATE TABLE IF NOT EXISTS public.pet_pacote_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pacote_id uuid NOT NULL REFERENCES public.pet_pacotes(id),
  agendamento_id uuid NOT NULL REFERENCES public.pet_agendamentos(id),
  agendamento_item_id uuid NOT NULL REFERENCES public.pet_agendamento_itens(id),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  usado_em date NOT NULL,
  desfeito boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_pacote_usos_item_idx ON public.pet_pacote_usos (agendamento_item_id) WHERE NOT desfeito;
CREATE INDEX IF NOT EXISTS pet_pacote_usos_pacote_idx ON public.pet_pacote_usos (pacote_id) WHERE NOT desfeito;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_pacote_modelos', 'pet_pacotes', 'pet_pacote_usos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER trg_pet_pacote_modelos_updated BEFORE UPDATE ON public.pet_pacote_modelos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
  EXECUTE 'CREATE TRIGGER trg_pet_pacotes_updated BEFORE UPDATE ON public.pet_pacotes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- Quantos banhos ainda restam no pacote.
CREATE OR REPLACE FUNCTION public._pet_pacote_restam(p_pacote_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT p.quantidade - (SELECT count(*)::int FROM public.pet_pacote_usos u WHERE u.pacote_id = p.id AND NOT u.desfeito)
    FROM public.pet_pacotes p WHERE p.id = p_pacote_id
$$;
REVOKE ALL ON FUNCTION public._pet_pacote_restam(uuid) FROM PUBLIC, anon, authenticated;

-- ============ modelo de pacote (cria também o produto sem estoque que vai para o caixa) ============
CREATE OR REPLACE FUNCTION public.pet_pacote_modelo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_serv uuid := nullif(p_dados ->> 'servico_id', '')::uuid;
  v_qtd integer := nullif(p_dados ->> 'quantidade', '')::integer;
  v_preco numeric := nullif(p_dados ->> 'preco', '')::numeric;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_prod uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do pacote'; END IF;
  IF v_qtd IS NULL OR v_qtd < 2 OR v_qtd > 52 THEN RAISE EXCEPTION 'O pacote precisa ter de 2 a 52 serviços'; END IF;
  IF v_preco IS NULL OR v_preco <= 0 THEN RAISE EXCEPTION 'Informe o preço do pacote'; END IF;
  PERFORM 1 FROM public.pet_servicos WHERE id = v_serv AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o serviço do pacote'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_pacote_modelo:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_pacote_modelos m WHERE m.tenant_id = v_tenant AND lower(btrim(m.nome)) = lower(v_nome) AND m.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um pacote com este nome';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque, ativo)
    VALUES (v_tenant, '', v_nome, 'UN', round(v_preco, 2), false, v_ativo) RETURNING id INTO v_prod;
    INSERT INTO public.pet_pacote_modelos (tenant_id, nome, servico_id, quantidade, preco, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_serv, v_qtd, round(v_preco, 2), v_prod, v_ativo) RETURNING id INTO v_id;
  ELSE
    -- pacotes já vendidos guardam o que foi combinado; mudar o modelo vale só para as próximas vendas
    UPDATE public.pet_pacote_modelos SET nome = v_nome, servico_id = v_serv, quantidade = v_qtd, preco = round(v_preco, 2), ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant RETURNING produto_id INTO v_prod;
    IF v_prod IS NULL THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;
    UPDATE public.produtos SET descricao = v_nome, preco_venda = round(v_preco, 2), ativo = v_ativo WHERE id = v_prod AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_pacote_modelo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pacote_modelo_salvar(jsonb) TO authenticated;

-- ============ NFS-e genérica em rascunho (agora usada pelo atendimento e pelo pacote) ============
-- p_itens: [{descricao, valor}] (valores cheios); p_liquido: o que de fato foi cobrado, já com o desconto proporcional.
CREATE OR REPLACE FUNCTION public._pet_nfse_criar(p_cliente_id uuid, p_pedido_id uuid, p_itens jsonb, p_liquido numeric, p_natureza text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ped record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_bruto numeric;
BEGIN
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  SELECT * INTO v_cli FROM public.clientes WHERE id = p_cliente_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
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

  SELECT coalesce(sum((i ->> 'valor')::numeric), 0) INTO v_bruto FROM jsonb_array_elements(p_itens) i;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, p_cliente_id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    p_natureza, NULL,
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
  SELECT v_tenant, v_nfe, i ->> 'descricao', 'UN', 1, (i ->> 'valor')::numeric, (i ->> 'valor')::numeric, '400'
    FROM jsonb_array_elements(p_itens) i;

  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN v_nfe;
END $$;
REVOKE ALL ON FUNCTION public._pet_nfse_criar(uuid, uuid, jsonb, numeric, text) FROM PUBLIC, anon, authenticated;

-- ============ venda do pacote: confere a venda do caixa e cria o pacote do pet ============
CREATE OR REPLACE FUNCTION public.pet_pacote_vender(
  p_modelo_id uuid, p_pet_id uuid, p_validade_dias integer, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  m public.pet_pacote_modelos%ROWTYPE;
  pt public.pets%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  v_existente uuid; v_valor numeric; v_id uuid; v_nfe uuid; v_serv text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_validade_dias NOT IN (30, 60, 90) THEN RAISE EXCEPTION 'A validade do pacote é de 30, 60 ou 90 dias'; END IF;
  SELECT * INTO m FROM public.pet_pacote_modelos WHERE id = p_modelo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;
  IF NOT m.ativo THEN RAISE EXCEPTION 'Este pacote não está à venda'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  IF NOT pt.ativo THEN RAISE EXCEPTION 'Este pet está inativo'; END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_pacote_venda:' || v_pedido::text, 0));
  -- repetir a chamada (resposta perdida) devolve o mesmo pacote
  SELECT id INTO v_existente FROM public.pet_pacotes WHERE venda_id = v_pedido;
  IF v_existente IS NOT NULL THEN
    RETURN jsonb_build_object('pacote_id', v_existente, 'repetido', true);
  END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A venda do pacote é feita na frente de caixa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = m.produto_id
                  AND pi.preco_unitario = m.preco AND pi.quantidade = 1) THEN
    RAISE EXCEPTION 'A venda não traz o pacote "%" uma vez, por %', m.nome, m.preco;
  END IF;

  v_valor := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(m.preco * v_ped.total / v_ped.subtotal, 2) ELSE m.preco END;
  INSERT INTO public.pet_pacotes (tenant_id, modelo_id, pet_id, cliente_id, servico_id, quantidade, valor, validade_dias, comprado_em, vence_em, venda_id)
  VALUES (v_tenant, m.id, pt.id, pt.cliente_id, m.servico_id, m.quantidade, v_valor, p_validade_dias, v_hoje, v_hoje + p_validade_dias, v_pedido)
  RETURNING id INTO v_id;

  SELECT nome INTO v_serv FROM public.pet_servicos WHERE id = m.servico_id;
  v_nfe := public._pet_nfse_criar(pt.cliente_id, v_pedido,
             jsonb_build_array(jsonb_build_object('descricao', m.nome || ' (' || m.quantidade || ' x ' || coalesce(v_serv, 'serviço') || ') — ' || pt.nome, 'valor', m.preco)),
             v_valor, 'Prestação de serviço — pacote de banho e tosa de animais');
  RETURN jsonb_build_object('pacote_id', v_id, 'nfe_id', v_nfe, 'vence_em', v_hoje + p_validade_dias, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.pet_pacote_vender(uuid, uuid, integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pacote_vender(uuid, uuid, integer, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_pacote_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF nullif(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  UPDATE public.pet_pacotes SET situacao = 'cancelado', motivo = btrim(p_motivo)
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pacote não encontrado ou já cancelado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.pet_pacote_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pacote_cancelar(uuid, text) TO authenticated;

-- ============ cobertura: quais serviços do atendimento saem de um pacote do pet ============
-- Usa o pacote ativo, dentro da validade e com saldo, que vence primeiro.
CREATE OR REPLACE FUNCTION public._pet_cobertura(p_agendamento_id uuid)
RETURNS TABLE (item_id uuid, servico_id uuid, pacote_id uuid, restam integer, vence_em date, valor_uso numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT i.id, i.servico_id, k.id, k.restam, k.vence_em, round(k.valor / k.quantidade, 2)
    FROM public.pet_agendamento_itens i
    JOIN public.pet_agendamentos a ON a.id = i.agendamento_id
    JOIN LATERAL (
      SELECT p.id, p.vence_em, p.valor, p.quantidade, public._pet_pacote_restam(p.id) AS restam
        FROM public.pet_pacotes p
       WHERE p.tenant_id = a.tenant_id AND p.pet_id = a.pet_id AND p.servico_id = i.servico_id AND p.situacao = 'ativo'
         AND p.vence_em >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
         AND public._pet_pacote_restam(p.id) > 0
       ORDER BY p.vence_em, p.created_at
       LIMIT 1) k ON true
   WHERE a.id = p_agendamento_id
$$;
REVOKE ALL ON FUNCTION public._pet_cobertura(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pet_agenda_cobertura(p_agendamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM 1 FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'servico_id', c.servico_id, 'pacote_id', c.pacote_id,
                                                      'restam', c.restam, 'vence_em', c.vence_em))
                     FROM public._pet_cobertura(p_agendamento_id) c), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_cobertura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_cobertura(uuid) TO authenticated;

-- ============ retirar e cobrar, agora com pacote ============
DROP FUNCTION IF EXISTS public.pet_agenda_retirar(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._pet_nfse_rascunho(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION public.pet_agenda_retirar(
  p_agendamento_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL, p_usar_pacote boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  a public.pet_agendamentos%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  r record; c record;
  v_cobertos uuid[] := '{}';
  v_pagos jsonb := '[]'::jsonb;
  v_bruto_pago numeric := 0; v_liquido_pago numeric := 0; v_pacote_valor numeric := 0; v_base numeric; v_valor numeric;
  v_nfe uuid; v_avisos jsonb := '[]'::jsonb; v_pet text; v_depois integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  -- o pacote é do pet: dois atendimentos do mesmo pet não podem gastar o mesmo saldo ao mesmo tempo
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_pacote:' || a.pet_id::text, 0));
  IF a.situacao = 'retirado'
     AND ((a.venda_id IS NOT NULL AND (a.venda_id = p_pedido_id OR p_pedido_id IS NULL))
          OR (a.venda_id IS NULL AND p_pedido_id IS NULL AND p_chave IS NULL)) THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    RETURN jsonb_build_object('pedido_id', a.venda_id, 'repetido', true,
      'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = a.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1));
  END IF;
  IF a.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para retirar e cobrar atendimento pronto (situação atual: %)', a.situacao; END IF;

  IF p_usar_pacote THEN
    SELECT coalesce(array_agg(item_id), '{}') INTO v_cobertos FROM public._pet_cobertura(a.id);
  END IF;
  SELECT coalesce(sum(i.preco_aplicado), 0) INTO v_bruto_pago
    FROM public.pet_agendamento_itens i WHERE i.agendamento_id = a.id AND NOT (i.id = ANY (v_cobertos));

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL AND v_bruto_pago > 0 THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;

  IF v_pedido IS NOT NULL THEN
    SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
    IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
    IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
    IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A cobrança do pet shop é feita na frente de caixa'; END IF;
    IF EXISTS (SELECT 1 FROM public.pet_agendamentos o WHERE o.venda_id = v_pedido AND o.id <> a.id)
       OR EXISTS (SELECT 1 FROM public.pet_pacotes pp WHERE pp.venda_id = v_pedido) THEN
      RAISE EXCEPTION 'Esta venda já foi usada em outra cobrança do pet shop';
    END IF;
    -- a venda precisa ter cada serviço cobrado do atendimento, pelo valor combinado
    FOR r IN SELECT i.id, i.preco_aplicado, s.produto_id, s.nome
               FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
              WHERE i.agendamento_id = a.id AND NOT (i.id = ANY (v_cobertos)) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                      AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
        RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
      END IF;
    END LOOP;
    -- o desconto da venda reparte-se por igual entre todos os itens: o serviço fica com a parte proporcional
    v_liquido_pago := CASE WHEN v_bruto_pago = 0 THEN 0
                           WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(v_bruto_pago * v_ped.total / v_ped.subtotal, 2)
                           ELSE v_bruto_pago END;
  END IF;

  UPDATE public.pet_agendamentos SET situacao = 'retirado', venda_id = v_pedido WHERE id = a.id;
  SELECT nome INTO v_pet FROM public.pets WHERE id = a.pet_id;

  -- banhos que saem do pacote
  IF p_usar_pacote THEN
    FOR c IN SELECT * FROM public._pet_cobertura(a.id) LOOP
      INSERT INTO public.pet_pacote_usos (tenant_id, pacote_id, agendamento_id, agendamento_item_id, valor, usado_em)
      VALUES (v_tenant, c.pacote_id, a.id, c.item_id, c.valor_uso, v_hoje);
      v_pacote_valor := v_pacote_valor + c.valor_uso;
      v_depois := c.restam - 1;
      IF v_depois <= 1 THEN
        v_avisos := v_avisos || jsonb_build_object('pacote_id', c.pacote_id, 'pet', v_pet, 'restam', v_depois,
                      'servico', (SELECT nome FROM public.pet_servicos WHERE id = c.servico_id));
      END IF;
    END LOOP;
  END IF;

  -- comissão: serviços cobrados (já com o desconto) mais o valor de cada banho tirado do pacote
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = a.profissional_id;
  v_base := v_liquido_pago + v_pacote_valor;
  v_valor := round(v_base * pf.comissao_percentual / 100, 2);
  IF v_valor > 0 THEN
    INSERT INTO public.pet_comissoes (tenant_id, profissional_id, agendamento_id, pedido_id, base, percentual, valor)
    VALUES (v_tenant, a.profissional_id, a.id, v_pedido, v_base, pf.comissao_percentual, v_valor)
    ON CONFLICT (agendamento_id) DO UPDATE
       SET pedido_id = EXCLUDED.pedido_id, base = EXCLUDED.base, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor,
           situacao = 'a_aprovar', aprovada_em = NULL, aprovada_por = NULL
     WHERE public.pet_comissoes.situacao = 'cancelada';
  END IF;

  -- NFS-e só do que foi cobrado agora (o pacote já teve a nota na venda dele)
  IF v_liquido_pago > 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('descricao', s.nome || ' — ' || v_pet, 'valor', i.preco_aplicado)), '[]'::jsonb) INTO v_pagos
      FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
     WHERE i.agendamento_id = a.id AND NOT (i.id = ANY (v_cobertos));
    v_nfe := public._pet_nfse_criar(a.cliente_id, v_pedido, v_pagos, v_liquido_pago, 'Prestação de serviço — banho, tosa e estética de animais');
  END IF;

  RETURN jsonb_build_object('pedido_id', v_pedido, 'nfe_id', v_nfe, 'comissao', v_valor, 'repetido', false,
                            'usos', coalesce(array_length(v_cobertos, 1), 0), 'avisos', v_avisos);
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_retirar(uuid, uuid, uuid, boolean) TO authenticated;

-- Retirada feita só com pacote (sem venda no caixa) pode ser desfeita pela gestão; com venda, cancela-se a venda.
CREATE OR REPLACE FUNCTION public.pet_agenda_desfazer_retirada(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a public.pet_agendamentos%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao <> 'retirado' THEN RAISE EXCEPTION 'O atendimento não está retirado'; END IF;
  IF a.venda_id IS NOT NULL THEN RAISE EXCEPTION 'Este atendimento foi cobrado no caixa: cancele a venda por lá'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_comissoes WHERE agendamento_id = a.id AND situacao = 'paga') THEN
    RAISE EXCEPTION 'A comissão deste atendimento já foi paga';
  END IF;
  UPDATE public.pet_pacote_usos SET desfeito = true WHERE agendamento_id = a.id AND NOT desfeito;
  UPDATE public.pet_comissoes SET situacao = 'cancelada' WHERE agendamento_id = a.id AND situacao IN ('a_aprovar', 'aprovada');
  UPDATE public.pet_agendamentos SET situacao = 'pronto' WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_desfazer_retirada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_desfazer_retirada(uuid) TO authenticated;

-- Venda cancelada no caixa: atendimento volta a "pronto" (devolvendo o banho ao pacote), comissão não paga é cancelada,
-- pacote vendido nela é cancelado e o rascunho da NFS-e sai.
CREATE OR REPLACE FUNCTION public.pet_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ag boolean; v_pac boolean;
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado' THEN
    v_ag := EXISTS (SELECT 1 FROM public.pet_agendamentos WHERE venda_id = NEW.id);
    v_pac := EXISTS (SELECT 1 FROM public.pet_pacotes WHERE venda_id = NEW.id);
    IF v_ag OR v_pac THEN
      UPDATE public.pet_pacote_usos SET desfeito = true
       WHERE NOT desfeito AND agendamento_id IN (SELECT id FROM public.pet_agendamentos WHERE venda_id = NEW.id);
      UPDATE public.pet_comissoes SET situacao = 'cancelada' WHERE pedido_id = NEW.id AND situacao IN ('a_aprovar', 'aprovada');
      UPDATE public.pet_agendamentos SET situacao = 'pronto', venda_id = NULL WHERE venda_id = NEW.id AND situacao = 'retirado';
      UPDATE public.pet_pacotes SET situacao = 'cancelado', motivo = 'Venda cancelada no caixa' WHERE venda_id = NEW.id AND situacao = 'ativo';
      DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pet_venda_cancelada() FROM PUBLIC, anon, authenticated;
