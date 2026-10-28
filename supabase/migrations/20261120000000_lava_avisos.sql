-- Lava rápido (Fase 2, etapa 2): avisos ao cliente para a recepção chamar no WhatsApp.
-- Três avisos: "pronto" (veículo pronto para retirar), "plano_vencendo" (assinatura perto de vencer) e "retorno" (cliente que não volta há dias).
-- Sem envio automático: o clique continua sendo da recepção (envio direto exige a API oficial do WhatsApp contratada pela empresa).
-- Quem já foi chamado para aquela ocasião sai da lista; cliente que não quer mensagens (clientes.aceita_mensagens) não entra.

CREATE TABLE IF NOT EXISTS public.lr_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pronto', 'plano_vencendo', 'retorno')),
  -- ordem (pronto e retorno: a última entrega) ou assinatura (plano_vencendo): uma chamada por ocasião
  referencia text NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  veiculo_id uuid NOT NULL REFERENCES public.lr_veiculos(id),
  canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'telefone', 'outro')),
  feito_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_contatos_ocasiao_idx ON public.lr_contatos (tenant_id, tipo, referencia);

-- Modelos de mensagem por empresa. Sem linha = vale o texto padrão do sistema.
CREATE TABLE IF NOT EXISTS public.lr_mensagem_modelos (
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pronto', 'plano_vencendo', 'retorno')),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 5 AND 600),
  atualizado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tipo)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_contatos', 'lr_mensagem_modelos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
CREATE TRIGGER trg_lr_contatos_updated BEFORE UPDATE ON public.lr_contatos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Texto em branco volta ao padrão do sistema.
CREATE OR REPLACE FUNCTION public.lr_mensagem_modelo_salvar(p_tipo text, p_texto text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF p_tipo NOT IN ('pronto', 'plano_vencendo', 'retorno') THEN RAISE EXCEPTION 'Tipo de mensagem inválido'; END IF;
  IF nullif(btrim(coalesce(p_texto, '')), '') IS NULL THEN
    DELETE FROM public.lr_mensagem_modelos WHERE tenant_id = v_tenant AND tipo = p_tipo;
    RETURN;
  END IF;
  IF length(btrim(p_texto)) < 5 OR length(btrim(p_texto)) > 600 THEN RAISE EXCEPTION 'A mensagem precisa ter de 5 a 600 caracteres'; END IF;
  INSERT INTO public.lr_mensagem_modelos (tenant_id, tipo, texto) VALUES (v_tenant, p_tipo, btrim(p_texto))
  ON CONFLICT (tenant_id, tipo) DO UPDATE SET texto = EXCLUDED.texto, atualizado_por = auth.uid(), atualizado_em = now();
END $$;
REVOKE ALL ON FUNCTION public.lr_mensagem_modelo_salvar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_mensagem_modelo_salvar(text, text) TO authenticated;

-- Quem vale chamar. p_tipo / p_janela:
--   'pronto': veículos prontos para retirar, dos últimos 2 dias (a janela não conta);
--   'plano_vencendo': assinaturas ativas que vencem de hoje até p_janela dias à frente (0 a 60), sem renovação já vendida;
--   'retorno': clientes cuja última entrega do veículo foi há p_janela dias ou mais (7 a 365), até 1 ano atrás, sem ordem aberta nem plano valendo.
-- Cada linha traz "referencia", que a recepção devolve em lr_contato_registrar. Teto de 300 linhas, o mais antigo primeiro.
CREATE OR REPLACE FUNCTION public.lr_mensagens_pendentes(p_tipo text, p_janela integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF p_tipo NOT IN ('pronto', 'plano_vencendo', 'retorno') THEN RAISE EXCEPTION 'Tipo de aviso inválido'; END IF;
  IF p_tipo = 'plano_vencendo' AND (p_janela IS NULL OR p_janela < 0 OR p_janela > 60) THEN
    RAISE EXCEPTION 'A janela precisa ficar entre 0 e 60 dias';
  END IF;
  IF p_tipo = 'retorno' AND (p_janela IS NULL OR p_janela < 7 OR p_janela > 365) THEN
    RAISE EXCEPTION 'Os dias sem voltar precisam ficar entre 7 e 365';
  END IF;

  IF p_tipo = 'pronto' THEN
    RETURN coalesce((
      SELECT jsonb_agg(x.item ORDER BY x.ord) FROM (
        SELECT o.pronto_em AS ord,
               jsonb_build_object('referencia', o.id::text, 'cliente_id', c.id, 'veiculo_id', v.id, 'cliente', c.nome,
                                  'veiculo', v.identificacao, 'tipo_veiculo', v.tipo,
                                  'telefone', coalesce(nullif(btrim(c.whatsapp), ''), c.telefone),
                                  'data', (o.pronto_em AT TIME ZONE 'America/Sao_Paulo')::date) AS item
          FROM public.lr_ordens o
          JOIN public.lr_veiculos v ON v.id = o.veiculo_id
          JOIN public.clientes c ON c.id = o.cliente_id
         WHERE o.tenant_id = v_tenant AND o.situacao = 'pronto' AND o.pronto_em >= now() - interval '2 days' AND c.aceita_mensagens
           AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = v_tenant AND k.tipo = 'pronto' AND k.referencia = o.id::text)
         ORDER BY o.pronto_em LIMIT 300) x), '[]'::jsonb);
  ELSIF p_tipo = 'plano_vencendo' THEN
    RETURN coalesce((
      SELECT jsonb_agg(x.item ORDER BY x.ord) FROM (
        SELECT a.vence_em AS ord,
               jsonb_build_object('referencia', a.id::text, 'cliente_id', c.id, 'veiculo_id', v.id, 'cliente', c.nome,
                                  'veiculo', v.identificacao, 'tipo_veiculo', v.tipo,
                                  'telefone', coalesce(nullif(btrim(c.whatsapp), ''), c.telefone),
                                  'data', a.vence_em, 'plano', p.nome, 'restam', public._lr_assinatura_restam(a.id)) AS item
          FROM public.lr_assinaturas a
          JOIN public.lr_planos p ON p.id = a.plano_id
          JOIN public.lr_veiculos v ON v.id = a.veiculo_id
          JOIN public.clientes c ON c.id = a.cliente_id
         WHERE a.tenant_id = v_tenant AND a.situacao = 'ativa' AND a.vence_em BETWEEN v_hoje AND v_hoje + p_janela AND c.aceita_mensagens
           AND NOT EXISTS (SELECT 1 FROM public.lr_assinaturas b WHERE b.veiculo_id = a.veiculo_id AND b.situacao = 'ativa' AND b.vence_em > a.vence_em)
           AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = v_tenant AND k.tipo = 'plano_vencendo' AND k.referencia = a.id::text)
         ORDER BY a.vence_em LIMIT 300) x), '[]'::jsonb);
  ELSE
    RETURN coalesce((
      SELECT jsonb_agg(x.item ORDER BY x.ord) FROM (
        SELECT u.entregue_em AS ord,
               jsonb_build_object('referencia', u.id::text, 'cliente_id', c.id, 'veiculo_id', v.id, 'cliente', c.nome,
                                  'veiculo', v.identificacao, 'tipo_veiculo', v.tipo,
                                  'telefone', coalesce(nullif(btrim(c.whatsapp), ''), c.telefone),
                                  'data', (u.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date,
                                  'dias', v_hoje - (u.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date) AS item
          FROM (SELECT DISTINCT ON (o.veiculo_id) o.id, o.veiculo_id, o.cliente_id, o.entregue_em
                  FROM public.lr_ordens o
                 WHERE o.tenant_id = v_tenant AND o.situacao = 'entregue' AND o.entregue_em IS NOT NULL
                 ORDER BY o.veiculo_id, o.entregue_em DESC) u
          JOIN public.lr_veiculos v ON v.id = u.veiculo_id AND v.ativo
          JOIN public.clientes c ON c.id = u.cliente_id
         WHERE c.aceita_mensagens
           AND (u.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date <= v_hoje - p_janela
           AND (u.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date >= v_hoje - 365
           AND NOT EXISTS (SELECT 1 FROM public.lr_ordens o2 WHERE o2.veiculo_id = u.veiculo_id AND o2.situacao IN ('aguardando', 'lavando', 'secando', 'pronto'))
           AND NOT EXISTS (SELECT 1 FROM public.lr_assinaturas a WHERE a.veiculo_id = u.veiculo_id AND a.situacao = 'ativa' AND a.vence_em >= v_hoje)
           AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = v_tenant AND k.tipo = 'retorno' AND k.referencia = u.id::text)
         ORDER BY u.entregue_em LIMIT 300) x), '[]'::jsonb);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_mensagens_pendentes(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_mensagens_pendentes(text, integer) TO authenticated;

-- Marca como chamado. A referência precisa ser de uma ordem (pronto, retorno) ou assinatura (plano_vencendo) da empresa.
CREATE OR REPLACE FUNCTION public.lr_contato_registrar(p_tipo text, p_referencia text, p_canal text DEFAULT 'whatsapp')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ref uuid;
  v_cliente uuid; v_veiculo uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF p_tipo NOT IN ('pronto', 'plano_vencendo', 'retorno') THEN RAISE EXCEPTION 'Tipo de contato inválido'; END IF;
  IF p_canal NOT IN ('whatsapp', 'telefone', 'outro') THEN RAISE EXCEPTION 'Canal inválido'; END IF;
  BEGIN
    v_ref := p_referencia::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Referência inválida';
  END;
  IF p_tipo = 'plano_vencendo' THEN
    SELECT cliente_id, veiculo_id INTO v_cliente, v_veiculo FROM public.lr_assinaturas WHERE id = v_ref AND tenant_id = v_tenant;
  ELSE
    SELECT cliente_id, veiculo_id INTO v_cliente, v_veiculo FROM public.lr_ordens WHERE id = v_ref AND tenant_id = v_tenant;
  END IF;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'Referência não encontrada'; END IF;
  INSERT INTO public.lr_contatos (tenant_id, tipo, referencia, cliente_id, veiculo_id, canal)
  VALUES (v_tenant, p_tipo, v_ref::text, v_cliente, v_veiculo, p_canal)
  ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.lr_contato_registrar(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_contato_registrar(text, text, text) TO authenticated;
