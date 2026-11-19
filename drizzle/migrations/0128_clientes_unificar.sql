CREATE OR REPLACE FUNCTION public.cliente_unificar(p_manter uuid, p_duplicado uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  m public.clientes; d public.clientes; v_pets int;
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador','gestor']);
  IF p_manter IS NULL OR p_duplicado IS NULL OR p_manter = p_duplicado THEN
    RAISE EXCEPTION 'Escolha dois cadastros diferentes.';
  END IF;
  SELECT * INTO m FROM public.clientes WHERE id = p_manter AND tenant_id = v_tenant AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO d FROM public.clientes WHERE id = p_duplicado AND tenant_id = v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF m.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;

  UPDATE public.pets SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_pets = ROW_COUNT;
  UPDATE public.pet_agendamentos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.pet_pacotes SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.clinica_cadastros_rapidos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.clinica_cadastros_rapidos SET possivel_duplicado_de = p_manter WHERE possivel_duplicado_de = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.orcamentos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.pedidos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.contas_receber SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.credito_autorizacoes SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.os_ordens SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.locacoes SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.devolucoes SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.obras SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.lr_veiculos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.lr_ordens SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.lr_contatos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.lr_assinaturas SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.lr_agendamentos SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.wa_mensagens SET cliente_id = p_manter WHERE cliente_id = p_duplicado AND tenant_id = v_tenant;
  UPDATE public.hs_reservas SET pagador_cliente_id = p_manter WHERE pagador_cliente_id = p_duplicado AND tenant_id = v_tenant;

  UPDATE public.clientes SET
    telefone = coalesce(nullif(m.telefone,''), d.telefone),
    whatsapp = coalesce(nullif(m.whatsapp,''), d.whatsapp),
    email = coalesce(nullif(m.email,''), d.email),
    cep = coalesce(nullif(m.cep,''), d.cep),
    endereco = coalesce(nullif(m.endereco,''), d.endereco),
    numero = coalesce(nullif(m.numero,''), d.numero),
    complemento = coalesce(nullif(m.complemento,''), d.complemento),
    bairro = coalesce(nullif(m.bairro,''), d.bairro),
    cidade = coalesce(nullif(m.cidade,''), d.cidade),
    estado = coalesce(nullif(m.estado,''), d.estado),
    saldo_utilizado = coalesce(m.saldo_utilizado,0) + coalesce(d.saldo_utilizado,0),
    updated_at = now()
  WHERE id = p_manter;

  UPDATE public.clientes SET ativo = false, saldo_utilizado = 0,
    observacoes = left(concat_ws(E'\n', nullif(d.observacoes,''), 'Unificado em ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY') || ' com ' || m.nome), 2000),
    updated_at = now()
  WHERE id = p_duplicado;

  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (v_tenant, auth.uid(), 'clientes', p_duplicado, 'unificar', to_jsonb(d), jsonb_build_object('mantido', p_manter, 'pets', v_pets));

  RETURN jsonb_build_object('pets', v_pets);
END $$;
REVOKE ALL ON FUNCTION public.cliente_unificar(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_unificar(uuid,uuid) TO authenticated;