DO $migration$
DECLARE definition text; old_insert text := 'INSERT INTO public.clientes (id, tenant_id, nome, telefone, whatsapp, observacoes)
    VALUES (v_cli_id, v_tenant, v_nome_tutor, v_fone, v_fone, v_obs);';
BEGIN
 definition := pg_get_functiondef('public.clinica_cadastro_rapido(uuid,jsonb)'::regprocedure);
 IF position(old_insert in definition)=0 THEN RAISE EXCEPTION 'Cadastro clínico mudou: revisar antes de alterar'; END IF;
 definition := replace(definition,old_insert,$new$
    IF coalesce(v_cli->>'tipo','PF') NOT IN ('PF','PJ') THEN RAISE EXCEPTION 'Tipo de tutor inválido'; END IF;
    IF nullif(v_cli->>'cpf','') IS NOT NULL AND coalesce(v_cli->>'tipo','PF') <> 'PF' THEN RAISE EXCEPTION 'CPF só para pessoa física'; END IF;
    IF nullif(v_cli->>'cnpj','') IS NOT NULL AND coalesce(v_cli->>'tipo','PF') <> 'PJ' THEN RAISE EXCEPTION 'CNPJ só para pessoa jurídica'; END IF;
    IF v_cli ? 'aceita_mensagens' AND jsonb_typeof(v_cli->'aceita_mensagens') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'Preferência de mensagens inválida'; END IF;
    INSERT INTO public.clientes(id,tenant_id,nome,telefone,whatsapp,observacoes,tipo,cpf,cnpj,nome_fantasia,inscricao_estadual,email,cep,endereco,numero,complemento,bairro,cidade,estado,aceita_mensagens)
    VALUES(v_cli_id,v_tenant,v_nome_tutor,v_fone,
      CASE WHEN v_cli ? 'whatsapp' THEN nullif(btrim(v_cli->>'whatsapp'),'') ELSE v_fone END,
      concat_ws(E'\n',nullif(btrim(v_cli->>'observacoes'),''),v_obs),
      coalesce(v_cli->>'tipo','PF')::public.pessoa_tipo,
      nullif(btrim(v_cli->>'cpf'),''),nullif(btrim(v_cli->>'cnpj'),''),
      nullif(btrim(v_cli->>'nome_fantasia'),''),nullif(btrim(v_cli->>'inscricao_estadual'),''),nullif(btrim(v_cli->>'email'),''),
      nullif(regexp_replace(coalesce(v_cli->>'cep',''),'\D','','g'),''),nullif(btrim(v_cli->>'endereco'),''),
      nullif(btrim(v_cli->>'numero'),''),nullif(btrim(v_cli->>'complemento'),''),nullif(btrim(v_cli->>'bairro'),''),
      nullif(btrim(v_cli->>'cidade'),''),nullif(upper(btrim(v_cli->>'estado')),''),coalesce((v_cli->>'aceita_mensagens')::boolean,true));
$new$);
 EXECUTE definition;
END $migration$;