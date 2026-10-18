CREATE OR REPLACE FUNCTION public.nfe_entrada_completar_impostos(p_compra_id uuid, p_nota jsonb, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras;
  it jsonb; v_prod uuid; v_item uuid; v_ok int := 0;
  v_chave text := nullif(p_nota->>'chave','');
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
          or public.has_role(auth.uid(), 'comprador') or public.has_role(auth.uid(), 'estoquista')) then
    raise exception 'Sem permissão para alterar notas de entrada';
  end if;
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant and origem = 'xml_nfe';
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
    v_prod := null; v_item := null;
    select produto_id into v_prod from public.nfe_entrada_produtos
     where tenant_id = v_tenant and fornecedor_id = c.fornecedor_id and codigo_fornecedor = it->>'codigo' limit 1;
    if v_prod is null then continue; end if;
    select id into v_item from public.compra_itens
     where compra_id = c.id and produto_id = v_prod and impostos is null order by created_at limit 1;
    if v_item is null then continue; end if;
    update public.compra_itens set impostos = it->'impostos', cfop = nullif(it->>'cfop','') where id = v_item;
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('itens', v_ok);
end; $$;
REVOKE ALL ON FUNCTION public.nfe_entrada_completar_impostos(uuid, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.nfe_entrada_completar_impostos(uuid, jsonb, jsonb) TO authenticated;