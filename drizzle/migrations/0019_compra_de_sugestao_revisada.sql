-- Cria o pedido de compra (em rascunho) só com os itens e quantidades que o usuário revisou e aprovou.
CREATE OR REPLACE FUNCTION public.compra_criar_de_sugestao(
  p_deposito_id uuid, p_fornecedor_id uuid, p_itens jsonb, p_observacao text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  r record;
  v_prod public.produtos;
  v_count int := 0;
begin
  PERFORM public.exige_nao_salao();
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
          or public.has_role(auth.uid(), 'comprador') or public.has_role(auth.uid(), 'estoquista')) then
    raise exception 'Sem permissão para criar pedidos de compra';
  end if;
  if not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;
  if p_fornecedor_id is not null and not exists (
    select 1 from public.fornecedores where id = p_fornecedor_id and tenant_id = v_tenant) then
    raise exception 'Fornecedor não encontrado nesta empresa';
  end if;

  insert into public.compras (tenant_id, empresa_id, filial_id, deposito_id, fornecedor_id, origem, observacoes, solicitante_id)
  select v_tenant, p.empresa_id, p.filial_id, p_deposito_id, p_fornecedor_id, 'sugestao_reposicao',
    coalesce(nullif(trim(p_observacao),''), 'Criado a partir da sugestão de reposição revisada'), auth.uid()
  from public.profiles p where p.id = auth.uid()
  returning id into v_id;
  if v_id is null then raise exception 'Perfil não encontrado'; end if;

  for r in select (x->>'produto_id')::uuid produto_id, (x->>'quantidade')::numeric q
           from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) x loop
    if r.q is null or r.q <= 0 then continue; end if;
    select * into v_prod from public.produtos where id = r.produto_id and tenant_id = v_tenant;
    if v_prod.id is null then raise exception 'Produto não encontrado nesta empresa'; end if;
    insert into public.compra_itens (tenant_id, compra_id, produto_id, quantidade, unidade, custo_unitario, total)
    values (v_tenant, v_id, v_prod.id, r.q, v_prod.unidade, coalesce(v_prod.custo,0), round(r.q * coalesce(v_prod.custo,0), 2));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Escolha ao menos um produto com quantidade'; end if;
  perform public.recalcular_compra(v_id);
  return v_id;
end $$;
REVOKE ALL ON FUNCTION public.compra_criar_de_sugestao(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_criar_de_sugestao(uuid, uuid, jsonb, text) TO authenticated;