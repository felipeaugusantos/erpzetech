-- ===== LOCAÇÃO: solicitação, aprovação, entrega, devolução, faturamento e nota =====
alter table public.locacoes
  add column if not exists solicitado_em date not null default current_date,
  add column if not exists aprovada boolean not null default false,
  add column if not exists aprovado_em timestamptz,
  add column if not exists entregue_em date,
  add column if not exists dias_reais integer,
  add column if not exists valor_extras numeric(14,2) not null default 0,
  add column if not exists valor_faturado numeric(14,2) not null default 0,
  add column if not exists conta_receber_id uuid references public.contas_receber(id),
  add column if not exists nfe_id uuid references public.nfe(id),
  add column if not exists observacao_devolucao text;

alter table public.nfe add column if not exists locacao_id uuid references public.locacoes(id);

create or replace function public.locacao_aprovar(p_locacao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_loc record;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada'; end if;
  update public.locacoes set aprovada = true, aprovado_em = now(), situacao = 'reservada'
   where id = p_locacao_id;
end; $$;
revoke all on function public.locacao_aprovar(uuid) from public, anon;
grant execute on function public.locacao_aprovar(uuid) to authenticated;

create or replace function public.locacao_entregar(p_locacao_id uuid, p_data date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare v_loc record;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if not v_loc.aprovada then raise exception 'Aprove a solicitação antes de entregar o equipamento'; end if;
  if v_loc.situacao = 'devolvida' then raise exception 'Locação já devolvida'; end if;
  update public.locacoes
     set situacao = 'em_andamento', entregue_em = coalesce(p_data, current_date)
   where id = p_locacao_id;
end; $$;
revoke all on function public.locacao_entregar(uuid, date) from public, anon;
grant execute on function public.locacao_entregar(uuid, date) to authenticated;

create or replace function public.locacao_devolver(
  p_locacao_id uuid,
  p_data date default current_date,
  p_observacao text default null,
  p_multa numeric default 0
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_loc record; v_dias integer; v_extras numeric := 0; v_total numeric;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'devolvida' then raise exception 'Locação já devolvida'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada'; end if;
  v_dias := greatest(coalesce(p_data, current_date) - coalesce(v_loc.entregue_em, v_loc.inicio), 1);
  if v_dias > v_loc.dias then
    v_extras := (v_dias - v_loc.dias) * v_loc.valor_diaria;
  end if;
  v_total := (v_loc.valor_diaria * greatest(v_dias, v_loc.dias)) + coalesce(p_multa, 0);
  update public.locacoes
     set situacao = 'devolvida',
         devolvido_em = coalesce(p_data, current_date),
         dias_reais = v_dias,
         valor_extras = v_extras + coalesce(p_multa, 0),
         valor_total = v_total,
         observacao_devolucao = p_observacao
   where id = p_locacao_id;
  return v_total;
end; $$;
revoke all on function public.locacao_devolver(uuid, date, text, numeric) from public, anon;
grant execute on function public.locacao_devolver(uuid, date, text, numeric) to authenticated;

create or replace function public.locacao_faturar(
  p_locacao_id uuid,
  p_forma public.forma_pagamento,
  p_parcelas integer default 1,
  p_primeiro_vencimento date default current_date,
  p_caixa_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_loc record; v_cli record; v_parc integer; v_valor numeric; v_resto numeric;
  v_id uuid; v_primeiro uuid; i integer; v_vparcela numeric;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada não é faturada'; end if;
  if coalesce(v_loc.valor_faturado, 0) > 0 then raise exception 'Locação já faturada'; end if;
  if coalesce(v_loc.valor_total, 0) <= 0 then raise exception 'Locação sem valor a faturar'; end if;

  select * into v_cli from public.clientes where id = v_loc.cliente_id;
  v_parc := greatest(coalesce(p_parcelas, 1), 1);
  v_valor := round(v_loc.valor_total / v_parc, 2);
  v_resto := v_loc.valor_total - (v_valor * v_parc);

  for i in 1..v_parc loop
    v_vparcela := v_valor + case when i = v_parc then v_resto else 0 end;
    insert into public.contas_receber (
      tenant_id, empresa_id, filial_id, cliente_id, descricao, parcela, parcelas,
      vencimento, valor, forma_pagamento, observacoes
    ) values (
      current_tenant_id(), v_loc.empresa_id, v_loc.filial_id, v_loc.cliente_id,
      'Locação nº ' || v_loc.numero || ' — ' || coalesce((select nome from public.locacao_equipamentos where id = v_loc.equipamento_id), 'equipamento'),
      i, v_parc,
      coalesce(p_primeiro_vencimento, current_date) + ((i - 1) * 30),
      v_vparcela, p_forma, 'Faturamento da locação'
    ) returning id into v_id;
    if i = 1 then v_primeiro := v_id; end if;

    -- recebimento imediato no caixa para formas à vista
    if p_caixa_id is not null and p_forma in ('dinheiro','pix','cartao_debito') then
      insert into public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
      values (current_tenant_id(), p_caixa_id, 'recebimento', v_vparcela, p_forma,
              'Locação nº ' || v_loc.numero, auth.uid());
      insert into public.financeiro_baixas (tenant_id, conta_receber_id, caixa_id, valor, forma_pagamento, observacao, usuario_id)
      values (current_tenant_id(), v_id, p_caixa_id, v_vparcela, p_forma, 'Recebido no ato da locação', auth.uid());
      update public.contas_receber set valor_recebido = v_vparcela, situacao = 'pago' where id = v_id;
    end if;
  end loop;

  update public.locacoes
     set valor_faturado = v_loc.valor_total, conta_receber_id = v_primeiro
   where id = p_locacao_id;
  return v_primeiro;
end; $$;
revoke all on function public.locacao_faturar(uuid, public.forma_pagamento, integer, date, uuid) from public, anon;
grant execute on function public.locacao_faturar(uuid, public.forma_pagamento, integer, date, uuid) to authenticated;

create or replace function public.locacao_gerar_nfe(p_locacao_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_loc record; v_cli record; v_emp record; v_fil record; v_cfg record;
  v_nfe_id uuid; v_numero integer; v_pend text[] := array[]::text[];
  v_equip text; v_doc text; v_dias integer;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada não emite nota'; end if;
  if exists (select 1 from public.nfe where locacao_id = p_locacao_id and situacao <> 'cancelada') then
    raise exception 'Esta locação já tem nota gerada';
  end if;

  select * into v_cli from public.clientes where id = v_loc.cliente_id;
  select * into v_emp from public.empresas where id = coalesce(v_loc.empresa_id, v_cli.empresa_id);
  select * into v_fil from public.filiais where id = v_loc.filial_id;
  select nome into v_equip from public.locacao_equipamentos where id = v_loc.equipamento_id;

  select * into v_cfg from public.fiscal_config
   where tenant_id = current_tenant_id() and (filial_id = v_loc.filial_id or filial_id is null)
     and (empresa_id = v_emp.id or empresa_id is null)
   order by filial_id nulls last, empresa_id nulls last limit 1;
  if v_cfg is null then
    insert into public.fiscal_config (tenant_id, empresa_id) values (current_tenant_id(), v_emp.id)
    returning * into v_cfg;
  end if;

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  if v_doc is null or length(regexp_replace(v_doc, '\D', '', 'g')) not in (11, 14) then
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  end if;
  if coalesce(v_cli.endereco,'') = '' or coalesce(v_cli.cidade,'') = '' or coalesce(v_cli.estado,'') = '' then
    v_pend := array_append(v_pend, 'Endereço completo do cliente incompleto');
  end if;
  if v_emp is null or coalesce(v_emp.cnpj,'') = '' or coalesce(v_emp.inscricao_estadual,'') = '' then
    v_pend := array_append(v_pend, 'CNPJ ou inscrição estadual da empresa ausente');
  end if;
  if coalesce(v_cfg.certificado_nome,'') = '' then
    v_pend := array_append(v_pend, 'Certificado digital A1 não configurado');
  end if;
  if coalesce(v_cfg.emissor,'') = '' then
    v_pend := array_append(v_pend, 'Emissor fiscal (API) não configurado');
  end if;

  if array_length(v_pend, 1) is null then
    v_numero := v_cfg.proximo_numero;
    update public.fiscal_config set proximo_numero = proximo_numero + 1 where id = v_cfg.id;
  end if;

  v_dias := coalesce(v_loc.dias_reais, v_loc.dias, 1);

  insert into public.nfe (
    tenant_id, empresa_id, filial_id, cliente_id, locacao_id, numero, serie, situacao, ambiente,
    natureza_operacao, cfop, valor_produtos, valor_total, emitente, destinatario, pendencias, mensagem
  ) values (
    current_tenant_id(), v_emp.id, v_loc.filial_id, v_loc.cliente_id, p_locacao_id,
    v_numero, v_cfg.serie,
    case when array_length(v_pend,1) is null then 'pronta' else 'rascunho' end,
    v_cfg.ambiente, 'Locação de equipamento', '5949',
    v_loc.valor_total, v_loc.valor_total,
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco,
      'numero', v_emp.numero, 'bairro', v_emp.bairro, 'cidade', v_emp.cidade,
      'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'inscricao_estadual', v_cli.inscricao_estadual, 'endereco', v_cli.endereco, 'numero', v_cli.numero,
      'bairro', v_cli.bairro, 'cidade', v_cli.cidade, 'estado', v_cli.estado, 'cep', v_cli.cep,
      'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    case when array_length(v_pend,1) is null
      then 'Nota de locação pronta para transmissão.'
      else 'Nota em rascunho: resolva as pendências listadas.' end
  ) returning id into v_nfe_id;

  insert into public.nfe_itens (
    tenant_id, nfe_id, descricao, cfop, unidade, quantidade, preco_unitario, total, aliquota_iss, cst_csosn
  ) values (
    current_tenant_id(), v_nfe_id,
    'Locação de ' || coalesce(v_equip, 'equipamento') || ' — ' || v_dias || ' dia(s)',
    '5949', 'DIA', v_dias,
    case when v_dias > 0 then round(v_loc.valor_total / v_dias, 2) else v_loc.valor_total end,
    v_loc.valor_total, coalesce(v_cfg.aliquota_iss, 0), '400'
  );

  update public.locacoes set nfe_id = v_nfe_id where id = p_locacao_id;
  perform public.nfe_calcular_impostos(v_nfe_id, null, null, null, null, null, false);
  return v_nfe_id;
end; $$;
revoke all on function public.locacao_gerar_nfe(uuid) from public, anon;
grant execute on function public.locacao_gerar_nfe(uuid) to authenticated;

-- ===== DEVOLUÇÃO DE ITENS DO PEDIDO =====
create table if not exists public.devolucoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  empresa_id uuid references public.empresas(id),
  filial_id uuid references public.filiais(id),
  numero integer not null default 0,
  pedido_id uuid not null references public.pedidos(id),
  cliente_id uuid references public.clientes(id),
  deposito_id uuid references public.depositos(id),
  modo text not null default 'pedido' check (modo in ('pedido','nota')),
  motivo text,
  valor_total numeric(14,2) not null default 0,
  valor_abatido numeric(14,2) not null default 0,
  nfe_id uuid references public.nfe(id),
  usuario_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.devolucao_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  devolucao_id uuid not null references public.devolucoes(id) on delete cascade,
  pedido_item_id uuid references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null,
  unidade text,
  preco_unitario numeric(14,2) not null default 0,
  custo_unitario numeric(14,4) not null default 0,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

grant select, insert, update on public.devolucoes to authenticated;
grant all on public.devolucoes to service_role;
grant select, insert on public.devolucao_itens to authenticated;
grant all on public.devolucao_itens to service_role;

alter table public.devolucoes enable row level security;
alter table public.devolucao_itens enable row level security;

create policy devolucoes_select on public.devolucoes for select to authenticated
  using (tenant_id = current_tenant_id());
create policy devolucoes_insert on public.devolucoes for insert to authenticated
  with check (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')));
create policy devolucao_itens_select on public.devolucao_itens for select to authenticated
  using (tenant_id = current_tenant_id());

create index if not exists devolucoes_tenant_idx on public.devolucoes (tenant_id, pedido_id);
create index if not exists devolucao_itens_dev_idx on public.devolucao_itens (devolucao_id);

create or replace function public.devolucao_registrar(
  p_pedido_id uuid,
  p_itens jsonb,
  p_modo text default 'pedido',
  p_motivo text default null,
  p_deposito_id uuid default null,
  p_abater_receber boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ped record; v_cli record; v_emp record; v_fil record; v_cfg record;
  v_dev_id uuid; v_dep uuid; v_num integer;
  v_it jsonb; v_item record; v_qtd numeric; v_devolvido numeric;
  v_total numeric := 0; v_abater numeric; v_conta record; v_aplicar numeric;
  v_nfe_id uuid; v_numero integer; v_abatido numeric := 0;
begin
  if current_tenant_id() is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')) then
    raise exception 'Somente administrador ou gestor registra devolução';
  end if;
  select * into v_ped from public.pedidos where id = p_pedido_id and tenant_id = current_tenant_id();
  if v_ped is null then raise exception 'Pedido não encontrado'; end if;
  if v_ped.situacao = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha os itens devolvidos'; end if;
  if p_modo not in ('pedido','nota') then raise exception 'Modo de devolução inválido'; end if;

  v_dep := coalesce(p_deposito_id, v_ped.deposito_id);
  if v_dep is null then raise exception 'Informe o depósito que recebe a devolução'; end if;

  select coalesce(max(numero),0) + 1 into v_num from public.devolucoes where tenant_id = current_tenant_id();

  insert into public.devolucoes (
    tenant_id, empresa_id, filial_id, numero, pedido_id, cliente_id, deposito_id, modo, motivo, usuario_id
  ) values (
    current_tenant_id(), v_ped.empresa_id, v_ped.filial_id, v_num, p_pedido_id, v_ped.cliente_id,
    v_dep, p_modo, p_motivo, auth.uid()
  ) returning id into v_dev_id;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then continue; end if;

    select i.*, p.descricao, p.codigo_interno, p.ncm, p.cfop, p.cst_csosn, p.aliquota_icms, p.unidade as unidade_produto
      into v_item
      from public.pedido_itens i join public.produtos p on p.id = i.produto_id
     where i.id = (v_it->>'pedido_item_id')::uuid and i.pedido_id = p_pedido_id;
    if v_item is null then raise exception 'Item do pedido não encontrado'; end if;

    select coalesce(sum(di.quantidade), 0) into v_devolvido
      from public.devolucao_itens di join public.devolucoes d on d.id = di.devolucao_id
     where di.pedido_item_id = v_item.id and d.id <> v_dev_id;

    if v_qtd > (v_item.quantidade - v_devolvido) then
      raise exception 'Quantidade devolvida maior que a vendida no item %', coalesce(v_item.descricao, '');
    end if;

    insert into public.devolucao_itens (
      tenant_id, devolucao_id, pedido_item_id, produto_id, quantidade, unidade,
      preco_unitario, custo_unitario, total
    ) values (
      current_tenant_id(), v_dev_id, v_item.id, v_item.produto_id, v_qtd,
      coalesce(v_item.unidade, v_item.unidade_produto),
      v_item.preco_unitario, coalesce(v_item.custo_unitario, 0),
      round(v_qtd * v_item.preco_unitario, 2)
    );

    -- devolve ao estoque do depósito, com o custo congelado do pedido
    perform public.registrar_movimentacao(
      v_item.produto_id, v_dep, 'entrada'::public.mov_tipo, v_qtd,
      'Devolução do pedido nº ' || v_ped.numero, 'DEV-' || v_num,
      null, coalesce(v_item.custo_unitario, 0)
    );

    v_total := v_total + round(v_qtd * v_item.preco_unitario, 2);
  end loop;

  if v_total <= 0 then raise exception 'Nenhum item válido para devolução'; end if;

  -- abate o valor devolvido nos títulos em aberto do pedido
  if p_abater_receber then
    v_abater := v_total;
    for v_conta in
      select * from public.contas_receber
       where pedido_id = p_pedido_id and tenant_id = current_tenant_id()
         and situacao in ('aberto','parcial')
       order by vencimento desc
    loop
      exit when v_abater <= 0;
      v_aplicar := least(v_abater, v_conta.valor - v_conta.valor_recebido);
      if v_aplicar <= 0 then continue; end if;
      if v_aplicar >= (v_conta.valor - v_conta.valor_recebido) then
        update public.contas_receber
           set valor = greatest(v_conta.valor_recebido, v_conta.valor - v_aplicar),
               situacao = case when v_conta.valor_recebido > 0 then 'pago' else 'cancelado' end,
               observacoes = concat_ws(' · ', observacoes, 'Abatido pela devolução nº ' || v_num)
         where id = v_conta.id;
      else
        update public.contas_receber
           set valor = v_conta.valor - v_aplicar,
               observacoes = concat_ws(' · ', observacoes, 'Abatido pela devolução nº ' || v_num)
         where id = v_conta.id;
      end if;
      v_abatido := v_abatido + v_aplicar;
      v_abater := v_abater - v_aplicar;
    end loop;
  end if;

  -- nota fiscal de entrada por devolução
  if p_modo = 'nota' then
    select * into v_cli from public.clientes where id = v_ped.cliente_id;
    select * into v_emp from public.empresas where id = coalesce(v_ped.empresa_id, v_cli.empresa_id);
    select * into v_fil from public.filiais where id = v_ped.filial_id;
    select * into v_cfg from public.fiscal_config
     where tenant_id = current_tenant_id() and (filial_id = v_ped.filial_id or filial_id is null)
       and (empresa_id = v_emp.id or empresa_id is null)
     order by filial_id nulls last, empresa_id nulls last limit 1;
    if v_cfg is null then
      insert into public.fiscal_config (tenant_id, empresa_id) values (current_tenant_id(), v_emp.id)
      returning * into v_cfg;
    end if;

    v_numero := v_cfg.proximo_numero;
    update public.fiscal_config set proximo_numero = proximo_numero + 1 where id = v_cfg.id;

    insert into public.nfe (
      tenant_id, empresa_id, filial_id, pedido_id, cliente_id, deposito_id, numero, serie,
      situacao, ambiente, natureza_operacao, cfop, valor_produtos, valor_total,
      emitente, destinatario, mensagem
    ) values (
      current_tenant_id(), v_emp.id, v_ped.filial_id, p_pedido_id, v_ped.cliente_id, v_dep,
      v_numero, v_cfg.serie, 'rascunho', v_cfg.ambiente,
      'Devolução de venda', '1202', v_total, v_total,
      jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
        'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco,
        'numero', v_emp.numero, 'bairro', v_emp.bairro, 'cidade', v_emp.cidade,
        'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
      jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
        'inscricao_estadual', v_cli.inscricao_estadual, 'endereco', v_cli.endereco, 'numero', v_cli.numero,
        'bairro', v_cli.bairro, 'cidade', v_cli.cidade, 'estado', v_cli.estado, 'cep', v_cli.cep,
        'telefone', v_cli.telefone, 'email', v_cli.email),
      'Nota de devolução (entrada) gerada pela devolução nº ' || v_num
    ) returning id into v_nfe_id;

    insert into public.nfe_itens (
      tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn,
      unidade, quantidade, preco_unitario, custo_unitario, total, aliquota_icms
    )
    select current_tenant_id(), v_nfe_id, p.id, p.codigo_interno, p.descricao, p.ncm,
           '1202', p.cst_csosn, coalesce(di.unidade, p.unidade), di.quantidade,
           di.preco_unitario, di.custo_unitario, di.total, p.aliquota_icms
      from public.devolucao_itens di join public.produtos p on p.id = di.produto_id
     where di.devolucao_id = v_dev_id;

    update public.devolucoes set nfe_id = v_nfe_id where id = v_dev_id;
    perform public.nfe_calcular_impostos(v_nfe_id, null, null, null, null, null, false);
  end if;

  update public.devolucoes set valor_total = v_total, valor_abatido = v_abatido where id = v_dev_id;
  return v_dev_id;
end; $$;
revoke all on function public.devolucao_registrar(uuid, jsonb, text, text, uuid, boolean) from public, anon;
grant execute on function public.devolucao_registrar(uuid, jsonb, text, text, uuid, boolean) to authenticated;