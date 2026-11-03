-- Hotelaria (Fase 1, migration 4): check-out (lança as noites que faltam, exige a conta zerada, libera o calendário, deixa a acomodação suja),
-- NFS-e de hospedagem em rascunho por conta e liberação da limpeza pela recepção. Especificação: docs/hotelaria-fase-1.md.
-- Pode ser rodado de novo sem erro. Rode antes 20261219000000_hotelaria_estadia.sql.

-- ============ nota da conta ============
-- Uma NFS-e por conta (folio). A nota é rascunho (ou pronta, se a configuração fiscal está completa), como no Lava-Rápido e no Pet shop.
CREATE TABLE IF NOT EXISTS public.hs_folio_notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  folio_id uuid NOT NULL,
  reserva_id uuid NOT NULL,
  nfe_id uuid NOT NULL REFERENCES public.nfe(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_folio_notas_folio_fk FOREIGN KEY (folio_id, filial_id) REFERENCES public.hs_folios (id, filial_id),
  CONSTRAINT hs_folio_notas_reserva_fk FOREIGN KEY (reserva_id, filial_id) REFERENCES public.hs_reservas (id, filial_id),
  CONSTRAINT hs_folio_notas_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id),
  CONSTRAINT hs_folio_notas_folio_uk UNIQUE (folio_id),
  CONSTRAINT hs_folio_notas_nfe_uk UNIQUE (nfe_id)
);
CREATE INDEX IF NOT EXISTS hs_folio_notas_reserva_idx ON public.hs_folio_notas (reserva_id);

ALTER TABLE public.hs_folio_notas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hs_folio_notas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hs_folio_notas TO authenticated;
GRANT ALL ON public.hs_folio_notas TO service_role;
DROP POLICY IF EXISTS hs_folio_notas_ler ON public.hs_folio_notas;
CREATE POLICY hs_folio_notas_ler ON public.hs_folio_notas FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS salao_restrito ON public.hs_folio_notas;
CREATE POLICY salao_restrito ON public.hs_folio_notas AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
DROP POLICY IF EXISTS filial_restrita ON public.hs_folio_notas;
CREATE POLICY filial_restrita ON public.hs_folio_notas AS RESTRICTIVE FOR ALL TO authenticated USING (public.pode_filial(filial_id));
DROP TRIGGER IF EXISTS trg_hs_folio_notas_updated ON public.hs_folio_notas;
CREATE TRIGGER trg_hs_folio_notas_updated BEFORE UPDATE ON public.hs_folio_notas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- NFS-e da conta: itens = hospedagem por quarto (diárias líquidas de estorno) + serviços; ajuste de desconto da gestão é rateado entre os itens
-- (o último absorve o centavo) e o ISS sai sobre o líquido. Ficam FORA da nota a taxa de turismo (repasse ao município) e o consumo de mercadoria
-- (frigobar, loja: nota de produto). Sem nada a faturar, não cria nota (devolve nulo). Repetir devolve a mesma nota.
CREATE OR REPLACE FUNCTION public._hs_nfse_rascunho(p_folio uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_tenant uuid;
  f public.hs_folios%ROWTYPE; r public.hs_reservas%ROWTYPE; v_fil public.filiais%ROWTYPE; v_emp public.empresas%ROWTYPE;
  v_hosp public.hs_hospedes%ROWTYPE; v_cli public.clientes%ROWTYPE; v_cli_id uuid;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_itens jsonb := '[]'::jsonb; it jsonb; rec record;
  v_bruto numeric := 0; v_ajuste numeric; v_desconto numeric := 0; v_liquido numeric; v_acum numeric := 0; v_net numeric; v_n integer; v_i integer := 0;
  v_dest jsonb; v_existente uuid;
BEGIN
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio;
  v_tenant := f.tenant_id;
  SELECT nfe_id INTO v_existente FROM public.hs_folio_notas WHERE folio_id = p_folio;
  IF FOUND THEN RETURN v_existente; END IF;
  SELECT * INTO r FROM public.hs_reservas WHERE id = f.reserva_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = f.filial_id;
  SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant AND id = v_fil.empresa_id;
  IF v_emp.id IS NULL THEN SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1; END IF;
  IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  -- itens da nota
  FOR rec IN
    SELECT u.numero, min(l.data_competencia) AS de, max(l.data_competencia) AS ate, sum(l.total) AS total,
           count(*) FILTER (WHERE l.estorna_id IS NULL) - count(*) FILTER (WHERE l.estorna_id IS NOT NULL) AS noites
      FROM public.hs_lancamentos l
      JOIN public.hs_reserva_uhs ru ON ru.id = l.reserva_uh_id
      LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id
     WHERE l.folio_id = p_folio AND l.tipo = 'diaria'
     GROUP BY ru.id, u.numero
    HAVING sum(l.total) > 0
     ORDER BY min(l.data_competencia), u.numero
  LOOP
    v_itens := v_itens || jsonb_build_object('descricao', 'Hospedagem — UH ' || coalesce(rec.numero, '-') || ' — ' || rec.noites || ' diária(s) de '
                                                          || to_char(rec.de, 'DD/MM/YYYY') || ' a ' || to_char(rec.ate, 'DD/MM/YYYY'), 'valor', rec.total);
  END LOOP;
  FOR rec IN
    SELECT l.descricao, l.total + coalesce(e.total, 0) AS net
      FROM public.hs_lancamentos l LEFT JOIN public.hs_lancamentos e ON e.estorna_id = l.id
     WHERE l.folio_id = p_folio AND l.tipo = 'servico' AND l.estorna_id IS NULL AND l.total + coalesce(e.total, 0) > 0
     ORDER BY l.data_competencia, l.created_at, l.id
  LOOP
    v_itens := v_itens || jsonb_build_object('descricao', rec.descricao, 'valor', rec.net);
  END LOOP;
  SELECT coalesce(sum(total), 0) INTO v_ajuste FROM public.hs_lancamentos WHERE folio_id = p_folio AND tipo = 'ajuste';
  IF v_ajuste > 0 THEN v_itens := v_itens || jsonb_build_object('descricao', 'Ajuste', 'valor', v_ajuste);
  ELSIF v_ajuste < 0 THEN v_desconto := -v_ajuste; END IF;
  SELECT coalesce(sum((i ->> 'valor')::numeric), 0) INTO v_bruto FROM jsonb_array_elements(v_itens) i;
  IF v_bruto <= 0 THEN RETURN NULL; END IF;
  v_liquido := greatest(v_bruto - v_desconto, 0);

  -- pagador: o cliente da reserva, senão o cliente ligado ao titular, senão os dados do titular
  SELECT * INTO v_hosp FROM public.hs_hospedes WHERE id = r.titular_id;
  v_cli_id := coalesce(r.pagador_cliente_id, v_hosp.cliente_id);
  IF v_cli_id IS NOT NULL THEN SELECT * INTO v_cli FROM public.clientes WHERE id = v_cli_id; END IF;
  IF v_cli.id IS NOT NULL THEN
    v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
    v_dest := jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf, 'endereco', v_cli.endereco,
               'numero', v_cli.numero, 'bairro', v_cli.bairro, 'cidade', v_cli.cidade, 'estado', v_cli.estado, 'cep', v_cli.cep,
               'telefone', v_cli.telefone, 'email', v_cli.email);
  ELSE
    v_doc := CASE WHEN v_hosp.documento_tipo = 'cpf' THEN v_hosp.documento_numero END;
    v_dest := jsonb_build_object('nome', v_hosp.nome, 'cpf', CASE WHEN v_hosp.documento_tipo = 'cpf' THEN v_hosp.documento_numero END,
               'cidade', v_hosp.cidade_residencia, 'estado', v_hosp.estado_residencia, 'telefone', v_hosp.telefone, 'email', v_hosp.email);
  END IF;

  -- configuração fiscal do hotel, senão da empresa (igual ao Lava-Rápido)
  SELECT * INTO v_fil_cfg FROM public.fiscal_config WHERE tenant_id = v_tenant AND filial_id = f.filial_id LIMIT 1;
  SELECT * INTO v_emp_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND filial_id IS NULL AND (empresa_id = v_emp.id OR empresa_id IS NULL) ORDER BY empresa_id NULLS LAST LIMIT 1;
  IF v_fil_cfg IS NULL AND v_emp_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_emp_cfg;
  END IF;
  IF v_fil_cfg.id IS NOT NULL THEN v_cfg := v_fil_cfg; ELSE v_cfg := v_emp_cfg; END IF;
  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''), coalesce(v_fil.cidade, v_emp.cidade, ''));

  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\W', '', 'g')) NOT IN (11, 14) THEN v_pend := array_append(v_pend, 'CPF/CNPJ do pagador inválido ou ausente'); END IF;
  IF coalesce(v_emp.cnpj, '') = '' THEN v_pend := array_append(v_pend, 'CNPJ da empresa ausente'); END IF;
  IF coalesce(v_emp.inscricao_municipal, '') = '' THEN v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)'); END IF;
  IF v_codigo = '' THEN v_pend := array_append(v_pend, 'Código do serviço municipal não configurado'); END IF;
  IF v_iss <= 0 THEN v_pend := array_append(v_pend, 'Alíquota de ISS não configurada'); END IF;
  IF v_cert = '' THEN v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado'); END IF;
  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    UPDATE public.fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = v_cfg.id;
  END IF;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, f.filial_id, NULL, v_cli.id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    'Prestação de serviço — hospedagem', NULL,
    v_bruto, least(v_desconto, v_bruto), v_liquido, round(v_liquido * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj, 'inscricao_municipal', v_emp.inscricao_municipal,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    v_dest, v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
         ELSE 'NFS-e em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe;

  -- itens com o desconto rateado (o imposto é calculado sobre o total de cada item, que precisa ser o líquido)
  v_n := jsonb_array_length(v_itens);
  FOR it IN SELECT e FROM jsonb_array_elements(v_itens) e LOOP
    v_i := v_i + 1;
    v_net := CASE WHEN v_i = v_n THEN v_liquido - v_acum ELSE round((it ->> 'valor')::numeric * v_liquido / v_bruto, 2) END;
    v_acum := v_acum + v_net;
    INSERT INTO public.nfe_itens (tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, desconto, total, cst_csosn)
    VALUES (v_tenant, v_nfe, it ->> 'descricao', 'UN', 1, (it ->> 'valor')::numeric, (it ->> 'valor')::numeric - v_net, v_net, '400');
  END LOOP;
  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  INSERT INTO public.hs_folio_notas (tenant_id, filial_id, folio_id, reserva_id, nfe_id) VALUES (v_tenant, f.filial_id, f.id, r.id, v_nfe);
  RETURN v_nfe;
END $$;
REVOKE ALL ON FUNCTION public._hs_nfse_rascunho(uuid) FROM PUBLIC, anon, authenticated;

-- ============ check-out ============
-- O que o check-out faz:
--  - noites: lança as diárias que faltam desde o dia do check-in (noite anterior ao check-in atrasado não é cobrada) e tira as noites que sobram
--    da estadia (saída antecipada); sempre cobra ao menos uma noite e mantém as que já foram lançadas. O calendário passa a terminar na nova saída.
--  - o quarto fica finalizado e a acomodação fica suja (a recepção libera com hs_uh_situacao);
--  - em reserva de vários quartos a conta é compartilhada: os quartos que saem antes só encerram a estadia; a conta, a cobrança e a nota ficam
--    para o último quarto;
--  - no último quarto: aplica os pagamentos informados (p_pagamentos: [{forma, valor, tipo?, folio_id?}], tipo = pagamento | devolucao, conta
--    principal por padrão), exige todas as contas zeradas, fecha as contas e gera a NFS-e de cada uma (em rascunho se faltar configuração fiscal).
--    Pagamento só até o saldo; devolução só do crédito do hóspede.
-- Repetir depois de feito devolve o mesmo resultado.
CREATE OR REPLACE FUNCTION public.hs_checkout(p_reserva_uh uuid, p_pagamentos jsonb DEFAULT '[]'::jsonb, p_caixa uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  ru public.hs_reserva_uhs%ROWTYPE; r public.hs_reservas%ROWTYPE; f public.hs_folios%ROWTYPE;
  v_hoje date; v_fuso text; v_checkin_dia date; v_primeira date; v_max_lancada date; v_nova_saida date; d date;
  pag jsonb; v_folio uuid; v_forma public.forma_pagamento; v_valor numeric; v_tipo text; v_saldo numeric;
  v_outros boolean; v_notas uuid[] := '{}'; v_nfe uuid; v_noites integer; v_total_pago numeric := 0;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  SELECT * INTO r FROM public.hs_reservas WHERE id = ru.reserva_id;
  IF jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Pagamentos em formato inválido'; END IF;

  IF ru.situacao = 'finalizada' THEN
    SELECT coalesce(array_agg(n.nfe_id ORDER BY n.created_at), '{}') INTO v_notas FROM public.hs_folio_notas n WHERE n.reserva_id = r.id;
    RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', true, 'parcial', false, 'nfe_ids', to_jsonb(v_notas));
  END IF;
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Só quarto hospedado pode fazer check-out (situação atual: %)', ru.situacao; END IF;

  v_hoje := public._hs_hoje(ru.filial_id);
  v_fuso := coalesce((SELECT c.fuso FROM public.hs_config c WHERE c.filial_id = ru.filial_id), 'America/Sao_Paulo');
  v_checkin_dia := (ru.checkin_em AT TIME ZONE v_fuso)::date;
  v_primeira := greatest(ru.entrada, v_checkin_dia);
  SELECT max(x.data) INTO v_max_lancada FROM public.hs_diarias x WHERE x.reserva_uh_id = ru.id AND x.lancada;
  v_nova_saida := least(ru.saida, greatest(v_hoje, v_primeira + 1, coalesce(v_max_lancada + 1, v_hoje)));

  -- noites
  DELETE FROM public.hs_diarias WHERE reserva_uh_id = ru.id AND data >= v_nova_saida AND NOT lancada;
  FOR d IN SELECT data FROM public.hs_diarias WHERE reserva_uh_id = ru.id AND data >= v_primeira AND data < v_nova_saida AND NOT lancada ORDER BY data LOOP
    PERFORM public._hs_lancar_diaria(ru.id, d);
  END LOOP;
  SELECT count(*) INTO v_noites FROM public.hs_lancamentos WHERE reserva_uh_id = ru.id AND tipo = 'diaria' AND estorna_id IS NULL;

  -- calendário e quarto
  DELETE FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id AND lower(periodo) >= v_nova_saida;
  UPDATE public.hs_ocupacoes SET periodo = daterange(lower(periodo), v_nova_saida, '[)') WHERE reserva_uh_id = ru.id AND upper(periodo) > v_nova_saida;
  UPDATE public.hs_reserva_uhs SET situacao = 'finalizada', checkout_em = now(), saida = v_nova_saida WHERE id = ru.id;
  UPDATE public.hs_uhs SET situacao_limpeza = 'sujo' WHERE id = ru.uh_id;
  PERFORM public._hs_reserva_recalcular(r.id);

  v_outros := EXISTS (SELECT 1 FROM public.hs_reserva_uhs x WHERE x.reserva_id = r.id AND x.id <> ru.id AND x.situacao IN ('reservada', 'hospedada'));
  IF v_outros THEN
    IF jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'A conta é compartilhada: os pagamentos são feitos no check-out do último quarto da reserva';
    END IF;
    RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false, 'parcial', true, 'saida', v_nova_saida, 'noites_cobradas', v_noites, 'nfe_ids', '[]'::jsonb);
  END IF;

  -- último quarto: pagamentos, contas zeradas, notas
  FOR pag IN SELECT e FROM jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) e LOOP
    BEGIN
      v_forma := (pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((pag ->> 'valor')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Pagamento inválido: %', pag;
    END;
    v_tipo := coalesce(nullif(btrim(pag ->> 'tipo'), ''), 'pagamento');
    IF v_tipo NOT IN ('pagamento', 'devolucao') THEN RAISE EXCEPTION 'Tipo de pagamento inválido no check-out (pagamento ou devolucao)'; END IF;
    IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero em cada pagamento'; END IF;
    IF p_caixa IS NULL THEN RAISE EXCEPTION 'Informe o caixa aberto para receber ou devolver'; END IF;
    v_folio := coalesce(nullif(pag ->> 'folio_id', '')::uuid, (SELECT id FROM public.hs_folios WHERE reserva_id = r.id AND principal));
    SELECT * INTO f FROM public.hs_folios WHERE id = v_folio AND reserva_id = r.id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta do pagamento não encontrada nesta reserva'; END IF;
    IF f.situacao <> 'aberto' THEN RAISE EXCEPTION 'A conta "%" está fechada', f.titulo; END IF;
    v_saldo := public._hs_folio_saldo(f.id);
    IF v_tipo = 'pagamento' AND v_valor > v_saldo THEN RAISE EXCEPTION 'O pagamento (%) passa do saldo da conta "%" (%)', v_valor, f.titulo, greatest(v_saldo, 0); END IF;
    IF v_tipo = 'devolucao' AND v_valor > -v_saldo THEN RAISE EXCEPTION 'A devolução (%) passa do crédito do hóspede na conta "%" (%)', v_valor, f.titulo, greatest(-v_saldo, 0); END IF;
    PERFORM public._hs_registrar_pagamento(f.id, v_forma, v_valor, p_caixa, v_tipo, NULL);
    IF v_tipo = 'devolucao' THEN
      PERFORM public._hs_auditar(f.filial_id, 'hs_folios', f.id, 'devolucao', NULL, jsonb_build_object('valor', v_valor, 'forma', v_forma, 'origem', 'checkout'));
    END IF;
    v_total_pago := v_total_pago + CASE v_tipo WHEN 'devolucao' THEN -v_valor ELSE v_valor END;
  END LOOP;

  FOR f IN SELECT * FROM public.hs_folios WHERE reserva_id = r.id AND situacao = 'aberto' ORDER BY principal DESC, created_at LOOP
    v_saldo := public._hs_folio_saldo(f.id);
    IF v_saldo > 0 THEN RAISE EXCEPTION 'A conta "%" tem saldo de %: informe os pagamentos', f.titulo, v_saldo; END IF;
    IF v_saldo < 0 THEN RAISE EXCEPTION 'A conta "%" tem crédito do hóspede de %: devolva informando o pagamento do tipo devolucao', f.titulo, -v_saldo; END IF;
    v_nfe := public._hs_nfse_rascunho(f.id);
    IF v_nfe IS NOT NULL THEN v_notas := v_notas || v_nfe; END IF;
    UPDATE public.hs_folios SET situacao = 'fechado', fechado_em = now(), caixa_id = coalesce(p_caixa, caixa_id) WHERE id = f.id;
  END LOOP;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false, 'parcial', false, 'saida', v_nova_saida, 'noites_cobradas', v_noites,
                            'recebido', v_total_pago, 'nfe_ids', to_jsonb(v_notas));
END $$;
REVOKE ALL ON FUNCTION public.hs_checkout(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_checkout(uuid, jsonb, uuid) TO authenticated;

-- ============ limpeza da acomodação ============
-- A recepção libera a acomodação depois da limpeza (a governança completa, com camareiras e checklist, é da Fase 2).
-- Acomodação com hóspede não vira limpa nem inspecionada.
CREATE OR REPLACE FUNCTION public.hs_uh_situacao(p_uh uuid, p_para text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE u public.hs_uhs%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  IF p_para IS NULL OR p_para NOT IN ('limpo', 'sujo', 'inspecionado') THEN RAISE EXCEPTION 'Situação inválida (limpo, sujo ou inspecionado)'; END IF;
  SELECT * INTO u FROM public.hs_uhs WHERE id = p_uh AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acomodação não encontrada'; END IF;
  PERFORM public._hs_exige_filial(u.filial_id);
  IF p_para <> 'sujo' AND EXISTS (SELECT 1 FROM public.hs_reserva_uhs x WHERE x.uh_id = u.id AND x.situacao = 'hospedada') THEN
    RAISE EXCEPTION 'A acomodação % tem hóspede: só dá para marcá-la como suja', u.numero;
  END IF;
  UPDATE public.hs_uhs SET situacao_limpeza = p_para WHERE id = u.id;
END $$;
REVOKE ALL ON FUNCTION public.hs_uh_situacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_uh_situacao(uuid, text) TO authenticated;
