-- Hotelaria (Fase 1, migration 5): leituras para as telas: mapa de ocupação (grade acomodação × dia), painel do dia da recepção, resumo da conta
-- do hóspede e resumo da reserva. Só leitura (STABLE), com a mesma porta de entrada das demais funções (salão, papel, módulo e hotel).
-- Especificação: docs/hotelaria-fase-1.md. Pode ser rodado de novo sem erro. Rode antes 20261212000000_hotelaria_checkout_nfse.sql.

-- ============ mapa de ocupação ============
-- Janela [p_de, p_ate) de no máximo 62 dias. Devolve:
--   dias: as datas da janela;
--   uhs: cada acomodação ativa (ordem: tipo, número) com as ocupações que tocam a janela (reservas e bloqueios, com as datas reais de entrada e saída);
--   totais_por_dia: por noite, acomodações vendáveis (ativas e não interditadas), ocupadas por reserva, bloqueadas e livres;
--   sem_acomodacao: quartos reservados que ainda não têm acomodação (reservas de canais) e tocam a janela.
CREATE OR REPLACE FUNCTION public.hs_mapa(p_filial uuid, p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_per daterange; v_dias jsonb; v_uhs jsonb; v_tot jsonb; v_sem jsonb; v_vendaveis integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate <= p_de THEN RAISE EXCEPTION 'A data final precisa ser depois da inicial'; END IF;
  IF p_ate - p_de > 62 THEN RAISE EXCEPTION 'O mapa mostra no máximo 62 dias por vez'; END IF;
  v_per := daterange(p_de, p_ate, '[)');

  SELECT jsonb_agg(p_de + i ORDER BY i) INTO v_dias FROM generate_series(0, p_ate - p_de - 1) i;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'uh_id', u.id, 'numero', u.numero, 'andar', u.andar, 'tipo_id', t.id, 'tipo', t.nome, 'situacao_limpeza', u.situacao_limpeza,
           'interditada', u.interditada, 'motivo_interdicao', u.motivo_interdicao,
           'ocupacoes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                           'id', o.id, 'origem', o.origem, 'de', lower(o.periodo), 'ate', upper(o.periodo), 'motivo', o.motivo,
                           'reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'situacao', ru.situacao,
                           'reserva_situacao', r.situacao, 'titular', h.nome, 'adultos', ru.adultos, 'criancas', ru.criancas)
                         ORDER BY lower(o.periodo), o.id), '[]'::jsonb)
                          FROM public.hs_ocupacoes o
                          LEFT JOIN public.hs_reserva_uhs ru ON ru.id = o.reserva_uh_id
                          LEFT JOIN public.hs_reservas r ON r.id = ru.reserva_id
                          LEFT JOIN public.hs_hospedes h ON h.id = r.titular_id
                         WHERE o.uh_id = u.id AND o.periodo && v_per))
           ORDER BY t.nome, length(u.numero), u.numero), '[]'::jsonb)
    INTO v_uhs
    FROM public.hs_uhs u JOIN public.hs_tipos_uh t ON t.id = u.tipo_id
   WHERE u.filial_id = p_filial AND u.tenant_id = v_tenant AND u.ativo;

  SELECT count(*) INTO v_vendaveis FROM public.hs_uhs u WHERE u.filial_id = p_filial AND u.tenant_id = v_tenant AND u.ativo AND NOT u.interditada;

  SELECT jsonb_agg(jsonb_build_object(
           'data', dia, 'total', v_vendaveis,
           'ocupadas', (SELECT count(DISTINCT o.uh_id) FROM public.hs_ocupacoes o JOIN public.hs_uhs u ON u.id = o.uh_id
                         WHERE o.origem = 'reserva' AND o.filial_id = p_filial AND u.ativo AND NOT u.interditada AND o.periodo @> dia),
           'bloqueadas', (SELECT count(DISTINCT o.uh_id) FROM public.hs_ocupacoes o JOIN public.hs_uhs u ON u.id = o.uh_id
                           WHERE o.origem = 'bloqueio' AND o.filial_id = p_filial AND u.ativo AND NOT u.interditada AND o.periodo @> dia),
           'livres', v_vendaveis
                     - (SELECT count(DISTINCT o.uh_id) FROM public.hs_ocupacoes o JOIN public.hs_uhs u ON u.id = o.uh_id
                         WHERE o.filial_id = p_filial AND u.ativo AND NOT u.interditada AND o.periodo @> dia)) ORDER BY dia)
    INTO v_tot FROM (SELECT p_de + i AS dia FROM generate_series(0, p_ate - p_de - 1) i) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'tipo_id', t.id, 'tipo', t.nome,
           'entrada', ru.entrada, 'saida', ru.saida, 'adultos', ru.adultos, 'criancas', ru.criancas, 'titular', h.nome) ORDER BY ru.entrada, r.numero), '[]'::jsonb)
    INTO v_sem
    FROM public.hs_reserva_uhs ru JOIN public.hs_reservas r ON r.id = ru.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
    JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id
   WHERE ru.filial_id = p_filial AND ru.tenant_id = v_tenant AND ru.uh_id IS NULL AND ru.situacao = 'reservada' AND ru.entrada < p_ate AND ru.saida > p_de;

  RETURN jsonb_build_object('filial_id', p_filial, 'de', p_de, 'ate', p_ate, 'dias', v_dias, 'uhs', v_uhs, 'totais_por_dia', v_tot, 'sem_acomodacao', v_sem);
END $$;
REVOKE ALL ON FUNCTION public.hs_mapa(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_mapa(uuid, date, date) TO authenticated;

-- ============ painel do dia ============
-- O que a recepção precisa no dia p_data (padrão: hoje no fuso do hotel):
--   chegadas / saidas: previstas para o dia, com a situação (feitas ou não);
--   chegadas_atrasadas / saidas_atrasadas: só quando o dia é hoje ou futuro (reserva que devia ter chegado e quarto que devia ter saído);
--   hospedados: quem dormiu no hotel na noite do dia;
--   ocupacao: acomodações vendáveis (sem as bloqueadas no dia), ocupadas, bloqueadas, livres e percentual de ocupação;
--   sujas: acomodações sujas; contas_em_aberto: contas abertas com saldo a receber.
CREATE OR REPLACE FUNCTION public.hs_painel_dia(p_filial uuid, p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date; v_data date; v_fuso text;
  v_cheg jsonb; v_said jsonb; v_cheg_at jsonb; v_said_at jsonb; v_hosp jsonb; v_sujas jsonb; v_contas jsonb;
  v_total integer; v_bloq integer; v_ocup integer; v_vend integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  v_hoje := public._hs_hoje(p_filial);
  v_data := coalesce(p_data, v_hoje);
  v_fuso := coalesce((SELECT c.fuso FROM public.hs_config c WHERE c.filial_id = p_filial), 'America/Sao_Paulo');

  -- cada quarto com o que a recepção precisa ver: titular, acomodação, tipo e o saldo da reserva
  SELECT coalesce(jsonb_agg(q.j ORDER BY q.entrada, q.numero), '[]'::jsonb) INTO v_cheg FROM (
    SELECT ru.entrada, r.numero, jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'situacao', ru.situacao,
             'pendente', r.situacao = 'pendente', 'titular', h.nome, 'uh', u.numero, 'tipo', t.nome, 'adultos', ru.adultos, 'criancas', ru.criancas,
             'saida', ru.saida, 'saldo', (SELECT coalesce(sum(public._hs_folio_saldo(f.id)), 0) FROM public.hs_folios f WHERE f.reserva_id = r.id)) AS j
      FROM public.hs_reserva_uhs ru JOIN public.hs_reservas r ON r.id = ru.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
      JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
     WHERE ru.filial_id = p_filial AND ru.tenant_id = v_tenant AND ru.entrada = v_data AND ru.situacao IN ('reservada', 'hospedada', 'no_show')) q;

  SELECT coalesce(jsonb_agg(q.j ORDER BY q.numero), '[]'::jsonb) INTO v_said FROM (
    SELECT r.numero, jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'situacao', ru.situacao, 'titular', h.nome,
             'uh', u.numero, 'tipo', t.nome, 'entrada', ru.entrada, 'saida', ru.saida,
             'saldo', (SELECT coalesce(sum(public._hs_folio_saldo(f.id)), 0) FROM public.hs_folios f WHERE f.reserva_id = r.id)) AS j
      FROM public.hs_reserva_uhs ru JOIN public.hs_reservas r ON r.id = ru.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
      JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
     WHERE ru.filial_id = p_filial AND ru.tenant_id = v_tenant AND ru.saida = v_data AND ru.situacao IN ('hospedada', 'finalizada')) q;

  IF v_data >= v_hoje THEN
    SELECT coalesce(jsonb_agg(q.j ORDER BY q.entrada, q.numero), '[]'::jsonb) INTO v_cheg_at FROM (
      SELECT ru.entrada, r.numero, jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'situacao', ru.situacao,
               'pendente', r.situacao = 'pendente', 'titular', h.nome, 'uh', u.numero, 'tipo', t.nome, 'entrada', ru.entrada, 'saida', ru.saida) AS j
        FROM public.hs_reserva_uhs ru JOIN public.hs_reservas r ON r.id = ru.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
        JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
       WHERE ru.filial_id = p_filial AND ru.tenant_id = v_tenant AND ru.situacao = 'reservada' AND ru.entrada < v_data AND ru.saida > v_data) q;
    SELECT coalesce(jsonb_agg(q.j ORDER BY q.saida, q.numero), '[]'::jsonb) INTO v_said_at FROM (
      SELECT ru.saida, r.numero, jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'situacao', ru.situacao, 'titular', h.nome,
               'uh', u.numero, 'tipo', t.nome, 'entrada', ru.entrada, 'saida', ru.saida,
               'saldo', (SELECT coalesce(sum(public._hs_folio_saldo(f.id)), 0) FROM public.hs_folios f WHERE f.reserva_id = r.id)) AS j
        FROM public.hs_reserva_uhs ru JOIN public.hs_reservas r ON r.id = ru.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
        JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
       WHERE ru.filial_id = p_filial AND ru.tenant_id = v_tenant AND ru.situacao = 'hospedada' AND ru.saida < v_data) q;
  ELSE
    v_cheg_at := '[]'::jsonb; v_said_at := '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(q.j ORDER BY q.uh_ord, q.numero), '[]'::jsonb) INTO v_hosp FROM (
    SELECT length(coalesce(u.numero, '')) AS uh_ord, r.numero, jsonb_build_object('reserva_uh_id', ru.id, 'reserva_id', r.id, 'reserva_numero', r.numero, 'titular', h.nome,
             'uh', u.numero, 'tipo', t.nome, 'entrada', ru.entrada, 'saida', ru.saida, 'adultos', ru.adultos, 'criancas', ru.criancas,
             'hospedes', (SELECT count(*) FROM public.hs_reserva_hospedes rh WHERE rh.reserva_uh_id = ru.id),
             'saldo', (SELECT coalesce(sum(public._hs_folio_saldo(f.id)), 0) FROM public.hs_folios f WHERE f.reserva_id = r.id)) AS j
      FROM public.hs_reserva_uhs ru JOIN public.hs_reservas r ON r.id = ru.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
      JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
     WHERE ru.filial_id = p_filial AND ru.tenant_id = v_tenant AND ru.situacao IN ('hospedada', 'finalizada')
       AND ru.entrada <= v_data AND ru.saida > v_data AND (ru.checkin_em AT TIME ZONE v_fuso)::date <= v_data) q;

  SELECT count(*) INTO v_total FROM public.hs_uhs u WHERE u.filial_id = p_filial AND u.tenant_id = v_tenant AND u.ativo AND NOT u.interditada;
  SELECT count(DISTINCT o.uh_id) INTO v_ocup FROM public.hs_ocupacoes o JOIN public.hs_uhs u ON u.id = o.uh_id
   WHERE o.origem = 'reserva' AND o.filial_id = p_filial AND u.ativo AND NOT u.interditada AND o.periodo @> v_data;
  SELECT count(DISTINCT o.uh_id) INTO v_bloq FROM public.hs_ocupacoes o JOIN public.hs_uhs u ON u.id = o.uh_id
   WHERE o.origem = 'bloqueio' AND o.filial_id = p_filial AND u.ativo AND NOT u.interditada AND o.periodo @> v_data;
  v_vend := v_total - v_bloq;

  SELECT coalesce(jsonb_agg(jsonb_build_object('uh_id', u.id, 'numero', u.numero, 'tipo', t.nome,
           'ocupada', EXISTS (SELECT 1 FROM public.hs_reserva_uhs x WHERE x.uh_id = u.id AND x.situacao = 'hospedada')) ORDER BY length(u.numero), u.numero), '[]'::jsonb)
    INTO v_sujas FROM public.hs_uhs u JOIN public.hs_tipos_uh t ON t.id = u.tipo_id
   WHERE u.filial_id = p_filial AND u.tenant_id = v_tenant AND u.ativo AND u.situacao_limpeza = 'sujo';

  SELECT jsonb_build_object('quantidade', count(*), 'total', coalesce(sum(x.saldo), 0)) INTO v_contas FROM (
    SELECT public._hs_folio_saldo(f.id) AS saldo FROM public.hs_folios f WHERE f.filial_id = p_filial AND f.tenant_id = v_tenant AND f.situacao = 'aberto') x WHERE x.saldo > 0;

  RETURN jsonb_build_object(
    'filial_id', p_filial, 'data', v_data, 'hoje', v_hoje,
    'chegadas', v_cheg, 'saidas', v_said, 'chegadas_atrasadas', v_cheg_at, 'saidas_atrasadas', v_said_at, 'hospedados', v_hosp,
    'ocupacao', jsonb_build_object('acomodacoes', v_total, 'bloqueadas', v_bloq, 'vendaveis', v_vend, 'ocupadas', v_ocup, 'livres', greatest(v_vend - v_ocup, 0),
                                   'percentual', CASE WHEN v_vend > 0 THEN round(100.0 * v_ocup / v_vend, 1) ELSE 0 END),
    'sujas', v_sujas, 'contas_em_aberto', v_contas,
    'totais', jsonb_build_object('chegadas', jsonb_array_length(v_cheg), 'saidas', jsonb_array_length(v_said), 'hospedados', jsonb_array_length(v_hosp),
                                 'sujas', jsonb_array_length(v_sujas)));
END $$;
REVOKE ALL ON FUNCTION public.hs_painel_dia(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_painel_dia(uuid, date) TO authenticated;

-- ============ resumo da conta ============
-- A conta do hóspede para a tela: lançamentos (com a marca de estornado), pagamentos, totais, saldo e a nota.
CREATE OR REPLACE FUNCTION public.hs_folio_resumo(p_folio uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f public.hs_folios%ROWTYPE; r public.hs_reservas%ROWTYPE; v_lanc jsonb; v_pag jsonb; v_nota jsonb; v_titular text;
  v_lancado numeric; v_recebido numeric; v_devolvido numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  PERFORM public._hs_exige_filial(f.filial_id);
  SELECT * INTO r FROM public.hs_reservas WHERE id = f.reserva_id;
  SELECT h.nome INTO v_titular FROM public.hs_hospedes h WHERE h.id = r.titular_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'data_competencia', l.data_competencia, 'tipo', l.tipo, 'descricao', l.descricao, 'quantidade', l.quantidade,
           'valor_unitario', l.valor_unitario, 'total', l.total, 'reserva_uh_id', l.reserva_uh_id, 'uh', u.numero, 'estorna_id', l.estorna_id, 'motivo', l.motivo,
           'estornado', EXISTS (SELECT 1 FROM public.hs_lancamentos e WHERE e.estorna_id = l.id), 'criado_por', l.criado_por, 'criado_em', l.created_at)
           ORDER BY l.data_competencia, l.created_at, l.id), '[]'::jsonb)
    INTO v_lanc FROM public.hs_lancamentos l LEFT JOIN public.hs_reserva_uhs ru ON ru.id = l.reserva_uh_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
   WHERE l.folio_id = p_folio;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'forma', p.forma, 'valor', p.valor, 'caixa_id', p.caixa_id, 'usuario_id', p.usuario_id,
           'criado_em', p.created_at) ORDER BY p.created_at, p.id), '[]'::jsonb)
    INTO v_pag FROM public.hs_pagamentos p WHERE p.folio_id = p_folio;
  SELECT coalesce(sum(total), 0) INTO v_lancado FROM public.hs_lancamentos WHERE folio_id = p_folio;
  SELECT coalesce(sum(valor) FILTER (WHERE tipo <> 'devolucao'), 0), coalesce(sum(valor) FILTER (WHERE tipo = 'devolucao'), 0)
    INTO v_recebido, v_devolvido FROM public.hs_pagamentos WHERE folio_id = p_folio;
  SELECT jsonb_build_object('nfe_id', n.nfe_id, 'numero', x.numero, 'situacao', x.situacao, 'modelo', x.modelo, 'valor_total', x.valor_total, 'pendencias', x.pendencias)
    INTO v_nota FROM public.hs_folio_notas n JOIN public.nfe x ON x.id = n.nfe_id WHERE n.folio_id = p_folio;

  RETURN jsonb_build_object(
    'folio', jsonb_build_object('id', f.id, 'titulo', f.titulo, 'principal', f.principal, 'situacao', f.situacao, 'fechado_em', f.fechado_em),
    'reserva', jsonb_build_object('id', r.id, 'numero', r.numero, 'situacao', r.situacao, 'titular', v_titular),
    'lancamentos', v_lanc, 'pagamentos', v_pag, 'nota', v_nota,
    'totais', jsonb_build_object('lancado', v_lancado, 'recebido', v_recebido, 'devolvido', v_devolvido, 'saldo', v_lancado - v_recebido + v_devolvido));
END $$;
REVOKE ALL ON FUNCTION public.hs_folio_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_folio_resumo(uuid) TO authenticated;

-- ============ resumo da reserva ============
-- A reserva para a tela da estadia: quartos (acomodação, datas, situação, diárias e hóspedes), contas com o saldo de cada uma e o total.
CREATE OR REPLACE FUNCTION public.hs_reserva_resumo(p_reserva uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.hs_reservas%ROWTYPE; v_tit public.hs_hospedes%ROWTYPE; v_quartos jsonb; v_folios jsonb; v_saldo numeric; v_sinal numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_reserva AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada'; END IF;
  PERFORM public._hs_exige_filial(r.filial_id);
  SELECT * INTO v_tit FROM public.hs_hospedes WHERE id = r.titular_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'reserva_uh_id', ru.id, 'situacao', ru.situacao, 'uh_id', ru.uh_id, 'uh', u.numero, 'tipo_id', t.id, 'tipo', t.nome, 'entrada', ru.entrada, 'saida', ru.saida,
           'noites', ru.saida - ru.entrada, 'adultos', ru.adultos, 'criancas', ru.criancas, 'checkin_em', ru.checkin_em, 'checkout_em', ru.checkout_em,
           'valor_acordado_total', ru.valor_acordado_total,
           'diarias', (SELECT jsonb_build_object('total', coalesce(sum(d.valor), 0), 'noites', count(*), 'lancadas', count(*) FILTER (WHERE d.lancada))
                         FROM public.hs_diarias d WHERE d.reserva_uh_id = ru.id),
           'hospedes', (SELECT coalesce(jsonb_agg(jsonb_build_object('hospede_id', h.id, 'nome', h.nome, 'principal', rh.principal, 'documento_tipo', h.documento_tipo,
                          'documento_numero', h.documento_numero) ORDER BY rh.principal DESC, h.nome), '[]'::jsonb)
                          FROM public.hs_reserva_hospedes rh JOIN public.hs_hospedes h ON h.id = rh.hospede_id WHERE rh.reserva_uh_id = ru.id))
           ORDER BY ru.entrada, u.numero, ru.id), '[]'::jsonb)
    INTO v_quartos FROM public.hs_reserva_uhs ru JOIN public.hs_tipos_uh t ON t.id = ru.tipo_id LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id WHERE ru.reserva_id = r.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'titulo', f.titulo, 'principal', f.principal, 'situacao', f.situacao, 'saldo', public._hs_folio_saldo(f.id),
           'nfe_id', n.nfe_id) ORDER BY f.principal DESC, f.created_at), '[]'::jsonb),
         coalesce(sum(public._hs_folio_saldo(f.id)), 0)
    INTO v_folios, v_saldo FROM public.hs_folios f LEFT JOIN public.hs_folio_notas n ON n.folio_id = f.id WHERE f.reserva_id = r.id;
  SELECT coalesce(sum(CASE p.tipo WHEN 'devolucao' THEN -p.valor ELSE p.valor END) FILTER (WHERE p.tipo = 'sinal' OR p.tipo = 'devolucao'), 0)
    INTO v_sinal FROM public.hs_pagamentos p JOIN public.hs_folios f ON f.id = p.folio_id WHERE f.reserva_id = r.id;

  RETURN jsonb_build_object(
    'reserva', jsonb_build_object('id', r.id, 'numero', r.numero, 'filial_id', r.filial_id, 'situacao', r.situacao, 'origem', r.origem, 'observacoes', r.observacoes,
                                  'motivo_cancelamento', r.motivo_cancelamento, 'cancelada_em', r.cancelada_em, 'pagador_cliente_id', r.pagador_cliente_id,
                                  'criada_em', r.created_at),
    'titular', jsonb_build_object('id', v_tit.id, 'nome', v_tit.nome, 'documento_tipo', v_tit.documento_tipo, 'documento_numero', v_tit.documento_numero,
                                  'telefone', v_tit.telefone, 'email', v_tit.email),
    'quartos', v_quartos, 'contas', v_folios,
    'totais', jsonb_build_object('saldo', v_saldo, 'sinal_liquido', v_sinal,
                                 'diarias', (SELECT coalesce(sum(d.valor), 0) FROM public.hs_diarias d JOIN public.hs_reserva_uhs ru ON ru.id = d.reserva_uh_id
                                              WHERE ru.reserva_id = r.id AND ru.situacao <> 'cancelada')));
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_resumo(uuid) TO authenticated;
