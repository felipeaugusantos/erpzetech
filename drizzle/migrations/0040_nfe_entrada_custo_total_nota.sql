DO $do$
DECLARE d text := pg_get_functiondef('public.importar_nfe_entrada'::regproc);
BEGIN
  d := replace(d,
    'total = v_subtotal + coalesce((p_nota->>''frete'')::numeric, 0) - coalesce((p_nota->>''desconto'')::numeric, 0),',
    'total = coalesce(nullif(p_nota->>''total'','''')::numeric, v_subtotal + coalesce((p_nota->>''frete'')::numeric, 0) - coalesce((p_nota->>''desconto'')::numeric, 0)),');
  d := replace(d,
    '''Entrada pela importação do XML da NF-e'',
    coalesce(p_gerar_conta, true),',
    '''Entrada pela importação do XML da NF-e'',
    false,');
  d := replace(d,
    '  for l in select * from jsonb_array_elements(v_lotes) loop',
    '  -- contas a pagar pelo total da nota (o que se paga ao fornecedor), não pelo custo líquido de créditos
  if coalesce(p_gerar_conta, true) then
    declare v_tot numeric; v_n int := greatest(1, coalesce(p_parcelas, 1)); v_parc numeric;
      v_venc date := coalesce(p_vencimento, (p_nota->>''primeiro_vencimento'')::date, current_date);
      v_doc text := coalesce(nullif(p_nota->>''numero'',''''), v_chave);
    begin
      select total into v_tot from public.compras where id = v_compra_id;
      if coalesce(v_tot, 0) > 0 then
        v_parc := round(v_tot / v_n, 2);
        for i in 1..v_n loop
          insert into public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, descricao,
            categoria, parcela, parcelas, vencimento, valor, forma_pagamento)
          values (v_tenant, v_empresa, v_dep.filial_id, v_forn_id, v_compra_id,
            ''Compra nº '' || v_numero || coalesce('' - NF '' || v_doc, ''''), ''Mercadorias'',
            i, v_n, v_venc + ((i - 1) * 30),
            case when i = v_n then v_tot - (v_parc * (v_n - 1)) else v_parc end, ''boleto'');
        end loop;
      end if;
    end;
  end if;

  for l in select * from jsonb_array_elements(v_lotes) loop');
  IF position('contas a pagar pelo total da nota' in d) = 0 OR position('nullif(p_nota->>''total''' in d) = 0
     OR position('NF-e'',
    false,' in d) = 0 THEN
    RAISE EXCEPTION 'Não foi possível ajustar importar_nfe_entrada';
  END IF;
  EXECUTE d;
END $do$;

CREATE OR REPLACE FUNCTION public.nfe_entrada_completar_impostos(p_compra_id uuid, p_nota jsonb, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras;
  it jsonb; v_prod uuid; ci public.compra_itens; v_ok int := 0; v_custos int := 0;
  v_chave text := nullif(p_nota->>'chave','');
  v_novo numeric; v_estoque numeric; v_sub numeric;
  v_usados uuid[] := '{}';
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
          or public.has_role(auth.uid(), 'comprador') or public.has_role(auth.uid(), 'estoquista')) then
    raise exception 'Sem permissão para alterar notas de entrada';
  end if;
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant and origem = 'xml_nfe' for update;
  if c.id is null then raise exception 'Nota importada não encontrada'; end if;
  if c.nfe_chave is not null and v_chave is not null then
    if c.nfe_chave <> v_chave then raise exception 'Este XML é de outra nota (a chave de acesso não confere).'; end if;
  elsif coalesce(c.nfe_numero,'') <> coalesce(p_nota->>'numero','')
     or coalesce(c.nfe_serie,'') <> coalesce(p_nota->>'serie', coalesce(c.nfe_serie,'')) then
    raise exception 'Este XML é de outra nota (número ou série não conferem).';
  end if;
  if jsonb_typeof(p_nota->'impostos') <> 'object' then raise exception 'XML sem impostos'; end if;

  update public.compras set nfe_impostos = (p_nota->'impostos')
      || jsonb_build_object('total_nota', p_nota->'total', 'natureza', p_nota->'natureza')
   where id = c.id;

  for it in select * from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) loop
    v_prod := null; ci := null;
    select produto_id into v_prod from public.nfe_entrada_produtos
     where tenant_id = v_tenant and fornecedor_id = c.fornecedor_id and codigo_fornecedor = it->>'codigo' limit 1;
    if v_prod is null then continue; end if;
    select * into ci from public.compra_itens
     where compra_id = c.id and produto_id = v_prod and not (id = any(v_usados)) order by created_at limit 1;
    if ci.id is null then continue; end if;
    v_usados := v_usados || ci.id;
    update public.compra_itens set impostos = it->'impostos', cfop = nullif(it->>'cfop','') where id = ci.id;
    v_ok := v_ok + 1;

    -- recalcula o custo do item e corrige o custo médio do produto pela diferença
    v_novo := nullif(it->>'custo_unitario','')::numeric;
    if v_novo is not null and v_novo >= 0 and abs(v_novo - ci.custo_unitario) >= 0.000001 then
      update public.compra_itens set custo_unitario = v_novo, total = round(ci.quantidade * v_novo, 2) where id = ci.id;
      select coalesce(sum(quantidade), 0) into v_estoque from public.estoques where produto_id = v_prod and tenant_id = v_tenant;
      update public.produtos
         set custo = greatest(0, round(custo + (v_novo - ci.custo_unitario) * ci.quantidade_recebida
                                 / greatest(v_estoque, ci.quantidade_recebida, 1), 6))
       where id = v_prod and tenant_id = v_tenant;
      v_custos := v_custos + 1;
    end if;
  end loop;

  select coalesce(sum(total), 0) into v_sub from public.compra_itens where compra_id = c.id;
  update public.compras set subtotal = v_sub where id = c.id;
  return jsonb_build_object('itens', v_ok, 'custos', v_custos);
end; $$;
REVOKE ALL ON FUNCTION public.nfe_entrada_completar_impostos(uuid, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.nfe_entrada_completar_impostos(uuid, jsonb, jsonb) TO authenticated;