CREATE TABLE IF NOT EXISTS public.nfce_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  fiscal_config_id uuid NOT NULL REFERENCES public.fiscal_config(id) ON DELETE CASCADE,
  serie integer NOT NULL DEFAULT 1 CHECK (serie BETWEEN 0 AND 999),
  proximo_numero integer NOT NULL DEFAULT 1 CHECK (proximo_numero >= 1),
  csc_id text,
  csc_token text,
  contingencia_ativa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fiscal_config_id)
);

GRANT SELECT, INSERT, UPDATE ON public.nfce_config TO authenticated;
GRANT ALL ON public.nfce_config TO service_role;
ALTER TABLE public.nfce_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY nfce_config_ler ON public.nfce_config FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
CREATE POLICY nfce_config_inserir ON public.nfce_config FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
              AND EXISTS (SELECT 1 FROM public.fiscal_config f
                           WHERE f.id = fiscal_config_id AND f.tenant_id = public.current_tenant_id()));
CREATE POLICY nfce_config_alterar ON public.nfce_config FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY salao_restrito ON public.nfce_config AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.nfce_config_protege()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.proximo_numero := 1;
    ELSIF NEW.proximo_numero IS DISTINCT FROM OLD.proximo_numero
       OR NEW.fiscal_config_id IS DISTINCT FROM OLD.fiscal_config_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'A numeração e o vínculo da NFC-e não são alterados pela tela';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nfce_config_protege_trg ON public.nfce_config;
CREATE TRIGGER nfce_config_protege_trg BEFORE INSERT OR UPDATE ON public.nfce_config
  FOR EACH ROW EXECUTE FUNCTION public.nfce_config_protege();
DROP TRIGGER IF EXISTS trg_nfce_config_touch ON public.nfce_config;
CREATE TRIGGER trg_nfce_config_touch BEFORE UPDATE ON public.nfce_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_auditar_nfce_config ON public.nfce_config;
CREATE TRIGGER trg_auditar_nfce_config AFTER INSERT OR UPDATE OR DELETE ON public.nfce_config
  FOR EACH ROW EXECUTE FUNCTION public.auditar_mudanca('fiscal_config_id', 'serie', 'csc_id', '!csc_token',
    'contingencia_ativa');

ALTER TABLE public.nfe
  ADD COLUMN IF NOT EXISTS contingencia boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proxima_tentativa_em timestamptz;

ALTER TABLE public.nfe DROP CONSTRAINT IF EXISTS nfe_modelo_valido;
ALTER TABLE public.nfe ADD CONSTRAINT nfe_modelo_valido CHECK (modelo IN ('nfe', 'nfse', 'nfce'));

CREATE UNIQUE INDEX IF NOT EXISTS nfe_nfce_numero_unico
  ON public.nfe (tenant_id, empresa_id, serie, numero)
  WHERE modelo = 'nfce' AND numero IS NOT NULL;

CREATE INDEX IF NOT EXISTS nfe_pendencias_idx
  ON public.nfe (tenant_id, situacao, updated_at DESC)
  WHERE situacao IN ('rejeitada', 'contingencia', 'transmitida');

CREATE OR REPLACE FUNCTION public.nfe_protege_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.situacao IS DISTINCT FROM OLD.situacao
    OR NEW.chave IS DISTINCT FROM OLD.chave
    OR NEW.protocolo IS DISTINCT FROM OLD.protocolo
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.provider_status IS DISTINCT FROM OLD.provider_status
    OR NEW.retorno IS DISTINCT FROM OLD.retorno
    OR NEW.mensagem IS DISTINCT FROM OLD.mensagem
    OR NEW.transmitida_em IS DISTINCT FROM OLD.transmitida_em
    OR NEW.autorizada_em IS DISTINCT FROM OLD.autorizada_em
    OR NEW.cancelada_em IS DISTINCT FROM OLD.cancelada_em
    OR NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento
    OR NEW.modelo IS DISTINCT FROM OLD.modelo
    OR NEW.contingencia IS DISTINCT FROM OLD.contingencia
    OR NEW.tentativas IS DISTINCT FROM OLD.tentativas
    OR NEW.proxima_tentativa_em IS DISTINCT FROM OLD.proxima_tentativa_em) THEN
    RAISE EXCEPTION 'O andamento da nota fiscal só muda pela transmissão ou pelo cancelamento na Sefaz';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nfce_criar(p_pedido_id uuid, p_cpf text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ped record;
  v_emp record;
  v_fil record;
  v_cfg record;
  v_nc record;
  v_item record;
  v_existente uuid;
  v_sit_existente text;
  v_nfe uuid;
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_pend text[] := '{}';
  v_numero integer;
  v_prod numeric := 0;
  v_desc numeric;
  v_frete numeric;
  v_total numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro', 'vendedor', 'caixa']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado não emite nota'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('nfce:' || p_pedido_id::text, 0));
  SELECT n.id, n.situacao INTO v_existente, v_sit_existente
    FROM public.nfe_pedidos np JOIN public.nfe n ON n.id = np.nfe_id
   WHERE np.pedido_id = p_pedido_id AND n.modelo = 'nfce' AND n.situacao <> 'cancelada'
   LIMIT 1;
  IF v_existente IS NOT NULL THEN
    IF v_sit_existente <> 'rascunho' THEN RETURN v_existente; END IF;
    DELETE FROM public.nfe WHERE id = v_existente;
  END IF;
  IF EXISTS (SELECT 1 FROM public.nfe_pedidos np JOIN public.nfe n ON n.id = np.nfe_id
              WHERE np.pedido_id = p_pedido_id AND n.modelo = 'nfe' AND n.situacao <> 'cancelada') THEN
    RAISE EXCEPTION 'O pedido já tem NF-e; uma venda não leva as duas notas';
  END IF;

  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas
   WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
  IF v_emp IS NULL THEN
    SELECT e.* INTO v_emp FROM public.empresas e JOIN public.profiles p ON p.empresa_id = e.id
     WHERE p.id = auth.uid() AND e.tenant_id = v_tenant;
  END IF;
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant
     AND (empresa_id = v_emp.id OR empresa_id IS NULL)
     AND (filial_id = v_ped.filial_id OR filial_id IS NULL)
   ORDER BY (filial_id IS NOT NULL) DESC, empresa_id NULLS LAST
   LIMIT 1;
  IF v_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_cfg;
  END IF;

  INSERT INTO public.nfce_config (tenant_id, fiscal_config_id) VALUES (v_tenant, v_cfg.id)
  ON CONFLICT (fiscal_config_id) DO NOTHING;
  SELECT * INTO v_nc FROM public.nfce_config WHERE fiscal_config_id = v_cfg.id FOR UPDATE;

  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    v_pend := array_append(v_pend, 'CPF do consumidor inválido');
  END IF;
  IF coalesce(v_emp.cnpj, '') = '' OR coalesce(v_emp.inscricao_estadual, '') = '' THEN
    v_pend := array_append(v_pend, 'CNPJ ou inscrição estadual da empresa ausente');
  END IF;
  IF coalesce(v_emp.estado, '') = '' THEN
    v_pend := array_append(v_pend, 'UF da empresa ausente');
  END IF;
  IF coalesce(v_cfg.certificado_nome, '') = '' THEN
    v_pend := array_append(v_pend, 'Certificado digital A1 não configurado');
  END IF;
  IF coalesce(v_cfg.emissor, '') = '' THEN
    v_pend := array_append(v_pend, 'Emissor fiscal (API) não configurado');
  END IF;
  IF coalesce(v_nc.csc_id, '') = '' OR coalesce(v_nc.csc_token, '') = '' THEN
    v_pend := array_append(v_pend, 'CSC da NFC-e (código e token) não configurado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pedido_itens WHERE pedido_id = p_pedido_id) THEN
    v_pend := array_append(v_pend, 'O pedido não tem itens');
  END IF;

  FOR v_item IN SELECT i.total, p.ncm, p.codigo_interno, p.cfop, p.cst_csosn
                  FROM public.pedido_itens i JOIN public.produtos p ON p.id = i.produto_id
                 WHERE i.pedido_id = p_pedido_id LOOP
    IF coalesce(v_item.ncm, '') = '' THEN
      v_pend := array_append(v_pend, 'NCM ausente no produto ' || v_item.codigo_interno);
    END IF;
    IF coalesce(v_item.cfop, v_cfg.cfop_padrao, '') = '' THEN
      v_pend := array_append(v_pend, 'CFOP ausente no produto ' || v_item.codigo_interno);
    END IF;
    IF coalesce(v_item.cst_csosn, '') = '' THEN
      v_pend := array_append(v_pend, 'CST/CSOSN ausente no produto ' || v_item.codigo_interno);
    END IF;
    v_prod := v_prod + v_item.total;
  END LOOP;

  v_desc := coalesce(v_ped.desconto, 0);
  v_frete := coalesce(v_ped.frete, 0);
  v_total := coalesce(v_ped.total, 0);
  IF v_total <= 0 THEN
    v_pend := array_append(v_pend, 'Valor total da venda deve ser maior que zero');
  END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := v_nc.proximo_numero;
    UPDATE public.nfce_config SET proximo_numero = proximo_numero + 1 WHERE id = v_nc.id;
  END IF;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, deposito_id, modelo,
    numero, serie, situacao, ambiente, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_frete, valor_total,
    emitente, destinatario, pendencias, mensagem, contingencia
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, v_ped.cliente_id, v_ped.deposito_id, 'nfce',
    v_numero, v_nc.serie,
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'Venda de mercadoria ao consumidor', v_cfg.cfop_padrao,
    v_prod, v_desc, v_frete, v_total,
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco,
      'numero', v_emp.numero, 'bairro', v_emp.bairro, 'cidade', v_emp.cidade,
      'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    CASE WHEN v_cpf IS NULL THEN jsonb_build_object('consumidor', 'não identificado')
         ELSE jsonb_build_object('consumidor', 'identificado', 'cpf', v_cpf) END,
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'NFC-e pronta para transmissão. Falta apenas a transmissão pelo emissor fiscal.'
      ELSE 'NFC-e em rascunho: resolva as pendências listadas.' END,
    v_nc.contingencia_ativa
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_pedidos (tenant_id, nfe_id, pedido_id) VALUES (v_tenant, v_nfe, p_pedido_id);

  INSERT INTO public.nfe_itens (
    tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn,
    unidade, quantidade, preco_unitario, custo_unitario, desconto, total, aliquota_icms
  )
  SELECT v_tenant, v_nfe, p.id, p.codigo_interno, p.descricao, p.ncm,
         coalesce(p.cfop, v_cfg.cfop_padrao), p.cst_csosn,
         coalesce(i.unidade, p.unidade), i.quantidade, i.preco_unitario, i.custo_unitario,
         i.desconto, i.total, p.aliquota_icms
    FROM public.pedido_itens i JOIN public.produtos p ON p.id = i.produto_id
   WHERE i.pedido_id = p_pedido_id;

  PERFORM public.nfe_calcular_impostos(v_nfe);

  RETURN v_nfe;
END $$;

REVOKE ALL ON FUNCTION public.nfce_criar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfce_criar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.eventos_pendentes()
RETURNS TABLE (id uuid, provedor text, event_id text, status text, tentativas integer, erro text, recebido_em timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  RETURN QUERY
    SELECT w.id, w.provedor, w.event_id, w.status, w.tentativas, w.erro, w.recebido_em
      FROM public.webhook_eventos w
     WHERE w.tenant_id = public.current_tenant_id()
       AND (w.status IN ('erro', 'ignorado')
            OR (w.status = 'recebido' AND w.recebido_em < now() - interval '5 minutes'))
     ORDER BY w.recebido_em DESC
     LIMIT 200;
END $$;

REVOKE ALL ON FUNCTION public.eventos_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eventos_pendentes() TO authenticated;