-- Faixas de desconto no PDV, no orçamento e no pedido novo.
-- Mesma regra da frente de caixa (desconto_limite_itens): acima do que o perfil pode dar no grupo e na marca do produto,
-- o desconto só passa com a autorização de um gestor (gestor_autorizacoes, uso único, 5 minutos).
-- O PDV ganha pdv_venda_com_faixas; orcamento_salvar e criar_pedido_direto ganham o parâmetro p_autorizacao (por último,
-- opcional). As funções antigas são removidas para não ficarem duas versões com o mesmo nome.
-- Limite conhecido: pdv_venda continua chamável direto (o PDV e outros fluxos, como o pet shop, ainda a usam); a tela do
-- PDV passa a usar pdv_venda_com_faixas.

-- Confere o desconto de um conjunto de itens. Devolve o gestor que autorizou (ou nulo quando não precisou).
-- p_itens: [{produto_id, quantidade, preco_unitario}]; p_desconto_total: tudo o que se está dando de desconto, em R$.
CREATE OR REPLACE FUNCTION public.exige_desconto_autorizado(p_itens jsonb, p_desconto_total numeric, p_autorizacao uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_permitido numeric;
BEGIN
  IF coalesce(p_desconto_total, 0) <= 0 THEN RETURN NULL; END IF;
  v_permitido := public.desconto_limite_itens(p_itens);
  IF p_desconto_total <= v_permitido THEN RETURN NULL; END IF;
  IF p_autorizacao IS NULL THEN
    RAISE EXCEPTION 'Desconto acima do permitido (R$ %): exige senha do gestor', v_permitido;
  END IF;
  RETURN public.consumir_autorizacao(p_autorizacao, 'desconto');
END $$;
REVOKE ALL ON FUNCTION public.exige_desconto_autorizado(jsonb, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exige_desconto_autorizado(jsonb, numeric, uuid) TO service_role;

-- Venda do PDV com a faixa de desconto: confere (e consome a autorização) e vende pelo mesmo caminho do PDV.
CREATE OR REPLACE FUNCTION public.pdv_venda_com_faixas(
  p_deposito_id uuid, p_itens jsonb, p_forma forma_pagamento DEFAULT 'dinheiro'::forma_pagamento,
  p_cliente_id uuid DEFAULT NULL::uuid, p_desconto numeric DEFAULT 0, p_parcelas integer DEFAULT 1,
  p_primeiro_vencimento date DEFAULT NULL::date, p_observacao text DEFAULT NULL::text,
  p_autorizacao uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gestor uuid;
  v_pedido uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  IF jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Itens em formato inválido'; END IF;
  v_gestor := public.exige_desconto_autorizado(p_itens, p_desconto, p_autorizacao);
  v_pedido := public.pdv_venda(p_deposito_id, p_itens, p_forma, p_cliente_id, p_desconto, p_parcelas, p_primeiro_vencimento, p_observacao);
  IF v_gestor IS NOT NULL THEN
    UPDATE public.pedidos SET autorizado_por = v_gestor WHERE id = v_pedido;
  END IF;
  RETURN v_pedido;
END $$;
REVOKE ALL ON FUNCTION public.pdv_venda_com_faixas(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pdv_venda_com_faixas(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, text, uuid) TO authenticated;

-- Orçamento: salvar passa a conferir o desconto.
DROP FUNCTION IF EXISTS public.orcamento_salvar(uuid, jsonb, uuid, uuid, uuid, date, text, text, numeric, numeric, text);
CREATE OR REPLACE FUNCTION public.orcamento_salvar(p_cliente_id uuid, p_itens jsonb, p_obra_id uuid DEFAULT NULL::uuid, p_vendedor_id uuid DEFAULT NULL::uuid, p_profissional_id uuid DEFAULT NULL::uuid, p_validade date DEFAULT NULL::date, p_condicao text DEFAULT NULL::text, p_prazo text DEFAULT NULL::text, p_desconto numeric DEFAULT 0, p_frete numeric DEFAULT 0, p_observacoes text DEFAULT NULL::text, p_autorizacao uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- desconto acima da faixa do usuário (grupo, marca e perfil) só com a senha de um gestor
  PERFORM public.exige_desconto_autorizado(p_itens,
    coalesce(p_desconto, 0) + coalesce((SELECT sum(coalesce((e ->> 'desconto')::numeric, 0)) FROM jsonb_array_elements(p_itens) e), 0),
    p_autorizacao);

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

  UPDATE public.orcamentos
     SET subtotal = v_sub, total = GREATEST(0, v_sub - desconto + frete)
   WHERE id = v_orc;
  RETURN v_orc;
END $function$;
REVOKE ALL ON FUNCTION public.orcamento_salvar(uuid, jsonb, uuid, uuid, uuid, date, text, text, numeric, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_salvar(uuid, jsonb, uuid, uuid, uuid, date, text, text, numeric, numeric, text, uuid) TO authenticated;

-- Pedido novo: criar passa a conferir o desconto.
DROP FUNCTION IF EXISTS public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.criar_pedido_direto(p_cliente_id uuid, p_deposito_id uuid, p_itens jsonb, p_obra_id uuid DEFAULT NULL::uuid, p_desconto numeric DEFAULT 0, p_frete numeric DEFAULT 0, p_condicao_pagamento text DEFAULT NULL::text, p_previsao_entrega date DEFAULT NULL::date, p_vendedor_id uuid DEFAULT NULL::uuid, p_profissional_id uuid DEFAULT NULL::uuid, p_observacoes text DEFAULT NULL::text, p_rascunho boolean DEFAULT false, p_autorizacao uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_pedido_id uuid; v_emp uuid; v_fil uuid; it record;
  v_sit public.pedido_situacao := case when p_rascunho then 'rascunho'::public.pedido_situacao else 'aguardando_pagamento'::public.pedido_situacao end;
begin
  PERFORM public.exige_nao_salao();
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
       or public.has_role(auth.uid(),'vendedor') or public.has_role(auth.uid(),'caixa')) then
    raise exception 'Sem permissão para criar pedidos';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id and tenant_id = v_tenant) then
    raise exception 'Cliente não encontrado nesta empresa';
  end if;
  if p_obra_id is not null and not exists (select 1 from public.obras where id = p_obra_id and tenant_id = v_tenant) then
    raise exception 'Obra não encontrada nesta empresa';
  end if;
  if p_vendedor_id is not null and not exists (select 1 from public.profiles where id = p_vendedor_id and tenant_id = v_tenant) then
    raise exception 'Vendedor não encontrado nesta empresa';
  end if;
  if p_profissional_id is not null and not exists (select 1 from public.profissionais where id = p_profissional_id and tenant_id = v_tenant) then
    raise exception 'Profissional não encontrado nesta empresa';
  end if;
  select d.filial_id, f.empresa_id into v_fil, v_emp
  from public.depositos d left join public.filiais f on f.id = d.filial_id
  where d.id = p_deposito_id and d.tenant_id = v_tenant;
  if v_fil is null and not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe ao menos um item no pedido';
  end if;

  -- desconto acima da faixa do usuário (grupo, marca e perfil) só com a senha de um gestor
  perform public.exige_desconto_autorizado(p_itens,
    coalesce(p_desconto, 0) + coalesce((select sum(coalesce((e ->> 'desconto')::numeric, 0)) from jsonb_array_elements(p_itens) e), 0),
    p_autorizacao);

  insert into public.pedidos (tenant_id, empresa_id, filial_id, cliente_id, obra_id, vendedor_id,
    profissional_id, deposito_id, situacao, origem, condicao_pagamento, previsao_entrega,
    subtotal, desconto, frete, total, observacoes)
  values (v_tenant, v_emp, v_fil, p_cliente_id, p_obra_id, coalesce(p_vendedor_id, auth.uid()),
    p_profissional_id, p_deposito_id, v_sit, 'direto', p_condicao_pagamento,
    p_previsao_entrega, 0, coalesce(p_desconto,0), coalesce(p_frete,0), 0, p_observacoes)
  returning id into v_pedido_id;

  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade, preco_unitario, desconto, total)
  select v_tenant, v_pedido_id, (i->>'produto_id')::uuid, (i->>'quantidade')::numeric,
    coalesce(i->>'unidade', (select unidade from public.produtos where id = (i->>'produto_id')::uuid)),
    (i->>'preco_unitario')::numeric, coalesce((i->>'desconto')::numeric, 0),
    round((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric - coalesce((i->>'desconto')::numeric,0), 2)
  from jsonb_array_elements(p_itens) i;

  perform public.recalcular_pedido(v_pedido_id);

  if not p_rascunho then
    for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = v_pedido_id group by produto_id loop
      perform public.registrar_movimentacao_interno(it.produto_id, p_deposito_id, 'reserva'::mov_tipo, it.q,
        'Reserva do pedido', 'PED-' || (select numero from public.pedidos where id = v_pedido_id), null);
    end loop;
    update public.pedidos set estoque_reservado = true where id = v_pedido_id;
  end if;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido_id, null, v_sit,
    case when p_rascunho then 'Pedido salvo como rascunho, sem reserva de estoque'
         else 'Pedido criado direto no sistema com reserva de estoque' end, auth.uid());
  return v_pedido_id;
end; $function$;
REVOKE ALL ON FUNCTION public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text, boolean, uuid) TO authenticated;
