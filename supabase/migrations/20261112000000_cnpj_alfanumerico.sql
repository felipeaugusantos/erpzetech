-- CNPJ alfanumérico (Receita, 2026): "empresa com CNPJ" passa a contar letras e números (14 caracteres),
-- igual à tela. Antes só números eram contados e um CNPJ com letras liberava a escolha manual de módulos.
CREATE OR REPLACE FUNCTION public.clinica_liberada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (
 EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'clinica')
 OR e.ramo_atividade = 'clinica'
 OR (length(regexp_replace(coalesce(e.cnpj,''), '[^0-9A-Za-z]','','g')) < 14 AND 'clinica' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '7500%')))
$function$;
REVOKE ALL ON FUNCTION public.clinica_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_liberada() TO authenticated;

-- A importação de clientes por planilha também guarda o CNPJ com letras (maiúsculas): antes as letras eram
-- descartadas e um CNPJ com 3 letras virava um CPF de 11 dígitos.
CREATE OR REPLACE FUNCTION public.importar_clientes(
  p_linhas jsonb, p_atualizar boolean DEFAULT false, p_simular boolean DEFAULT false, p_arquivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb;
  v_linha integer;
  v_nome text; v_doc text; v_chave text; v_exist uuid; v_del timestamptz;
  v_limite numeric; v_prazo numeric; v_uf text; v_email text;
  v_erros jsonb := '[]'::jsonb;
  v_n_erros integer := 0;
  v_ok jsonb := '[]'::jsonb;
  v_vistos text[] := '{}';
  v_criar integer := 0;
  v_atual integer := 0;
  r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar';
  END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN
    RAISE EXCEPTION 'Cada importação aceita no máximo 5000 linhas (a planilha tem %)', jsonb_array_length(p_linhas);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('importacao:clientes:' || v_tenant::text, 0)) THEN
    RAISE EXCEPTION 'Já existe uma importação de clientes em andamento. Aguarde terminar e tente de novo';
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_linha := coalesce((it ->> 'linha')::integer, 0);
    v_nome := btrim(coalesce(it ->> 'nome', ''));
    v_doc := upper(regexp_replace(coalesce(it ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g'));
    v_uf := nullif(upper(btrim(coalesce(it ->> 'estado', ''))), '');
    v_email := nullif(btrim(coalesce(it ->> 'email', '')), '');
    BEGIN
      v_limite := public._imp_num(it, 'limite_credito');
      v_prazo := public._imp_num(it, 'prazo_padrao_dias');
    EXCEPTION WHEN OTHERS THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, SQLERRM); CONTINUE;
    END;

    IF v_nome = '' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Informe o nome do cliente'); CONTINUE;
    END IF;
    IF length(v_nome) > 200 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Nome com mais de 200 caracteres'); CONTINUE;
    END IF;
    IF v_doc <> '' AND length(v_doc) NOT IN (11, 14) THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'CPF deve ter 11 números e CNPJ 14'); CONTINUE;
    END IF;
    IF (length(v_doc) = 11 AND v_doc !~ '^[0-9]{11}$') OR (length(v_doc) = 14 AND v_doc !~ '^[0-9A-Z]{12}[0-9]{2}$') THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, 'Documento inválido: CPF só com números; CNPJ com letras ou números e 2 dígitos finais numéricos'); CONTINUE;
    END IF;
    IF v_uf IS NOT NULL AND length(v_uf) <> 2 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Estado deve ter 2 letras (ex.: SP)'); CONTINUE;
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'E-mail inválido'); CONTINUE;
    END IF;
    IF coalesce(v_limite, 0) < 0 OR coalesce(v_prazo, 0) < 0 THEN
      v_n_erros := v_n_erros + 1; v_erros := public._imp_erro(v_erros, v_linha, 'Limite de crédito e prazo não podem ser negativos'); CONTINUE;
    END IF;

    v_chave := CASE WHEN v_doc <> '' THEN 'd:' || v_doc ELSE 'n:' || lower(v_nome) END;
    IF v_chave = ANY (v_vistos) THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('Cliente repetido na planilha (%s)', CASE WHEN v_doc <> '' THEN v_doc ELSE v_nome END));
      CONTINUE;
    END IF;
    v_vistos := array_append(v_vistos, v_chave);

    v_exist := NULL; v_del := NULL;
    IF v_doc <> '' THEN
      SELECT id, deleted_at INTO v_exist, v_del FROM public.clientes
       WHERE tenant_id = v_tenant AND upper(regexp_replace(coalesce(cpf, '') || coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')) = v_doc
       ORDER BY deleted_at NULLS FIRST LIMIT 1;
    ELSE
      SELECT id, deleted_at INTO v_exist, v_del FROM public.clientes
       WHERE tenant_id = v_tenant AND lower(nome) = lower(v_nome) AND coalesce(cpf, '') = '' AND coalesce(cnpj, '') = ''
       ORDER BY deleted_at NULLS FIRST LIMIT 1;
    END IF;
    IF v_exist IS NOT NULL AND v_del IS NOT NULL THEN
      v_exist := NULL;  -- cliente excluído: entra como novo cadastro
    END IF;
    IF v_exist IS NOT NULL AND NOT p_atualizar THEN
      v_n_erros := v_n_erros + 1;
      v_erros := public._imp_erro(v_erros, v_linha, format('O cliente %s já existe (marque "atualizar os que já existem" para alterá-lo)',
                                  CASE WHEN v_doc <> '' THEN v_doc ELSE v_nome END));
      CONTINUE;
    END IF;

    v_ok := v_ok || jsonb_build_array(jsonb_build_object(
      'nome', v_nome, 'doc', nullif(v_doc, ''), 'fantasia', nullif(btrim(coalesce(it ->> 'nome_fantasia', '')), ''),
      'ie', nullif(btrim(coalesce(it ->> 'inscricao_estadual', '')), ''), 'tel', nullif(btrim(coalesce(it ->> 'telefone', '')), ''),
      'zap', nullif(btrim(coalesce(it ->> 'whatsapp', '')), ''), 'email', v_email,
      'cep', nullif(regexp_replace(coalesce(it ->> 'cep', ''), '\D', '', 'g'), ''),
      'endereco', nullif(btrim(coalesce(it ->> 'endereco', '')), ''), 'numero', nullif(btrim(coalesce(it ->> 'numero', '')), ''),
      'compl', nullif(btrim(coalesce(it ->> 'complemento', '')), ''), 'bairro', nullif(btrim(coalesce(it ->> 'bairro', '')), ''),
      'cidade', nullif(btrim(coalesce(it ->> 'cidade', '')), ''), 'uf', v_uf, 'limite', v_limite, 'prazo', v_prazo,
      'exist', v_exist));
    IF v_exist IS NULL THEN v_criar := v_criar + 1; ELSE v_atual := v_atual + 1; END IF;
  END LOOP;

  IF v_n_erros > 0 THEN
    RETURN jsonb_build_object('ok', false, 'simulado', p_simular, 'total', jsonb_array_length(p_linhas),
                              'n_erros', v_n_erros, 'erros', v_erros);
  END IF;
  IF p_simular THEN
    RETURN jsonb_build_object('ok', true, 'simulado', true, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                              'erros', '[]'::jsonb, 'criados', v_criar, 'atualizados', v_atual);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(v_ok) LOOP
    IF r ->> 'exist' IS NULL THEN
      INSERT INTO public.clientes (tenant_id, tipo, nome, nome_fantasia, cpf, cnpj, inscricao_estadual, telefone, whatsapp, email,
                                   cep, endereco, numero, complemento, bairro, cidade, estado, limite_credito, prazo_padrao_dias)
      VALUES (v_tenant,
              CASE WHEN length(coalesce(r ->> 'doc', '')) = 14 THEN 'PJ'::public.pessoa_tipo ELSE 'PF'::public.pessoa_tipo END,
              r ->> 'nome', r ->> 'fantasia',
              CASE WHEN length(coalesce(r ->> 'doc', '')) = 11 THEN r ->> 'doc' END,
              CASE WHEN length(coalesce(r ->> 'doc', '')) = 14 THEN r ->> 'doc' END,
              r ->> 'ie', r ->> 'tel', r ->> 'zap', r ->> 'email', r ->> 'cep', r ->> 'endereco', r ->> 'numero', r ->> 'compl',
              r ->> 'bairro', r ->> 'cidade', r ->> 'uf', coalesce((r ->> 'limite')::numeric, 0),
              coalesce((r ->> 'prazo')::numeric, 0)::integer);
    ELSE
      UPDATE public.clientes SET
        nome = r ->> 'nome',
        nome_fantasia = coalesce(r ->> 'fantasia', nome_fantasia),
        inscricao_estadual = coalesce(r ->> 'ie', inscricao_estadual),
        telefone = coalesce(r ->> 'tel', telefone),
        whatsapp = coalesce(r ->> 'zap', whatsapp),
        email = coalesce(r ->> 'email', email),
        cep = coalesce(r ->> 'cep', cep),
        endereco = coalesce(r ->> 'endereco', endereco),
        numero = coalesce(r ->> 'numero', numero),
        complemento = coalesce(r ->> 'compl', complemento),
        bairro = coalesce(r ->> 'bairro', bairro),
        cidade = coalesce(r ->> 'cidade', cidade),
        estado = coalesce(r ->> 'uf', estado),
        limite_credito = coalesce((r ->> 'limite')::numeric, limite_credito),
        prazo_padrao_dias = coalesce((r ->> 'prazo')::numeric, prazo_padrao_dias)::integer
      WHERE id = (r ->> 'exist')::uuid AND tenant_id = v_tenant;
    END IF;
  END LOOP;

  INSERT INTO public.importacoes (tenant_id, tipo, arquivo, linhas, criados, atualizados)
  VALUES (v_tenant, 'clientes', left(p_arquivo, 200), jsonb_array_length(p_linhas), v_criar, v_atual);

  RETURN jsonb_build_object('ok', true, 'simulado', false, 'total', jsonb_array_length(p_linhas), 'n_erros', 0,
                            'erros', '[]'::jsonb, 'criados', v_criar, 'atualizados', v_atual);
END $$;
REVOKE ALL ON FUNCTION public.importar_clientes(jsonb, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_clientes(jsonb, boolean, boolean, text) TO authenticated;
