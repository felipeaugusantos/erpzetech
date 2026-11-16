-- Tela "Plano e assinatura" da empresa: lê a assinatura REAL (saas_clientes, saas_planos e saas_faturas, a mesma base da cobrança da
-- equipe e do gateway) em vez das tabelas antigas assinaturas/assinatura_faturas, que a própria empresa conseguia gravar e que não
-- alimentam a cobrança. Só leitura, só administrador e gestor, só da própria empresa. As tabelas antigas ficam como estão (sem uso).
CREATE OR REPLACE FUNCTION public.assinatura_resumo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c record; p record; t record; v_ramo text; v_faturas jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  SELECT * INTO c FROM public.saas_clientes WHERE tenant_id = public.current_tenant_id() ORDER BY inicio DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.saas_planos WHERE id = c.plano_id;
  SELECT e.ramo_atividade INTO v_ramo FROM public.empresas e WHERE e.tenant_id = c.tenant_id ORDER BY e.created_at LIMIT 1;
  SELECT * INTO t FROM public.taxa_inicial_segmento(v_ramo);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'tipo', f.tipo, 'descricao', f.descricao, 'competencia', f.competencia, 'valor', f.valor,
           'valor_pago', f.valor_pago, 'vencimento', f.vencimento, 'pago_em', f.pago_em, 'forma_pagamento', f.forma_pagamento,
           'url', f.gateway_url, 'boleto_url', f.boleto_url, 'pix_copia_cola', f.pix_copia_cola,
           'boleto_linha_digitavel', f.boleto_linha_digitavel) ORDER BY f.vencimento DESC), '[]'::jsonb)
    INTO v_faturas
    FROM (SELECT * FROM public.saas_faturas WHERE cliente_id = c.id ORDER BY vencimento DESC LIMIT 200) f;
  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('nome', c.nome, 'situacao', c.situacao, 'inicio', c.inicio, 'prazo_meses', c.prazo_meses,
               'dia_vencimento', c.dia_vencimento, 'filiais_extras', c.filiais_extras, 'teste_ate', c.teste_ate,
               'implantacao_paga', c.implantacao_paga, 'cobranca_automatica', c.cobranca_automatica),
    'plano', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('codigo', p.codigo, 'nome', p.nome, 'resumo', p.resumo,
               'valor_mensal', p.valor_mensal, 'valor_filial_extra', p.valor_filial_extra, 'valor_implantacao', p.valor_implantacao,
               'recursos', to_jsonb(p.recursos)) END,
    'taxa_inicial', jsonb_build_object('valor', coalesce(t.valor, p.valor_implantacao, 0), 'rotulo', coalesce(t.rotulo, 'Implantação')),
    'faturas', v_faturas);
END
$fn$;
REVOKE ALL ON FUNCTION public.assinatura_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_resumo() TO authenticated;
