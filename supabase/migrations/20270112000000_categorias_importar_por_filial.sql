-- Importar categorias do texto antigo respeitando o acesso por filial.
-- A função (SECURITY DEFINER) olhava e atualizava os títulos da empresa inteira; para quem é preso a uma filial,
-- o gatilho filial_protege_trg de contas_pagar recusava a troca em título de outra filial e desfazia a importação toda.
-- Agora a descoberta do texto e a ligação dos títulos valem só para as filiais que a pessoa acessa (pode_filial).
-- Só muda financeiro_categorias_importar_texto (demais regras iguais à migração 20270111).

CREATE OR REPLACE FUNCTION public.financeiro_categorias_importar_texto()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  t record; v_cat uuid; v_nome text; v_grupo text; v_criadas int := 0; v_ligados int := 0; n int;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Categorias financeiras só pelo administrador, gestor ou financeiro';
  END IF;

  FOR t IN SELECT DISTINCT btrim(categoria) AS texto FROM public.contas_pagar
            WHERE tenant_id = v_tenant AND categoria_id IS NULL AND length(btrim(coalesce(categoria, ''))) >= 2
              AND public.pode_filial(filial_id)
  LOOP
    -- o que o recebimento de compra grava ("Mercadorias") é estoque, não despesa do período
    IF lower(t.texto) = 'mercadorias' THEN v_nome := 'Compra de mercadorias (estoque)'; v_grupo := 'fora_dre';
    ELSE v_nome := left(t.texto, 80); v_grupo := 'operacional'; END IF;

    SELECT id INTO v_cat FROM public.financeiro_categorias
     WHERE tenant_id = v_tenant AND tipo = 'despesa' AND lower(btrim(nome)) = lower(v_nome);
    IF v_cat IS NULL THEN
      INSERT INTO public.financeiro_categorias (tenant_id, nome, tipo, grupo) VALUES (v_tenant, v_nome, 'despesa', v_grupo)
      RETURNING id INTO v_cat;
      v_criadas := v_criadas + 1;
    END IF;
    UPDATE public.contas_pagar SET categoria_id = v_cat
     WHERE tenant_id = v_tenant AND categoria_id IS NULL AND btrim(categoria) = t.texto
       AND public.pode_filial(filial_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    v_ligados := v_ligados + n;
  END LOOP;
  RETURN jsonb_build_object('categorias_criadas', v_criadas, 'titulos_ligados', v_ligados);
END $$;
