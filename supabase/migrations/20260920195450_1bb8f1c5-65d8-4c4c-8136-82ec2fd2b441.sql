alter table public.fiscal_config
  add column if not exists certificado_tipo text default 'A1',
  add column if not exists certificado_titular text,
  add column if not exists certificado_observacoes text,
  add column if not exists nfse_prefeitura text,
  add column if not exists nfse_padrao text,
  add column if not exists nfse_codigo_municipio text,
  add column if not exists nfse_url text,
  add column if not exists nfse_usuario text,
  add column if not exists nfse_token text,
  add column if not exists nfse_codigo_tributacao text,
  add column if not exists nfse_regime_especial text,
  add column if not exists nfse_incentivador_cultural boolean default false,
  add column if not exists nfse_optante_simples boolean default true,
  add column if not exists nfse_iss_retido boolean default false,
  add column if not exists nfse_observacoes text;

create or replace function public.locacao_gerar_nfse(p_locacao_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_loc record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe_id uuid; v_numero integer; v_pend text[] := array[]::text[];
  v_doc text; v_dias integer; v_iss numeric; v_itens integer;
  v_codigo_servico text; v_cert text; v_municipio text;
begin
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada não emite nota'; end if;
  if exists (select 1 from public.nfe where locacao_id = p_locacao_id and situacao <> 'cancelada') then
    raise exception 'Esta locação já tem nota gerada';
  end if;
  if coalesce(v_loc.valor_total, 0) <= 0 then raise exception 'Locação sem valor para emitir nota'; end if;

  select * into v_cli from public.clientes where id = v_loc.cliente_id;
  select * into v_emp from public.empresas where id = coalesce(v_loc.empresa_id, v_cli.empresa_id);
  select * into v_fil from public.filiais where id = v_loc.filial_id;

  -- Alíquotas e dados fiscais: primeiro da loja emitente, depois da empresa.
  select * into v_fil_cfg from public.fiscal_config
   where tenant_id = current_tenant_id() and filial_id = v_loc.filial_id limit 1;
  select * into v_emp_cfg from public.fiscal_config
   where tenant_id = current_tenant_id() and filial_id is null
     and (empresa_id = v_emp.id or empresa_id is null)
   order by empresa_id nulls last limit 1;

  if v_fil_cfg is null and v_emp_cfg is null then
    insert into public.fiscal_config (tenant_id, empresa_id) values (current_tenant_id(), v_emp.id)
    returning * into v_emp_cfg;
  end if;
  v_cfg := coalesce(v_fil_cfg, v_emp_cfg);

  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo_servico := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''),
                          coalesce(v_fil.cidade, v_emp.cidade, ''));

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  if v_doc is null or length(regexp_replace(v_doc, '\D', '', 'g')) not in (11, 14) then
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  end if;
  if coalesce(v_cli.endereco,'') = '' or coalesce(v_cli.cidade,'') = '' then
    v_pend := array_append(v_pend, 'Endereço do cliente incompleto');
  end if;
  if v_emp is null or coalesce(v_emp.cnpj,'') = '' then
    v_pend := array_append(v_pend, 'CNPJ da empresa ausente');
  end if;
  if coalesce(v_emp.inscricao_municipal,'') = '' then
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  end if;
  if v_codigo_servico = '' then
    v_pend := array_append(v_pend, 'Código do serviço municipal não configurado');
  end if;
  if v_iss <= 0 then
    v_pend := array_append(v_pend, 'Alíquota de ISS não configurada');
  end if;
  if v_cert = '' then
    v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado');
  end if;

  if array_length(v_pend, 1) is null then
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    update public.fiscal_config
       set proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 where id = v_cfg.id;
  end if;

  v_dias := greatest(coalesce(v_loc.dias_reais, v_loc.dias, 1), 1);

  insert into public.nfe (
    tenant_id, empresa_id, filial_id, cliente_id, locacao_id, numero, serie, situacao, ambiente,
    modelo, codigo_servico, municipio_prestacao, iss_retido,
    natureza_operacao, cfop, valor_produtos, valor_total, valor_iss,
    emitente, destinatario, pendencias, mensagem
  ) values (
    current_tenant_id(), v_emp.id, v_loc.filial_id, v_loc.cliente_id, p_locacao_id,
    v_numero, coalesce(v_cfg.serie_nfse, 1),
    case when array_length(v_pend,1) is null then 'pronta' else 'rascunho' end,
    v_cfg.ambiente, 'nfse', v_codigo_servico, v_municipio,
    coalesce(v_cfg.nfse_iss_retido, false),
    'Prestação de serviço — locação de bens móveis', null,
    v_loc.valor_total, v_loc.valor_total, round(v_loc.valor_total * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'inscricao_municipal', v_emp.inscricao_municipal, 'inscricao_estadual', v_emp.inscricao_estadual,
      'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero,
      'bairro', v_cli.bairro, 'cidade', v_cli.cidade, 'estado', v_cli.estado, 'cep', v_cli.cep,
      'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    case when array_length(v_pend,1) is null
      then 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      else 'NFS-e em rascunho: resolva as pendências listadas.' end
  ) returning id into v_nfe_id;

  insert into public.nfe_itens (
    tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total, cst_csosn
  )
  select current_tenant_id(), v_nfe_id,
         'Locação de ' || e.nome || ' — ' || li.dias || ' dia(s)',
         'DIA', li.dias * li.quantidade,
         case when li.dias > 0 then round(li.total / (li.dias * greatest(li.quantidade,1)), 2) else li.total end,
         li.total, '400'
    from public.locacao_itens li
    join public.locacao_equipamentos e on e.id = li.equipamento_id
   where li.locacao_id = p_locacao_id;

  select count(*) into v_itens from public.nfe_itens where nfe_id = v_nfe_id;
  if v_itens = 0 then
    insert into public.nfe_itens (
      tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total, cst_csosn
    ) values (
      current_tenant_id(), v_nfe_id,
      'Locação de ' || coalesce((select nome from public.locacao_equipamentos where id = v_loc.equipamento_id), 'equipamento')
        || ' — ' || v_dias || ' dia(s)',
      'DIA', v_dias, round(v_loc.valor_total / v_dias, 2), v_loc.valor_total, '400'
    );
  end if;

  -- Mesmos impostos das notas de venda: alíquotas da loja emitente, item a item e nos totais.
  perform public.nfe_calcular_impostos(v_nfe_id);

  update public.locacoes set nfe_id = v_nfe_id where id = p_locacao_id;
  return v_nfe_id;
end; $$;

revoke all on function public.locacao_gerar_nfse(uuid) from public, anon;
grant execute on function public.locacao_gerar_nfse(uuid) to authenticated;