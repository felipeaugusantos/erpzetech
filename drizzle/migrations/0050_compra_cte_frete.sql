CREATE TABLE public.compra_ctes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  compra_id uuid NOT NULL REFERENCES public.compras(id) ON DELETE CASCADE,
  transportadora_id uuid REFERENCES public.fornecedores(id),
  chave text,
  numero text,
  serie text,
  emissao date,
  valor numeric NOT NULL,
  icms numeric NOT NULL DEFAULT 0,
  conta_pagar_id uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compra_ctes_chave_un ON public.compra_ctes (tenant_id, chave) WHERE chave IS NOT NULL;
CREATE INDEX compra_ctes_compra_idx ON public.compra_ctes (compra_id);
GRANT SELECT ON public.compra_ctes TO authenticated;
GRANT ALL ON public.compra_ctes TO service_role;
ALTER TABLE public.compra_ctes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CT-e da propria empresa" ON public.compra_ctes FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.nfe_entrada_vincular_cte(p_compra_id uuid, p_cte jsonb, p_vencimento date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras;
  v_chave text := nullif(regexp_replace(coalesce(p_cte->>'chave',''), '\D', '', 'g'), '');
  v_valor numeric := coalesce(nullif(p_cte->>'valor','')::numeric, 0);
  v_cnpj text := regexp_replace(coalesce(p_cte->>'cnpj',''), '\D', '', 'g');
  v_notas jsonb := coalesce(p_cte->'nfe_chaves', '[]'::jsonb);
  v_transp uuid; v_conta uuid; v_sub numeric; v_estoque numeric; v_delta numeric;
  ci record; v_n int := 0;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
          or public.has_role(auth.uid(), 'comprador') or public.has_role(auth.uid(), 'estoquista')) then
    raise exception 'Sem permissão para vincular CT-e';
  end if;
  if v_valor <= 0 then raise exception 'O CT-e não tem valor de frete.'; end if;
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant for update;
  if c.id is null then raise exception 'Nota importada não encontrada'; end if;
  if c.nfe_chave is not null and jsonb_array_length(v_notas) > 0
     and not exists (select 1 from jsonb_array_elements_text(v_notas) k where regexp_replace(k, '\D', '', 'g') = c.nfe_chave) then
    raise exception 'Este CT-e não transporta esta nota (a chave da NF-e não aparece no CT-e).';
  end if;
  if v_chave is not null and exists (select 1 from public.compra_ctes where tenant_id = v_tenant and chave = v_chave) then
    raise exception 'Este CT-e já foi vinculado.';
  end if;

  if v_cnpj <> '' then
    select id into v_transp from public.fornecedores
     where tenant_id = v_tenant and regexp_replace(coalesce(cnpj,''), '\D', '', 'g') = v_cnpj limit 1;
  end if;
  if v_transp is null then
    insert into public.fornecedores (tenant_id, razao_social, cnpj, cidade, estado)
    values (v_tenant, coalesce(nullif(p_cte->>'razao_social',''), 'Transportadora do CT-e'),
      nullif(p_cte->>'cnpj',''), nullif(p_cte->>'cidade',''), nullif(p_cte->>'estado',''))
    returning id into v_transp;
  end if;

  insert into public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, descricao,
    categoria, parcela, parcelas, vencimento, valor, forma_pagamento)
  values (v_tenant, c.empresa_id, c.filial_id, v_transp, c.id,
    'Frete CT-e nº ' || coalesce(nullif(p_cte->>'numero',''), '—') || ' - Compra nº ' || c.numero,
    'Frete', 1, 1, coalesce(p_vencimento, (p_cte->>'emissao')::date + 30, current_date + 30), v_valor, 'boleto')
  returning id into v_conta;

  insert into public.compra_ctes (tenant_id, compra_id, transportadora_id, chave, numero, serie, emissao, valor, icms, conta_pagar_id, criado_por)
  values (v_tenant, c.id, v_transp, v_chave, nullif(p_cte->>'numero',''), nullif(p_cte->>'serie',''),
    nullif(p_cte->>'emissao','')::date, v_valor, coalesce(nullif(p_cte->>'icms','')::numeric, 0), v_conta, auth.uid());

  -- rateio do frete pelo valor de cada item; o custo médio do produto sobe pela parcela que ainda está em estoque
  select coalesce(sum(total), 0) into v_sub from public.compra_itens where compra_id = c.id and quantidade > 0;
  if v_sub > 0 then
    for ci in select * from public.compra_itens where compra_id = c.id and quantidade > 0 loop
      v_delta := v_valor * (ci.total / v_sub) / ci.quantidade;
      update public.compra_itens
         set custo_unitario = round(custo_unitario + v_delta, 6),
             total = round(quantidade * (custo_unitario + v_delta), 2),
             impostos = coalesce(impostos, '{}'::jsonb) || jsonb_build_object('frete_cte',
               round(coalesce((impostos->>'frete_cte')::numeric, 0) + v_delta * ci.quantidade, 2))
       where id = ci.id;
      select coalesce(sum(quantidade), 0) into v_estoque from public.estoques where produto_id = ci.produto_id and tenant_id = v_tenant;
      update public.produtos
         set custo = greatest(0, round(coalesce(custo, 0) + v_delta * coalesce(ci.quantidade_recebida, ci.quantidade)
                                 / greatest(v_estoque, coalesce(ci.quantidade_recebida, ci.quantidade), 1), 6))
       where id = ci.produto_id and tenant_id = v_tenant;
      v_n := v_n + 1;
    end loop;
    update public.compras set subtotal = (select coalesce(sum(total), 0) from public.compra_itens where compra_id = c.id) where id = c.id;
  end if;
  return jsonb_build_object('itens', v_n, 'conta_pagar_id', v_conta, 'transportadora_id', v_transp);
end; $$;
REVOKE ALL ON FUNCTION public.nfe_entrada_vincular_cte(uuid, jsonb, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.nfe_entrada_vincular_cte(uuid, jsonb, date) TO authenticated;