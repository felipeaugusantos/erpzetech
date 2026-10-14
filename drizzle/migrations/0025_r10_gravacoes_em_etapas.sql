CREATE OR REPLACE FUNCTION public.exige_papel(p_papeis text[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
       SELECT 1 FROM unnest(p_papeis) r WHERE public.has_role(auth.uid(), r::public.app_role)) THEN
    RAISE EXCEPTION 'Seu perfil não pode fazer esta operação (exige: %)', array_to_string(p_papeis, ', ');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.exige_papel(text[]) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.fiscal_config DROP CONSTRAINT IF EXISTS fiscal_config_tenant_id_empresa_id_key;

CREATE OR REPLACE FUNCTION public.filial_extra_criar(
  p_nome text, p_codigo text DEFAULT NULL, p_cnpj text DEFAULT NULL, p_inscricao_estadual text DEFAULT NULL,
  p_cidade text DEFAULT NULL, p_estado text DEFAULT NULL, p_bairro text DEFAULT NULL, p_endereco text DEFAULT NULL,
  p_numero text DEFAULT NULL, p_telefone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_empresa uuid;
  v_filial uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador']);
  SELECT empresa_id INTO v_empresa FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL OR v_empresa IS NULL THEN RAISE EXCEPTION 'Empresa não identificada'; END IF;
  IF length(btrim(coalesce(p_nome, ''))) < 2 THEN RAISE EXCEPTION 'Informe o nome da filial'; END IF;
  INSERT INTO public.filiais (tenant_id, empresa_id, nome, codigo, cnpj, inscricao_estadual, cidade, estado, bairro,
                              endereco, numero, telefone, situacao)
  VALUES (v_tenant, v_empresa, btrim(p_nome), nullif(btrim(p_codigo), ''), nullif(btrim(p_cnpj), ''),
          nullif(btrim(p_inscricao_estadual), ''), nullif(btrim(p_cidade), ''), nullif(btrim(p_estado), ''),
          nullif(btrim(p_bairro), ''), nullif(btrim(p_endereco), ''), nullif(btrim(p_numero), ''),
          nullif(btrim(p_telefone), ''), 'implantacao')
  RETURNING id INTO v_filial;
  INSERT INTO public.depositos (tenant_id, filial_id, nome, tipo)
  VALUES (v_tenant, v_filial, 'Depósito ' || btrim(p_nome), 'loja');
  INSERT INTO public.fiscal_config (tenant_id, empresa_id, filial_id, serie, proximo_numero, ambiente, cfop_padrao)
  VALUES (v_tenant, v_empresa, v_filial, 2, 1, 'homologacao', '5102');
  RETURN v_filial;
END $$;
REVOKE ALL ON FUNCTION public.filial_extra_criar(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filial_extra_criar(text, text, text, text, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.orcamento_salvar(
  p_cliente_id uuid, p_itens jsonb, p_obra_id uuid DEFAULT NULL, p_vendedor_id uuid DEFAULT NULL,
  p_profissional_id uuid DEFAULT NULL, p_validade date DEFAULT NULL, p_condicao text DEFAULT NULL,
  p_prazo text DEFAULT NULL, p_desconto numeric DEFAULT 0, p_frete numeric DEFAULT 0, p_observacoes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_perfil record;
  v_orc uuid;
  it jsonb;
  v_qtd numeric; v_preco numeric; v_desc numeric; v_total numeric; v_sub numeric := 0;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos um item no orçamento';
  END IF;
  IF coalesce(p_desconto, 0) < 0 OR coalesce(p_frete, 0) < 0 THEN RAISE EXCEPTION 'Desconto e frete não podem ser negativos'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta empresa';
  END IF;
  IF p_obra_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.obras WHERE id = p_obra_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Obra não encontrada nesta empresa';
  END IF;
  IF p_vendedor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_vendedor_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Vendedor não encontrado nesta empresa';
  END IF;
  IF p_profissional_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profissionais WHERE id = p_profissional_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Profissional não encontrado nesta empresa';
  END IF;
  SELECT empresa_id, filial_id INTO v_perfil FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.orcamentos (tenant_id, empresa_id, filial_id, cliente_id, obra_id, vendedor_id, profissional_id,
                                 situacao, validade, condicao_pagamento, prazo_entrega, desconto, frete, observacoes)
  VALUES (v_tenant, v_perfil.empresa_id, v_perfil.filial_id, p_cliente_id, p_obra_id,
          coalesce(p_vendedor_id, auth.uid()), p_profissional_id, 'rascunho', p_validade,
          nullif(p_condicao, ''), nullif(p_prazo, ''), coalesce(p_desconto, 0), coalesce(p_frete, 0),
          nullif(p_observacoes, ''))
  RETURNING id INTO v_orc;
  FOR it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := (it ->> 'quantidade')::numeric;
    v_preco := coalesce((it ->> 'preco_unitario')::numeric, 0);
    v_desc := coalesce((it ->> 'desconto')::numeric, 0);
    IF v_qtd IS NULL OR v_qtd <= 0 THEN RAISE EXCEPTION 'Quantidade do item deve ser maior que zero'; END IF;
    IF v_preco < 0 OR v_desc < 0 THEN RAISE EXCEPTION 'Preço e desconto do item não podem ser negativos'; END IF;
    v_total := round(v_qtd * v_preco - v_desc, 2);
    IF v_total < 0 THEN RAISE EXCEPTION 'Desconto do item maior que o valor do item'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = (it ->> 'produto_id')::uuid AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Produto não encontrado nesta empresa';
    END IF;
    INSERT INTO public.orcamento_itens (tenant_id, orcamento_id, produto_id, quantidade, unidade, preco_unitario, desconto, total)
    VALUES (v_tenant, v_orc, (it ->> 'produto_id')::uuid, v_qtd, it ->> 'unidade', v_preco, v_desc, v_total);
    v_sub := v_sub + v_total;
  END LOOP;
  UPDATE public.orcamentos SET subtotal = v_sub, total = GREATEST(0, v_sub - desconto + frete) WHERE id = v_orc;
  RETURN v_orc;
END $$;
REVOKE ALL ON FUNCTION public.orcamento_salvar(uuid, jsonb, uuid, uuid, uuid, date, text, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_salvar(uuid, jsonb, uuid, uuid, uuid, date, text, text, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.separacao_salvar(p_pedido_id uuid, p_itens jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb; v_qtd numeric; v_n integer := 0;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'estoquista']);
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN RAISE EXCEPTION 'Informe os itens da separação'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := (it ->> 'quantidade_separada')::numeric;
    IF v_qtd IS NULL OR v_qtd < 0 THEN RAISE EXCEPTION 'Quantidade separada inválida'; END IF;
    UPDATE public.pedido_itens SET quantidade_separada = v_qtd
     WHERE id = (it ->> 'id')::uuid AND pedido_id = p_pedido_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não pertence a este pedido'; END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.conferencia_salvar(p_pedido_id uuid, p_itens jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb; v_qtd numeric; v_n integer := 0;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'estoquista']);
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN RAISE EXCEPTION 'Informe os itens da conferência'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := (it ->> 'quantidade_conferida')::numeric;
    IF v_qtd IS NULL OR v_qtd < 0 THEN RAISE EXCEPTION 'Quantidade conferida inválida'; END IF;
    UPDATE public.pedido_itens
       SET quantidade_conferida = v_qtd, divergencia = nullif(btrim(coalesce(it ->> 'divergencia', '')), '')
     WHERE id = (it ->> 'id')::uuid AND pedido_id = p_pedido_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não pertence a este pedido'; END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.separacao_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conferencia_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.separacao_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conferencia_salvar(uuid, jsonb) TO authenticated;