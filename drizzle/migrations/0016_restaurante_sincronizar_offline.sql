ALTER TABLE public.comandas ADD COLUMN IF NOT EXISTS offline_id text;
CREATE UNIQUE INDEX IF NOT EXISTS comandas_offline_id_uk ON public.comandas (tenant_id, offline_id) WHERE offline_id IS NOT NULL;

-- Recebe uma comanda feita sem internet e grava tudo de uma vez (idempotente pelo offline_id).
CREATE OR REPLACE FUNCTION public.restaurante_sincronizar_offline(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador','gestor','garcom','caixa']::public.app_role[]);
  v_off text := nullif(btrim(p->>'offline_id'), '');
  v_id uuid;
  v_num bigint;
  v_it jsonb;
  v_d jsonb := coalesce(p->'delivery', '{}'::jsonb);
  v_f jsonb := p->'fechar';
BEGIN
  IF v_off IS NULL THEN RAISE EXCEPTION 'Comanda sem identificação local'; END IF;
  SELECT id, numero INTO v_id, v_num FROM public.comandas WHERE tenant_id = v_tenant AND offline_id = v_off;
  IF FOUND THEN
    RETURN jsonb_build_object('comanda_id', v_id, 'numero', v_num, 'ja_existia', true);
  END IF;

  IF p->>'tipo' = 'delivery' THEN
    v_id := public.restaurante_abrir_delivery(v_d->>'cliente', v_d->>'telefone', v_d->>'endereco',
      v_d->>'bairro', v_d->>'referencia', coalesce((v_d->>'taxa')::numeric, 0),
      nullif(v_d->>'pagamento', ''), (v_d->>'troco_para')::numeric, v_d->>'observacao');
  ELSE
    BEGIN
      v_id := public.restaurante_abrir_comanda(nullif(p->>'mesa_id','')::uuid, (p->>'pessoas')::int,
        nullif(p->>'cliente_nome',''), coalesce((p->>'taxa_servico')::numeric, 10), 0);
    EXCEPTION WHEN OTHERS THEN
      -- mesa ocupada por outra comanda enquanto estava sem internet: entra como avulsa
      v_id := public.restaurante_abrir_comanda(NULL, (p->>'pessoas')::int,
        coalesce(nullif(p->>'mesa_rotulo',''), 'Comanda') || ' (sem internet)', coalesce((p->>'taxa_servico')::numeric, 10), 0);
    END;
  END IF;

  UPDATE public.comandas SET offline_id = v_off WHERE id = v_id RETURNING numero INTO v_num;

  FOR v_it IN SELECT * FROM jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) LOOP
    PERFORM public.restaurante_lancar_item(v_id, (v_it->>'cardapio_item_id')::uuid,
      coalesce((v_it->>'quantidade')::numeric, 1), '{}'::uuid[], nullif(v_it->>'observacao',''));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.comanda_itens WHERE comanda_id = v_id AND situacao = 'pendente') THEN
    PERFORM public.restaurante_enviar_cozinha(v_id);
  END IF;

  IF v_f IS NOT NULL AND jsonb_typeof(v_f) = 'object' THEN
    -- já foi servido e pago sem internet
    UPDATE public.comanda_itens
       SET situacao = 'entregue', pronto_em = coalesce(pronto_em, now()), entregue_em = now()
     WHERE comanda_id = v_id AND situacao IN ('enviado','preparando','pronto');
    PERFORM public.restaurante_fechar_comanda(v_id, coalesce(v_f->'pagamentos','[]'::jsonb),
      nullif(v_f->>'caixa_id','')::uuid, 0, coalesce((v_f->>'cobrar_servico')::boolean, true));
  END IF;

  RETURN jsonb_build_object('comanda_id', v_id, 'numero', v_num, 'ja_existia', false);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_sincronizar_offline(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_sincronizar_offline(jsonb) TO authenticated;