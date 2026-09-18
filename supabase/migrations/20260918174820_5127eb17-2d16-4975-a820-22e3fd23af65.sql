ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS nfe_chave text,
  ADD COLUMN IF NOT EXISTS nfe_numero text,
  ADD COLUMN IF NOT EXISTS nfe_emissao date;

CREATE UNIQUE INDEX IF NOT EXISTS compras_tenant_nfe_chave_key
  ON public.compras (tenant_id, nfe_chave) WHERE nfe_chave IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.nfe_entrada_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  codigo_fornecedor text NOT NULL,
  codigo_barras text,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fornecedor_id, codigo_fornecedor)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfe_entrada_produtos TO authenticated;
GRANT ALL ON public.nfe_entrada_produtos TO service_role;

ALTER TABLE public.nfe_entrada_produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nfe_entrada_produtos_tenant ON public.nfe_entrada_produtos;
CREATE POLICY nfe_entrada_produtos_tenant ON public.nfe_entrada_produtos
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS touch_nfe_entrada_produtos ON public.nfe_entrada_produtos;
CREATE TRIGGER touch_nfe_entrada_produtos BEFORE UPDATE ON public.nfe_entrada_produtos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.importar_nfe_entrada(
  p_nota jsonb,
  p_fornecedor jsonb,
  p_itens jsonb,
  p_deposito_id uuid,
  p_gerar_conta boolean DEFAULT true,
  p_parcelas integer DEFAULT 1,
  p_vencimento date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_dep public.depositos;
  v_forn_id uuid;
  v_cnpj text := regexp_replace(coalesce(p_fornecedor->>'cnpj',''), '\D', '', 'g');
  v_chave text := nullif(p_nota->>'chave','');
  v_compra_id uuid; v_rec_id uuid; v_numero bigint;
  it jsonb; v_prod_id uuid; v_codigo text; v_seq int := 0;
  v_qtd numeric; v_custo numeric; v_subtotal numeric := 0;
  v_itens_receber jsonb := '[]'::jsonb; v_item_id uuid;
  v_novos int := 0;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
          or public.has_role(auth.uid(), 'comprador') or public.has_role(auth.uid(), 'estoquista')) then
    raise exception 'Sem permissão para importar nota de entrada';
  end if;

  select * into v_dep from public.depositos where id = p_deposito_id and tenant_id = v_tenant;
  if v_dep.id is null then raise exception 'Depósito não encontrado nesta empresa'; end if;

  if v_chave is not null and exists (
    select 1 from public.compras where tenant_id = v_tenant and nfe_chave = v_chave
  ) then
    raise exception 'Esta nota já foi importada (chave %).', v_chave;
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'A nota não tem itens para importar';
  end if;

  -- fornecedor: casa pelo CNPJ ou cadastra
  if v_cnpj <> '' then
    select id into v_forn_id from public.fornecedores
     where tenant_id = v_tenant and regexp_replace(coalesce(cnpj,''), '\D', '', 'g') = v_cnpj
     limit 1;
  end if;
  if v_forn_id is null then
    insert into public.fornecedores (tenant_id, razao_social, nome_fantasia, cnpj, telefone, email,
      cep, endereco, numero, bairro, cidade, estado, condicao_pagamento)
    values (v_tenant,
      coalesce(nullif(p_fornecedor->>'razao_social',''), 'Fornecedor da NF-e'),
      nullif(p_fornecedor->>'nome_fantasia',''), nullif(p_fornecedor->>'cnpj',''),
      nullif(p_fornecedor->>'telefone',''), nullif(p_fornecedor->>'email',''),
      nullif(p_fornecedor->>'cep',''), nullif(p_fornecedor->>'endereco',''),
      nullif(p_fornecedor->>'numero',''), nullif(p_fornecedor->>'bairro',''),
      nullif(p_fornecedor->>'cidade',''), nullif(p_fornecedor->>'estado',''),
      nullif(p_nota->>'condicao_pagamento',''))
    returning id into v_forn_id;
  end if;

  insert into public.compras (tenant_id, empresa_id, filial_id, fornecedor_id, deposito_id, situacao,
    origem, previsao_entrega, condicao_pagamento, observacoes, nfe_chave, nfe_numero, nfe_emissao,
    solicitante_id)
  values (v_tenant, v_dep.empresa_id, v_dep.filial_id, v_forn_id, v_dep.id, 'aprovado'::public.compra_situacao,
    'xml_nfe', coalesce((p_nota->>'emissao')::date, current_date), nullif(p_nota->>'condicao_pagamento',''),
    nullif(p_nota->>'observacao',''), v_chave, nullif(p_nota->>'numero',''),
    (p_nota->>'emissao')::date, auth.uid())
  returning id, numero into v_compra_id, v_numero;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_seq := v_seq + 1;
    v_qtd := coalesce((it->>'quantidade')::numeric, 0);
    v_custo := coalesce((it->>'custo_unitario')::numeric, 0);
    if v_qtd <= 0 then continue; end if;

    v_prod_id := nullif(it->>'produto_id','')::uuid;
    if v_prod_id is not null then
      perform 1 from public.produtos where id = v_prod_id and tenant_id = v_tenant;
      if not found then raise exception 'Produto informado não pertence a esta empresa'; end if;
    else
      -- cadastra o produto com os dados da nota
      v_codigo := upper(regexp_replace(coalesce(nullif(it->>'codigo',''), 'NF' || v_numero || '-' || v_seq),
        '[^A-Za-z0-9._-]', '', 'g'));
      if v_codigo = '' then v_codigo := 'NF' || v_numero || '-' || v_seq; end if;
      select id into v_prod_id from public.produtos
       where tenant_id = v_tenant and codigo_interno = v_codigo limit 1;
      if v_prod_id is null then
        insert into public.produtos (tenant_id, codigo_interno, codigo_barras, descricao, ncm,
          unidade, unidade_compra, custo, preco_venda, fornecedor_id, ativo)
        values (v_tenant, v_codigo, nullif(it->>'codigo_barras',''),
          coalesce(nullif(it->>'descricao',''), 'Produto da NF ' || coalesce(p_nota->>'numero','')),
          nullif(it->>'ncm',''), coalesce(nullif(it->>'unidade',''), 'UN'),
          nullif(it->>'unidade',''), v_custo,
          coalesce((it->>'preco_venda')::numeric, 0), v_forn_id, true)
        returning id into v_prod_id;
        v_novos := v_novos + 1;
      end if;
    end if;

    if coalesce(it->>'codigo','') <> '' then
      insert into public.nfe_entrada_produtos (tenant_id, fornecedor_id, codigo_fornecedor, codigo_barras, produto_id)
      values (v_tenant, v_forn_id, it->>'codigo', nullif(it->>'codigo_barras',''), v_prod_id)
      on conflict (tenant_id, fornecedor_id, codigo_fornecedor)
        do update set produto_id = excluded.produto_id, codigo_barras = excluded.codigo_barras;
    end if;

    insert into public.compra_itens (tenant_id, compra_id, produto_id, quantidade, unidade,
      custo_unitario, total, observacao)
    values (v_tenant, v_compra_id, v_prod_id, v_qtd, nullif(it->>'unidade',''), v_custo,
      round(v_qtd * v_custo, 2), nullif(it->>'observacao',''))
    returning id into v_item_id;

    v_subtotal := v_subtotal + round(v_qtd * v_custo, 2);
    v_itens_receber := v_itens_receber || jsonb_build_object(
      'compra_item_id', v_item_id, 'quantidade', v_qtd, 'custo_unitario', v_custo);
  end loop;

  if jsonb_array_length(v_itens_receber) = 0 then
    raise exception 'Nenhum item válido na nota';
  end if;

  update public.compras
     set subtotal = v_subtotal,
         frete = coalesce((p_nota->>'frete')::numeric, 0),
         desconto = coalesce((p_nota->>'desconto')::numeric, 0),
         total = v_subtotal + coalesce((p_nota->>'frete')::numeric, 0) - coalesce((p_nota->>'desconto')::numeric, 0),
         aprovado_por = auth.uid(), aprovado_em = now()
   where id = v_compra_id;

  v_rec_id := public.receber_compra(
    v_compra_id, v_itens_receber,
    coalesce(nullif(p_nota->>'numero',''), v_chave),
    'Entrada pela importação do XML da NF-e',
    coalesce(p_gerar_conta, true),
    coalesce(p_vencimento, (p_nota->>'primeiro_vencimento')::date, current_date),
    greatest(1, coalesce(p_parcelas, 1)));

  return jsonb_build_object('compra_id', v_compra_id, 'numero', v_numero,
    'recebimento_id', v_rec_id, 'fornecedor_id', v_forn_id,
    'produtos_criados', v_novos, 'total', v_subtotal);
end; $$;

REVOKE ALL ON FUNCTION public.importar_nfe_entrada(jsonb, jsonb, jsonb, uuid, boolean, integer, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.importar_nfe_entrada(jsonb, jsonb, jsonb, uuid, boolean, integer, date) TO authenticated;