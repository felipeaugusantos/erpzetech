CREATE OR REPLACE FUNCTION public.profissional_converter_em_cliente(p_profissional_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  pr public.profissionais;
  v_cliente uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'vendedor')) then
    raise exception 'Sem permissão para cadastrar cliente';
  end if;
  select * into pr from public.profissionais where id = p_profissional_id and tenant_id = v_tenant;
  if pr.id is null then raise exception 'Profissional não encontrado'; end if;
  if pr.cliente_id is not null then return pr.cliente_id; end if;

  if pr.cpf is not null and length(regexp_replace(pr.cpf,'\D','','g')) > 0 then
    select id into v_cliente from public.clientes
     where tenant_id = v_tenant
       and regexp_replace(coalesce(cpf,''),'\D','','g') = regexp_replace(pr.cpf,'\D','','g')
     limit 1;
  end if;

  if v_cliente is null then
    insert into public.clientes (tenant_id, empresa_id, nome, tipo, cpf, telefone, whatsapp,
      email, profissional_id, observacoes)
    values (v_tenant, pr.empresa_id, pr.nome, 'PF'::pessoa_tipo, pr.cpf, pr.telefone, pr.whatsapp,
      pr.email, pr.id, 'Cliente criado a partir do cadastro de profissional')
    returning id into v_cliente;
  else
    update public.clientes set profissional_id = pr.id where id = v_cliente and profissional_id is null;
  end if;

  update public.profissionais set cliente_id = v_cliente where id = pr.id;
  return v_cliente;
end $$;