-- R12 — Auditoria dos dados financeiros, fiscais, da empresa e dos papéis.
--
-- Até aqui a auditoria cobria 7 tabelas (preço, desconto, frete, custo, saldo de estoque) e só alterações. Esta
-- migration registra quem, quando e o quê mudou em contas a receber e a pagar, notas fiscais (e itens), empresas,
-- filiais, configuração fiscal, comissões e papéis dos usuários, incluindo exclusões (e inclusões onde importa).
--
-- Cada trigger recebe a lista de colunas a registrar. Coluna com "!" na frente registra só que mudou (valor
-- mascarado), para segredos como o token da prefeitura. Alteração feita pelo servidor (sem usuário) entra com
-- usuário em branco. Os contadores de numeração (proximo_numero e proximo_numero_nfse) ficam fora: mudam a cada emissão.
CREATE OR REPLACE FUNCTION public.auditar_mudanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_ant jsonb := '{}'::jsonb;
  v_nov jsonb := '{}'::jsonb;
  v_arg text;
  v_col text;
  v_mascara boolean;
  v_tenant uuid;
  v_id uuid;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  v_tenant := coalesce(v_new ->> 'tenant_id', v_old ->> 'tenant_id')::uuid;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;

  -- empresa sendo apagada em cascata: não há mais a quem ligar o registro
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant) THEN
    RETURN NULL;
  END IF;

  FOREACH v_arg IN ARRAY TG_ARGV LOOP
    v_mascara := left(v_arg, 1) = '!';
    v_col := ltrim(v_arg, '!');
    IF TG_OP = 'UPDATE' THEN
      IF v_old -> v_col IS DISTINCT FROM v_new -> v_col THEN
        v_ant := v_ant || jsonb_build_object(v_col, CASE WHEN v_mascara THEN to_jsonb('***'::text) ELSE v_old -> v_col END);
        v_nov := v_nov || jsonb_build_object(v_col, CASE WHEN v_mascara THEN to_jsonb('***'::text) ELSE v_new -> v_col END);
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      v_nov := v_nov || jsonb_build_object(v_col, CASE WHEN v_mascara THEN to_jsonb('***'::text) ELSE v_new -> v_col END);
    ELSE
      v_ant := v_ant || jsonb_build_object(v_col, CASE WHEN v_mascara THEN to_jsonb('***'::text) ELSE v_old -> v_col END);
    END IF;
  END LOOP;

  IF TG_OP = 'UPDATE' AND v_nov = '{}'::jsonb THEN RETURN NULL; END IF;

  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (v_tenant, auth.uid(), TG_TABLE_NAME, v_id, lower(TG_OP),
          nullif(v_ant, '{}'::jsonb), nullif(v_nov, '{}'::jsonb));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.auditar_mudanca() FROM PUBLIC, anon, authenticated;

-- Financeiro: alteração e exclusão
DROP TRIGGER IF EXISTS trg_auditar_contas_receber ON public.contas_receber;
CREATE TRIGGER trg_auditar_contas_receber AFTER UPDATE OR DELETE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('valor', 'vencimento', 'valor_recebido', 'situacao',
    'forma_pagamento', 'motivo_cancelamento', 'cliente_id', 'pedido_id');

DROP TRIGGER IF EXISTS trg_auditar_contas_pagar ON public.contas_pagar;
CREATE TRIGGER trg_auditar_contas_pagar AFTER UPDATE OR DELETE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('valor', 'vencimento', 'valor_pago', 'situacao',
    'forma_pagamento', 'motivo_cancelamento', 'fornecedor_id', 'compra_id');

DROP TRIGGER IF EXISTS trg_auditar_comissoes ON public.comissoes;
CREATE TRIGGER trg_auditar_comissoes AFTER UPDATE OR DELETE ON public.comissoes
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('percentual', 'valor', 'situacao', 'pago_em',
    'forma_pagamento', 'vendedor_id', 'pedido_id');

-- Fiscal: alteração e exclusão
DROP TRIGGER IF EXISTS trg_auditar_nfe ON public.nfe;
CREATE TRIGGER trg_auditar_nfe AFTER UPDATE OR DELETE ON public.nfe
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('numero', 'serie', 'chave', 'protocolo', 'situacao', 'ambiente',
    'cfop', 'natureza_operacao', 'valor_produtos', 'valor_desconto', 'valor_frete', 'valor_total', 'valor_icms',
    'valor_icms_st', 'valor_pis', 'valor_cofins', 'valor_iss', 'cancelada_em', 'motivo_cancelamento', 'cliente_id',
    'pedido_id');

DROP TRIGGER IF EXISTS trg_auditar_nfe_itens ON public.nfe_itens;
CREATE TRIGGER trg_auditar_nfe_itens AFTER UPDATE OR DELETE ON public.nfe_itens
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('produto_id', 'ncm', 'cfop', 'cst_csosn', 'quantidade',
    'preco_unitario', 'desconto', 'total', 'aliquota_icms', 'valor_icms', 'aliquota_pis', 'aliquota_cofins',
    'aliquota_iss');

-- Empresa, filiais, configuração fiscal e papéis: inclusão, alteração e exclusão
DROP TRIGGER IF EXISTS trg_auditar_empresas ON public.empresas;
CREATE TRIGGER trg_auditar_empresas AFTER INSERT OR UPDATE OR DELETE ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual',
    'inscricao_municipal', 'regime_tributario', 'cnae', 'codigo_municipio', 'ativo', 'pdv_desconto_limite');

DROP TRIGGER IF EXISTS trg_auditar_filiais ON public.filiais;
CREATE TRIGGER trg_auditar_filiais AFTER INSERT OR UPDATE OR DELETE ON public.filiais
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('nome', 'codigo', 'cnpj', 'inscricao_estadual', 'situacao',
    'ativo', 'empresa_id');

DROP TRIGGER IF EXISTS trg_auditar_fiscal_config ON public.fiscal_config;
CREATE TRIGGER trg_auditar_fiscal_config AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_config
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('empresa_id', 'filial_id', 'regime_tributario', 'serie',
    'ambiente', 'emissor', 'conta_emissor', 'certificado_nome', 'certificado_validade', 'cfop_padrao',
    'aliquota_icms_interna', 'aliquota_icms_interestadual', 'mva_st', 'aliquota_pis', 'aliquota_cofins',
    'aliquota_iss', 'cst_pis', 'cst_cofins', 'reducao_base_icms', 'serie_nfse', 'nfse_prefeitura', 'nfse_padrao',
    'nfse_url', 'nfse_codigo_tributacao', 'nfse_regime_especial', 'nfse_incentivador_cultural',
    'nfse_optante_simples', 'nfse_iss_retido', 'nfse_observacoes', 'nfse_codigo_municipio', 'codigo_servico',
    'item_lista_servico', 'certificado_tipo', 'certificado_titular', 'certificado_observacoes',
    'responsavel_tecnico_cnpj', 'responsavel_tecnico_contato', 'responsavel_tecnico_email',
    'responsavel_tecnico_fone', 'informacoes_complementares', '!nfse_usuario', '!nfse_token');

DROP TRIGGER IF EXISTS trg_auditar_user_roles ON public.user_roles;
CREATE TRIGGER trg_auditar_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('user_id', 'role');
