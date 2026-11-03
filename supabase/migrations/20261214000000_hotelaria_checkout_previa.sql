-- Hotelaria (Fase 1, migration 6): prévia do check-out. Diz o que hs_checkout vai fazer SEM fazer: saída que passa a valer, noites cobradas, quanto
-- ainda vai ser lançado (diárias e taxa de turismo das noites que faltam) e o saldo previsto de cada conta. A tela de check-out usa isto para
-- sugerir os pagamentos certos. Mesma regra de noites de hs_checkout (espelho em saidaDoCheckout, src/lib/hotelaria.ts).
-- Pode ser rodado de novo sem erro. Rode antes 20261213000000_hotelaria_leitura.sql.

CREATE OR REPLACE FUNCTION public.hs_checkout_previa(p_reserva_uh uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  ru public.hs_reserva_uhs%ROWTYPE; r public.hs_reservas%ROWTYPE;
  v_hoje date; v_fuso text; v_checkin_dia date; v_primeira date; v_max date; v_nova_saida date;
  v_taxa numeric; v_hosp integer; v_a_lancar numeric := 0; v_noites integer; v_novas integer; v_outros boolean;
  v_principal uuid; v_contas jsonb := '[]'::jsonb; f public.hs_folios%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Só quarto hospedado tem prévia de check-out (situação atual: %)', ru.situacao; END IF;
  SELECT * INTO r FROM public.hs_reservas WHERE id = ru.reserva_id;

  v_hoje := public._hs_hoje(ru.filial_id);
  v_fuso := coalesce((SELECT c.fuso FROM public.hs_config c WHERE c.filial_id = ru.filial_id), 'America/Sao_Paulo');
  v_checkin_dia := (ru.checkin_em AT TIME ZONE v_fuso)::date;
  v_primeira := greatest(ru.entrada, v_checkin_dia);
  SELECT max(x.data) INTO v_max FROM public.hs_diarias x WHERE x.reserva_uh_id = ru.id AND x.lancada;
  v_nova_saida := least(ru.saida, greatest(v_hoje, v_primeira + 1, coalesce(v_max + 1, v_hoje)));

  SELECT c.taxa_turismo_por_hospede_noite INTO v_taxa FROM public.hs_config c WHERE c.filial_id = ru.filial_id;
  SELECT count(*) INTO v_hosp FROM public.hs_reserva_hospedes WHERE reserva_uh_id = ru.id;
  IF v_hosp = 0 THEN v_hosp := ru.adultos + ru.criancas; END IF;
  SELECT coalesce(sum(d.valor + CASE WHEN coalesce(v_taxa, 0) > 0 THEN round(v_hosp * v_taxa, 2) ELSE 0 END), 0), count(*)
    INTO v_a_lancar, v_novas
    FROM public.hs_diarias d WHERE d.reserva_uh_id = ru.id AND NOT d.lancada AND d.data >= v_primeira AND d.data < v_nova_saida;
  SELECT count(*) INTO v_noites FROM public.hs_lancamentos WHERE reserva_uh_id = ru.id AND tipo = 'diaria' AND estorna_id IS NULL;
  v_noites := v_noites + v_novas;

  v_outros := EXISTS (SELECT 1 FROM public.hs_reserva_uhs x WHERE x.reserva_id = r.id AND x.id <> ru.id AND x.situacao IN ('reservada', 'hospedada'));
  SELECT id INTO v_principal FROM public.hs_folios WHERE reserva_id = r.id AND principal;
  IF v_principal IS NULL THEN
    v_contas := jsonb_build_array(jsonb_build_object('folio_id', NULL, 'titulo', 'Conta principal', 'principal', true, 'saldo_atual', 0, 'saldo_previsto', v_a_lancar));
  END IF;
  FOR f IN SELECT * FROM public.hs_folios WHERE reserva_id = r.id AND situacao = 'aberto' ORDER BY principal DESC, created_at LOOP
    v_contas := v_contas || jsonb_build_object('folio_id', f.id, 'titulo', f.titulo, 'principal', f.principal, 'saldo_atual', public._hs_folio_saldo(f.id),
                                              'saldo_previsto', public._hs_folio_saldo(f.id) + CASE WHEN f.principal THEN v_a_lancar ELSE 0 END);
  END LOOP;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'saida', v_nova_saida, 'saida_prevista', ru.saida, 'noites_cobradas', v_noites,
                            'a_lancar', v_a_lancar, 'ultimo_quarto', NOT v_outros, 'contas', v_contas);
END $$;
REVOKE ALL ON FUNCTION public.hs_checkout_previa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_checkout_previa(uuid) TO authenticated;
