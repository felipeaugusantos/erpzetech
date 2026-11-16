DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.clinica_vacina_catalogo_salvar(jsonb)'::regprocedure);
  IF position('criar_produto_dose' in d) = 0 THEN
    d := replace(d, '  IF coalesce((p_dados ->> ''confirmar_controle_lote'')::boolean, false) THEN', '  IF coalesce((p_dados ->> ''criar_produto_dose'')::boolean, false) THEN
    IF v_prod IS NOT NULL THEN RAISE EXCEPTION ''Escolha uma dose existente ou cadastre uma nova, não as duas''; END IF;
    v_prod := nullif(p_dados ->> ''novo_produto_id'', '''')::uuid;
    IF v_prod IS NULL THEN RAISE EXCEPTION ''Identificador da dose não informado''; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(''clinica_dose:'' || v_prod::text, 0));
    IF EXISTS (SELECT 1 FROM public.produtos WHERE id = v_prod) THEN
      PERFORM 1 FROM public.produtos WHERE id = v_prod AND tenant_id = v_tenant AND descricao = v_nome AND ativo AND controla_estoque AND controla_lote;
      IF NOT FOUND THEN RAISE EXCEPTION ''Dose não encontrada nesta empresa''; END IF;
    ELSE
      INSERT INTO public.produtos (id, tenant_id, codigo_interno, descricao, unidade, controla_estoque, controla_lote, ativo, custo, preco_venda)
      VALUES (v_prod, v_tenant, ''DOSE-'' || v_prod::text, v_nome, ''UN'', true, true, true, 0, 0);
    END IF;
  END IF;
  IF coalesce((p_dados ->> ''confirmar_controle_lote'')::boolean, false) THEN');
    IF position('criar_produto_dose' in d) = 0 THEN RAISE EXCEPTION 'Trecho esperado do catálogo não encontrado'; END IF;
    EXECUTE d;
  END IF;
END $$;