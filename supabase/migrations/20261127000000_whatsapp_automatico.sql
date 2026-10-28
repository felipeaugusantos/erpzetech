-- WhatsApp automático (servidor Evolution da Ze Tech, uma instância por empresa), ligado aos avisos do lava rápido.
-- O sistema só enfileira: quem envia é a rotina do servidor (função de servidor + cron), que fala com o Evolution.
-- Segurança: a empresa só enfileira aviso de ordem ou assinatura dela, para o telefone do cadastro do cliente (nunca um número livre),
-- cliente que não aceita mensagens ou pediu SAIR não recebe, e cada ocasião gera uma única mensagem (tipo + referência).
-- Escrita de configuração, estado da conexão e resultado do envio é só do serviço (service_role).

CREATE TABLE IF NOT EXISTS public.wa_config (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  instancia text NOT NULL,
  estado text NOT NULL DEFAULT 'desconectada' CHECK (estado IN ('desconectada', 'conectando', 'conectada')),
  numero text,
  auto_pronto boolean NOT NULL DEFAULT false,
  auto_plano boolean NOT NULL DEFAULT false,
  auto_desde timestamptz,
  conectada_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_config_instancia_idx ON public.wa_config (instancia);

CREATE TABLE IF NOT EXISTS public.wa_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pronto', 'plano_vencendo', 'retorno')),
  referencia text NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  veiculo_id uuid NOT NULL REFERENCES public.lr_veiculos(id),
  numero text NOT NULL,
  variaveis jsonb NOT NULL DEFAULT '{}'::jsonb,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'automatico')),
  situacao text NOT NULL DEFAULT 'na_fila' CHECK (situacao IN ('na_fila', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'cancelada')),
  tentativas integer NOT NULL DEFAULT 0,
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  id_externo text,
  jid text,
  erro text,
  criado_por uuid,
  enviada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_mensagens_ocasiao_idx ON public.wa_mensagens (tenant_id, tipo, referencia);
CREATE INDEX IF NOT EXISTS wa_mensagens_fila_idx ON public.wa_mensagens (proxima_tentativa) WHERE situacao = 'na_fila';
CREATE INDEX IF NOT EXISTS wa_mensagens_externo_idx ON public.wa_mensagens (tenant_id, id_externo) WHERE id_externo IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_mensagens_lista_idx ON public.wa_mensagens (tenant_id, created_at DESC);

-- Quem pediu para parar de receber (número com DDI, ou o endereço oculto do WhatsApp quando o número não aparece).
CREATE TABLE IF NOT EXISTS public.wa_saidas (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  chave text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, chave)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_config', 'wa_mensagens', 'wa_saidas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
CREATE TRIGGER trg_wa_mensagens_updated BEFORE UPDATE ON public.wa_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Número com DDI só com dígitos (10 ou 11 dígitos ganham o 55), ou NULL quando não parece telefone.
CREATE OR REPLACE FUNCTION public._wa_numero(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN length(d) IN (10, 11) THEN '55' || d
    WHEN length(d) IN (12, 13) AND d LIKE '55%' THEN d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(p_texto, ''), '\D', '', 'g') AS d) x
$fn$;
REVOKE ALL ON FUNCTION public._wa_numero(text) FROM PUBLIC, anon, authenticated;

-- Nome da instância no servidor Evolution (o mesmo de nomeDaInstancia em src/lib/whatsapp-evolution.ts).
CREATE OR REPLACE FUNCTION public.wa_nome_instancia(p_tenant uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT 'zt-' || left(replace(p_tenant::text, '-', ''), 16)
$fn$;
REVOKE ALL ON FUNCTION public.wa_nome_instancia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_nome_instancia(uuid) TO service_role;

-- Dados do aviso de uma ocasião da empresa, ou NULL quando não vale enviar
-- (referência de outra empresa, cliente que não aceita mensagens, sem telefone válido ou que pediu SAIR).
CREATE OR REPLACE FUNCTION public._wa_variaveis(p_tenant uuid, p_tipo text, p_ref uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_cliente uuid; v_veiculo uuid; v_nome text; v_tel text; v_ident text; v_tipo_v text;
  v_aceita boolean; v_extra jsonb := '{}'::jsonb; v_num text;
BEGIN
  IF p_tipo = 'plano_vencendo' THEN
    SELECT c.id, v.id, c.nome, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone), v.identificacao, v.tipo, c.aceita_mensagens,
           jsonb_build_object('plano', p.nome, 'data', a.vence_em, 'restam', public._lr_assinatura_restam(a.id))
      INTO v_cliente, v_veiculo, v_nome, v_tel, v_ident, v_tipo_v, v_aceita, v_extra
      FROM public.lr_assinaturas a
      JOIN public.lr_planos p ON p.id = a.plano_id
      JOIN public.lr_veiculos v ON v.id = a.veiculo_id
      JOIN public.clientes c ON c.id = a.cliente_id
     WHERE a.id = p_ref AND a.tenant_id = p_tenant AND a.situacao = 'ativa';
  ELSIF p_tipo IN ('pronto', 'retorno') THEN
    SELECT c.id, v.id, c.nome, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone), v.identificacao, v.tipo, c.aceita_mensagens,
           CASE WHEN p_tipo = 'pronto' THEN '{}'::jsonb
                ELSE jsonb_build_object('dias', v_hoje - (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date) END
      INTO v_cliente, v_veiculo, v_nome, v_tel, v_ident, v_tipo_v, v_aceita, v_extra
      FROM public.lr_ordens o
      JOIN public.lr_veiculos v ON v.id = o.veiculo_id
      JOIN public.clientes c ON c.id = o.cliente_id
     WHERE o.id = p_ref AND o.tenant_id = p_tenant
       AND ((p_tipo = 'pronto' AND o.situacao = 'pronto') OR (p_tipo = 'retorno' AND o.situacao = 'entregue' AND o.entregue_em IS NOT NULL));
  ELSE
    RETURN NULL;
  END IF;
  IF v_cliente IS NULL OR NOT coalesce(v_aceita, false) THEN RETURN NULL; END IF;
  v_num := public._wa_numero(v_tel);
  IF v_num IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.wa_saidas s WHERE s.tenant_id = p_tenant AND s.chave = v_num) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('cliente_id', v_cliente, 'veiculo_id', v_veiculo, 'numero', v_num, 'cliente', v_nome,
                            'veiculo', v_ident, 'tipo_veiculo', v_tipo_v) || v_extra;
END $fn$;
REVOKE ALL ON FUNCTION public._wa_variaveis(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Coloca na fila. Devolve o id, ou NULL quando a ocasião não vale (ver _wa_variaveis) ou já tem mensagem.
-- p_reabrir: mensagem que falhou ou foi cancelada volta para a fila (só no pedido manual da recepção).
CREATE OR REPLACE FUNCTION public._wa_enfileirar(p_tenant uuid, p_tipo text, p_ref uuid, p_origem text, p_usuario uuid, p_reabrir boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v jsonb;
  v_id uuid;
BEGIN
  v := public._wa_variaveis(p_tenant, p_tipo, p_ref);
  IF v IS NULL THEN RETURN NULL; END IF;
  IF p_reabrir THEN
    UPDATE public.wa_mensagens SET situacao = 'na_fila', tentativas = 0, proxima_tentativa = now(), erro = NULL,
           numero = v ->> 'numero', variaveis = v, origem = p_origem, criado_por = p_usuario
     WHERE tenant_id = p_tenant AND tipo = p_tipo AND referencia = p_ref::text AND situacao IN ('falhou', 'cancelada')
     RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.wa_mensagens (tenant_id, tipo, referencia, cliente_id, veiculo_id, numero, variaveis, origem, criado_por)
  VALUES (p_tenant, p_tipo, p_ref::text, (v ->> 'cliente_id')::uuid, (v ->> 'veiculo_id')::uuid, v ->> 'numero', v, p_origem, p_usuario)
  ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public._wa_enfileirar(uuid, text, uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Pedido da recepção: enviar este aviso pelo sistema.
CREATE OR REPLACE FUNCTION public.wa_enfileirar(p_tipo text, p_referencia text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF p_tipo NOT IN ('pronto', 'plano_vencendo', 'retorno') THEN RAISE EXCEPTION 'Tipo de aviso inválido'; END IF;
  IF p_referencia IS NULL OR p_referencia !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Referência inválida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'O WhatsApp da empresa não está conectado';
  END IF;
  v_id := public._wa_enfileirar(v_tenant, p_tipo, p_referencia::uuid, 'manual', auth.uid(), true);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível enfileirar: o aviso já foi enviado ou está na fila, ou o cliente não tem WhatsApp válido, não aceita mensagens ou pediu para sair';
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_enfileirar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_enfileirar(text, text) TO authenticated;

-- Automático: liga ou desliga "pronto" e "plano vencendo". Retorno de clientes fica sempre manual.
CREATE OR REPLACE FUNCTION public.wa_automatico_salvar(p_pronto boolean, p_plano boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'Conecte o WhatsApp da empresa antes de ligar o envio automático';
  END IF;
  UPDATE public.wa_config
     SET auto_pronto = coalesce(p_pronto, false), auto_plano = coalesce(p_plano, false),
         auto_desde = CASE WHEN (coalesce(p_pronto, false) OR coalesce(p_plano, false)) AND NOT (auto_pronto OR auto_plano) THEN now()
                           WHEN NOT (coalesce(p_pronto, false) OR coalesce(p_plano, false)) THEN NULL
                           ELSE auto_desde END,
         atualizado_em = now()
   WHERE tenant_id = v_tenant;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_automatico_salvar(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_automatico_salvar(boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_mensagem_cancelar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  UPDATE public.wa_mensagens SET situacao = 'cancelada', erro = NULL
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'na_fila';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só mensagem que ainda está na fila pode ser cancelada'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_mensagem_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_mensagem_cancelar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_mensagem_reenviar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  m public.wa_mensagens%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO m FROM public.wa_mensagens WHERE id = p_id AND tenant_id = v_tenant;
  IF m.id IS NULL OR m.situacao NOT IN ('falhou', 'cancelada') THEN
    RAISE EXCEPTION 'Só mensagem que falhou ou foi cancelada pode ser reenviada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'O WhatsApp da empresa não está conectado';
  END IF;
  IF public._wa_enfileirar(v_tenant, m.tipo, m.referencia::uuid, 'manual', auth.uid(), true) IS NULL THEN
    RAISE EXCEPTION 'O cliente não tem WhatsApp válido, não aceita mensagens ou pediu para sair';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_mensagem_reenviar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_mensagem_reenviar(uuid) TO authenticated;

-- ===== Só o serviço (rotina do servidor e aviso do Evolution) =====

-- Varre as empresas com envio automático ligado e enfileira o que vale: veículo pronto (depois de ligar) e plano a vencer em até 3 dias.
CREATE OR REPLACE FUNCTION public.wa_auto_varrer()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c record; r record;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_total integer := 0;
BEGIN
  FOR c IN SELECT * FROM public.wa_config WHERE estado = 'conectada' AND (auto_pronto OR auto_plano) LOOP
    IF c.auto_pronto THEN
      FOR r IN SELECT o.id FROM public.lr_ordens o
                WHERE o.tenant_id = c.tenant_id AND o.situacao = 'pronto' AND o.pronto_em >= coalesce(c.auto_desde, now()) AND o.pronto_em >= now() - interval '1 day'
                  AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'pronto' AND k.referencia = o.id::text)
                  AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'pronto' AND m.referencia = o.id::text)
                ORDER BY o.pronto_em LIMIT 50 LOOP
        IF public._wa_enfileirar(c.tenant_id, 'pronto', r.id, 'automatico', NULL, false) IS NOT NULL THEN v_total := v_total + 1; END IF;
      END LOOP;
    END IF;
    IF c.auto_plano THEN
      FOR r IN SELECT a.id FROM public.lr_assinaturas a
                WHERE a.tenant_id = c.tenant_id AND a.situacao = 'ativa' AND a.vence_em BETWEEN v_hoje AND v_hoje + 3
                  AND NOT EXISTS (SELECT 1 FROM public.lr_assinaturas b WHERE b.veiculo_id = a.veiculo_id AND b.situacao = 'ativa' AND b.vence_em > a.vence_em)
                  AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'plano_vencendo' AND k.referencia = a.id::text)
                  AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'plano_vencendo' AND m.referencia = a.id::text)
                ORDER BY a.vence_em LIMIT 50 LOOP
        IF public._wa_enfileirar(c.tenant_id, 'plano_vencendo', r.id, 'automatico', NULL, false) IS NOT NULL THEN v_total := v_total + 1; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_total;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_auto_varrer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_varrer() TO service_role;

-- Pega o que está na hora de enviar. Envio interrompido há mais de 5 minutos vira falha (pode ter saído: confira antes de reenviar).
-- Automático só dentro do horário (p_dentro_horario). Teto por empresa para o envio não sair em rajada.
CREATE OR REPLACE FUNCTION public.wa_reservar(p_total integer, p_por_empresa integer, p_dentro_horario boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_itens jsonb;
BEGIN
  UPDATE public.wa_mensagens SET situacao = 'falhou', erro = 'Envio interrompido: confira no WhatsApp antes de reenviar'
   WHERE situacao = 'enviando' AND updated_at < now() - interval '5 minutes';
  WITH cand AS (
    SELECT m.id, row_number() OVER (PARTITION BY m.tenant_id ORDER BY m.proxima_tentativa, m.created_at) AS pos, m.proxima_tentativa
      FROM public.wa_mensagens m
      JOIN public.wa_config c ON c.tenant_id = m.tenant_id AND c.estado = 'conectada'
     WHERE m.situacao = 'na_fila' AND m.proxima_tentativa <= now() AND (m.origem = 'manual' OR p_dentro_horario)
  ), esc AS (
    SELECT id FROM cand WHERE pos <= greatest(1, least(coalesce(p_por_empresa, 2), 10)) ORDER BY proxima_tentativa LIMIT greatest(1, least(coalesce(p_total, 20), 100))
  ), reservadas AS (
    UPDATE public.wa_mensagens m SET situacao = 'enviando', tentativas = m.tentativas + 1
     WHERE m.id IN (SELECT id FROM esc) AND m.situacao = 'na_fila'
     RETURNING m.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'tenant_id', r.tenant_id, 'instancia', c.instancia, 'numero', r.numero, 'tipo', r.tipo,
           'variaveis', r.variaveis, 'tentativas', r.tentativas,
           'modelo', (SELECT mm.texto FROM public.lr_mensagem_modelos mm WHERE mm.tenant_id = r.tenant_id AND mm.tipo = r.tipo),
           'loja', (SELECT coalesce(nullif(e.nome_fantasia, ''), e.razao_social) FROM public.empresas e WHERE e.tenant_id = r.tenant_id ORDER BY e.created_at, e.id LIMIT 1))), '[]'::jsonb)
    INTO v_itens
    FROM reservadas r JOIN public.wa_config c ON c.tenant_id = r.tenant_id;
  RETURN v_itens;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_reservar(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reservar(integer, integer, boolean) TO service_role;

-- Resultado do envio. Enviada: sai da lista de chamadas do lava rápido. Falha com p_proxima: volta para a fila nesse horário.
CREATE OR REPLACE FUNCTION public.wa_resultado(p_id uuid, p_ok boolean, p_id_externo text, p_jid text, p_erro text, p_proxima timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE m public.wa_mensagens%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.wa_mensagens WHERE id = p_id AND situacao = 'enviando' FOR UPDATE;
  IF m.id IS NULL THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE public.wa_mensagens SET situacao = 'enviada', enviada_em = now(), id_externo = p_id_externo, jid = p_jid, erro = NULL WHERE id = p_id;
    INSERT INTO public.lr_contatos (tenant_id, tipo, referencia, cliente_id, veiculo_id, canal, feito_por)
    VALUES (m.tenant_id, m.tipo, m.referencia, m.cliente_id, m.veiculo_id, 'whatsapp', m.criado_por)
    ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING;
  ELSIF p_proxima IS NOT NULL THEN
    UPDATE public.wa_mensagens SET situacao = 'na_fila', proxima_tentativa = p_proxima, erro = left(p_erro, 300) WHERE id = p_id;
  ELSE
    UPDATE public.wa_mensagens SET situacao = 'falhou', erro = left(p_erro, 300) WHERE id = p_id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) TO service_role;

-- Entrega e leitura (aviso do Evolution). Só avança: enviada, entregue, lida.
CREATE OR REPLACE FUNCTION public.wa_status(p_instancia text, p_id_externo text, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF p_status NOT IN ('entregue', 'lida') THEN RETURN; END IF;
  SELECT tenant_id INTO v_tenant FROM public.wa_config WHERE instancia = p_instancia;
  IF v_tenant IS NULL THEN RETURN; END IF;
  UPDATE public.wa_mensagens SET situacao = p_status
   WHERE tenant_id = v_tenant AND id_externo = p_id_externo
     AND (situacao = 'enviada' OR (situacao = 'entregue' AND p_status = 'lida'));
END $fn$;
REVOKE ALL ON FUNCTION public.wa_status(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_status(text, text, text) TO service_role;

-- Cliente respondeu SAIR: guarda, tira o cliente das mensagens e cancela o que está na fila para ele.
-- O cliente é achado pelo DDD e pelos 8 últimos dígitos (vale com ou sem o 9 na frente), nunca só pelos dígitos finais.
CREATE OR REPLACE FUNCTION public.wa_saida_registrar(p_instancia text, p_numero text, p_jid text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_num text := public._wa_numero(p_numero);
  v_n integer := 0;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.wa_config WHERE instancia = p_instancia;
  IF v_tenant IS NULL THEN RETURN 0; END IF;
  IF v_num IS NULL AND p_jid IS NOT NULL THEN
    SELECT m.numero INTO v_num FROM public.wa_mensagens m
     WHERE m.tenant_id = v_tenant AND m.jid = p_jid ORDER BY m.enviada_em DESC NULLS LAST LIMIT 1;
  END IF;
  IF p_jid IS NOT NULL THEN
    INSERT INTO public.wa_saidas (tenant_id, chave) VALUES (v_tenant, left(p_jid, 80)) ON CONFLICT DO NOTHING;
  END IF;
  IF v_num IS NULL THEN RETURN 0; END IF;
  INSERT INTO public.wa_saidas (tenant_id, chave) VALUES (v_tenant, v_num) ON CONFLICT DO NOTHING;
  UPDATE public.clientes SET aceita_mensagens = false
   WHERE tenant_id = v_tenant AND aceita_mensagens
     AND ((public._wa_numero(whatsapp) IS NOT NULL AND substr(public._wa_numero(whatsapp), 3, 2) = substr(v_num, 3, 2)
           AND right(public._wa_numero(whatsapp), 8) = right(v_num, 8))
          OR (public._wa_numero(telefone) IS NOT NULL AND substr(public._wa_numero(telefone), 3, 2) = substr(v_num, 3, 2)
              AND right(public._wa_numero(telefone), 8) = right(v_num, 8)));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.wa_mensagens SET situacao = 'cancelada', erro = 'Cliente pediu para sair'
   WHERE tenant_id = v_tenant AND situacao = 'na_fila' AND numero = v_num;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_saida_registrar(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_saida_registrar(text, text, text) TO service_role;
