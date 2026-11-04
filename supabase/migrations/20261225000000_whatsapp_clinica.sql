-- WhatsApp automático da clínica: lembrete de vacina/vermífugo (reforco_vacina) e de retorno de consulta
-- (retorno_consulta) na mesma fila e conexão Evolution que o lava rápido já usa (wa_config/wa_mensagens/wa_saidas).
-- O sistema só enfileira: quem envia é a rotina do servidor (cron a cada minuto), dentro do horário comercial,
-- com pausa entre mensagens. Mesmas garantias: tutor que não aceita mensagens ou pediu SAIR não recebe, o número
-- vem sempre do cadastro do tutor (nunca livre), cada ocasião gera uma única mensagem e o texto sai do modelo da
-- empresa (pet_mensagem_modelos, tipos "reforco" e o novo "retorno_clinica") ou do padrão do sistema.
-- O aviso de reforço enviado também registra o contato (pet_contatos): o pet some da lista manual da recepção.

-- ============ tabelas ============
ALTER TABLE public.wa_config ADD COLUMN IF NOT EXISTS auto_reforco boolean NOT NULL DEFAULT false;
ALTER TABLE public.wa_config ADD COLUMN IF NOT EXISTS auto_retorno boolean NOT NULL DEFAULT false;

ALTER TABLE public.wa_mensagens DROP CONSTRAINT IF EXISTS wa_mensagens_tipo_check;
ALTER TABLE public.wa_mensagens ADD CONSTRAINT wa_mensagens_tipo_check
  CHECK (tipo IN ('pronto', 'plano_vencendo', 'retorno', 'reforco_vacina', 'retorno_consulta'));
ALTER TABLE public.wa_mensagens ALTER COLUMN veiculo_id DROP NOT NULL;
ALTER TABLE public.wa_mensagens ADD COLUMN IF NOT EXISTS pet_id uuid REFERENCES public.pets(id);
ALTER TABLE public.wa_mensagens DROP CONSTRAINT IF EXISTS wa_mensagens_destino_check;
ALTER TABLE public.wa_mensagens ADD CONSTRAINT wa_mensagens_destino_check
  CHECK (veiculo_id IS NOT NULL OR pet_id IS NOT NULL);

-- Modelo de mensagem novo: retorno de consulta da clínica (o "retorno" antigo é de banho do pet shop).
ALTER TABLE public.pet_mensagem_modelos DROP CONSTRAINT IF EXISTS pet_mensagem_modelos_tipo_check;
ALTER TABLE public.pet_mensagem_modelos ADD CONSTRAINT pet_mensagem_modelos_tipo_check
  CHECK (tipo IN ('aniversario', 'retorno', 'reforco', 'confirmacao', 'pronto', 'exame', 'retorno_clinica'));

CREATE OR REPLACE FUNCTION public.pet_mensagem_modelo_salvar(p_tipo text, p_texto text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_tipo NOT IN ('aniversario', 'retorno', 'reforco', 'confirmacao', 'pronto', 'exame', 'retorno_clinica') THEN RAISE EXCEPTION 'Tipo de mensagem inválido'; END IF;
  IF nullif(btrim(coalesce(p_texto, '')), '') IS NULL THEN
    DELETE FROM public.pet_mensagem_modelos WHERE tenant_id = v_tenant AND tipo = p_tipo;
    RETURN;
  END IF;
  IF length(btrim(p_texto)) < 5 OR length(btrim(p_texto)) > 600 THEN RAISE EXCEPTION 'A mensagem precisa ter de 5 a 600 caracteres'; END IF;
  INSERT INTO public.pet_mensagem_modelos (tenant_id, tipo, texto) VALUES (v_tenant, p_tipo, btrim(p_texto))
  ON CONFLICT (tenant_id, tipo) DO UPDATE SET texto = EXCLUDED.texto, atualizado_por = auth.uid(), atualizado_em = now();
END $$;
REVOKE ALL ON FUNCTION public.pet_mensagem_modelo_salvar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_mensagem_modelo_salvar(text, text) TO authenticated;

-- A clínica está liberada para este tenant? Mesma regra de clinica_liberada(), mas para a rotina do servidor,
-- que roda sem empresa na sessão e precisa informar o tenant.
CREATE OR REPLACE FUNCTION public._wa_clinica_liberada(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = p_tenant AND (
 EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'clinica')
 OR e.ramo_atividade = 'clinica'
 OR (length(regexp_replace(coalesce(e.cnpj,''), '[^0-9A-Za-z]','','g')) < 14 AND 'clinica' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '7500%')))
$fn$;
REVOKE ALL ON FUNCTION public._wa_clinica_liberada(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_clinica_liberada(uuid) TO service_role;

-- ============ dados da ocasião ============
-- p_ref: lava rápido = uuid da ordem ou da assinatura; reforco_vacina = '<uuid do pet>:<AAAA-MM-DD da próxima dose>';
-- retorno_consulta = uuid do atendimento. Devolve NULL quando não vale enviar (não encontrado, fora da empresa,
-- tutor que não aceita mensagens, sem telefone válido, pediu SAIR ou a ocasião já não existe).
DROP FUNCTION IF EXISTS public._wa_variaveis(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public._wa_variaveis(p_tenant uuid, p_tipo text, p_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_cliente uuid; v_veiculo uuid; v_pet uuid; v_nome text; v_tel text; v_ident text; v_tipo_v text;
  v_pet_nome text; v_itens text; v_data date;
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
     WHERE a.id = p_ref::uuid AND a.tenant_id = p_tenant AND a.situacao = 'ativa';
  ELSIF p_tipo IN ('pronto', 'retorno') THEN
    SELECT c.id, v.id, c.nome, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone), v.identificacao, v.tipo, c.aceita_mensagens,
           CASE WHEN p_tipo = 'pronto' THEN jsonb_build_object('data', (o.pronto_em AT TIME ZONE 'America/Sao_Paulo')::date)
                ELSE jsonb_build_object('data', (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date,
                                        'dias', v_hoje - (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date) END
      INTO v_cliente, v_veiculo, v_nome, v_tel, v_ident, v_tipo_v, v_aceita, v_extra
      FROM public.lr_ordens o
      JOIN public.lr_veiculos v ON v.id = o.veiculo_id
      JOIN public.clientes c ON c.id = o.cliente_id
     WHERE o.id = p_ref::uuid AND o.tenant_id = p_tenant
       AND ((p_tipo = 'pronto' AND o.situacao = 'pronto') OR (p_tipo = 'retorno' AND o.situacao = 'entregue' AND o.entregue_em IS NOT NULL));
  ELSIF p_tipo = 'reforco_vacina' THEN
    BEGIN
      v_pet := left(p_ref, 36)::uuid;
      v_data := right(p_ref, 10)::date;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
    IF p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
    SELECT c.id, c.nome, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone), c.aceita_mensagens, p.id, p.nome
      INTO v_cliente, v_nome, v_tel, v_aceita, v_pet, v_pet_nome
      FROM public.pets p JOIN public.clientes c ON c.id = p.cliente_id
     WHERE p.id = v_pet AND p.tenant_id = p_tenant AND p.ativo;
    IF v_cliente IS NULL THEN RETURN NULL; END IF;
    -- os itens que vencem nessa data (a aplicação mais recente de cada produto do catálogo)
    SELECT string_agg(x.nome, ' e ' ORDER BY x.nome) INTO v_itens
      FROM (
        SELECT DISTINCT ON (v.catalogo_id) v.nome, v.proxima_dose_em
          FROM public.pet_vacinacoes v
         WHERE v.tenant_id = p_tenant AND v.pet_id = v_pet AND v.situacao = 'ativa'
         ORDER BY v.catalogo_id, v.aplicada_em DESC, v.created_at DESC
      ) x
     WHERE x.proxima_dose_em = v_data;
    IF v_itens IS NULL THEN RETURN NULL; END IF;
    v_extra := jsonb_build_object('pet', v_pet_nome, 'itens', v_itens, 'data', v_data);
  ELSIF p_tipo = 'retorno_consulta' THEN
    SELECT c.id, c.nome, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone), c.aceita_mensagens, p.id, p.nome, a.retorno_em
      INTO v_cliente, v_nome, v_tel, v_aceita, v_pet, v_pet_nome, v_data
      FROM public.pet_atendimentos_clinicos a
      JOIN public.pets p ON p.id = a.pet_id
      JOIN public.clientes c ON c.id = p.cliente_id
     WHERE a.id = p_ref::uuid AND a.tenant_id = p_tenant AND a.situacao = 'fechado' AND a.retorno_em IS NOT NULL AND p.ativo;
    IF v_cliente IS NULL THEN RETURN NULL; END IF;
    v_extra := jsonb_build_object('pet', v_pet_nome, 'data', v_data);
  ELSE
    RETURN NULL;
  END IF;
  IF v_cliente IS NULL OR NOT coalesce(v_aceita, false) THEN RETURN NULL; END IF;
  v_num := public._wa_numero(v_tel);
  IF v_num IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.wa_saidas s WHERE s.tenant_id = p_tenant AND s.chave = v_num) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('cliente_id', v_cliente, 'numero', v_num, 'cliente', v_nome)
      || CASE WHEN v_veiculo IS NOT NULL THEN jsonb_build_object('veiculo_id', v_veiculo, 'veiculo', v_ident, 'tipo_veiculo', v_tipo_v) ELSE '{}'::jsonb END
      || CASE WHEN v_pet IS NOT NULL THEN jsonb_build_object('pet_id', v_pet) ELSE '{}'::jsonb END
      || v_extra;
END $fn$;
REVOKE ALL ON FUNCTION public._wa_variaveis(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Coloca na fila. Devolve o id, ou NULL quando a ocasião não vale (ver _wa_variaveis) ou já tem mensagem.
-- p_reabrir: mensagem que falhou ou foi cancelada volta para a fila (só no pedido manual da recepção).
DROP FUNCTION IF EXISTS public._wa_enfileirar(uuid, text, uuid, text, uuid, boolean);
CREATE OR REPLACE FUNCTION public._wa_enfileirar(p_tenant uuid, p_tipo text, p_ref text, p_origem text, p_usuario uuid, p_reabrir boolean)
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
           numero = v ->> 'numero', variaveis = v, origem = p_origem, criado_por = p_usuario,
           veiculo_id = (v ->> 'veiculo_id')::uuid, pet_id = (v ->> 'pet_id')::uuid
     WHERE tenant_id = p_tenant AND tipo = p_tipo AND referencia = p_ref AND situacao IN ('falhou', 'cancelada')
     RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.wa_mensagens (tenant_id, tipo, referencia, cliente_id, veiculo_id, pet_id, numero, variaveis, origem, criado_por)
  VALUES (p_tenant, p_tipo, p_ref, (v ->> 'cliente_id')::uuid, (v ->> 'veiculo_id')::uuid, (v ->> 'pet_id')::uuid, v ->> 'numero', v, p_origem, p_usuario)
  ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public._wa_enfileirar(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Pedido da recepção (lava rápido), sem mudança de comportamento: referência sempre uuid.
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
  v_id := public._wa_enfileirar(v_tenant, p_tipo, p_referencia, 'manual', auth.uid(), true);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível enfileirar: o aviso já foi enviado ou está na fila, ou o cliente não tem WhatsApp válido, não aceita mensagens ou pediu para sair';
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_enfileirar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_enfileirar(text, text) TO authenticated;

-- Pedido da recepção da clínica: mandar este lembrete pelo sistema.
-- p_referencia: reforco_vacina = '<uuid do pet>:<AAAA-MM-DD>' (a linha da lista de reforços); retorno_consulta = uuid do atendimento.
CREATE OR REPLACE FUNCTION public.clinica_wa_enfileirar(p_tipo text, p_referencia text)
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
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_tipo NOT IN ('reforco_vacina', 'retorno_consulta') THEN RAISE EXCEPTION 'Tipo de aviso inválido'; END IF;
  IF p_referencia IS NULL OR (p_tipo = 'retorno_consulta' AND p_referencia !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR (p_tipo = 'reforco_vacina' AND p_referencia !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$') THEN
    RAISE EXCEPTION 'Referência inválida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'O WhatsApp da empresa não está conectado: conecte em Clínica > WhatsApp da clínica';
  END IF;
  v_id := public._wa_enfileirar(v_tenant, p_tipo, p_referencia, 'manual', auth.uid(), true);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível enfileirar: o lembrete já foi enviado ou está na fila, ou o tutor não tem WhatsApp válido, não aceita mensagens ou pediu para sair';
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.clinica_wa_enfileirar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_wa_enfileirar(text, text) TO authenticated;

-- Automático da clínica: liga ou desliga o lembrete de vacina e o de retorno de consulta.
CREATE OR REPLACE FUNCTION public.clinica_wa_automatico_salvar(p_reforco boolean, p_retorno boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'Conecte o WhatsApp da empresa antes de ligar o envio automático';
  END IF;
  UPDATE public.wa_config
     SET auto_reforco = coalesce(p_reforco, false), auto_retorno = coalesce(p_retorno, false), atualizado_em = now()
   WHERE tenant_id = v_tenant;
END $fn$;
REVOKE ALL ON FUNCTION public.clinica_wa_automatico_salvar(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_wa_automatico_salvar(boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_wa_mensagem_cancelar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  UPDATE public.wa_mensagens SET situacao = 'cancelada', erro = NULL
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND tipo IN ('reforco_vacina', 'retorno_consulta') AND situacao = 'na_fila';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só lembrete da clínica que ainda está na fila pode ser cancelado'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.clinica_wa_mensagem_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_wa_mensagem_cancelar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_wa_mensagem_reenviar(p_id uuid)
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
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  SELECT * INTO m FROM public.wa_mensagens WHERE id = p_id AND tenant_id = v_tenant AND tipo IN ('reforco_vacina', 'retorno_consulta');
  IF m.id IS NULL OR m.situacao NOT IN ('falhou', 'cancelada') THEN
    RAISE EXCEPTION 'Só lembrete que falhou ou foi cancelado pode ser reenviado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'O WhatsApp da empresa não está conectado';
  END IF;
  IF public._wa_enfileirar(v_tenant, m.tipo, m.referencia, 'manual', auth.uid(), true) IS NULL THEN
    RAISE EXCEPTION 'O tutor não tem WhatsApp válido, não aceita mensagens ou pediu para sair';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.clinica_wa_mensagem_reenviar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_wa_mensagem_reenviar(uuid) TO authenticated;

-- ============ rotina do servidor ============
-- Reenvio manual do lava rápido: a referência agora segue como texto (uuid continua chegando igual).
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
  IF public._wa_enfileirar(v_tenant, m.tipo, m.referencia, 'manual', auth.uid(), true) IS NULL THEN
    RAISE EXCEPTION 'O cliente não tem WhatsApp válido, não aceita mensagens ou pediu para sair';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_mensagem_reenviar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_mensagem_reenviar(uuid) TO authenticated;

-- Varredura do automático: além do lava rápido, enfileira vacina/vermífugo a vencer em até 3 dias (ou atrasada
-- em até 7) e retorno de consulta de hoje até 2 dias à frente, das empresas com a clínica liberada e a chave ligada.
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
  FOR c IN SELECT * FROM public.wa_config WHERE estado = 'conectada' AND (auto_pronto OR auto_plano OR auto_reforco OR auto_retorno) LOOP
    IF c.auto_pronto THEN
      FOR r IN SELECT o.id FROM public.lr_ordens o
                WHERE o.tenant_id = c.tenant_id AND o.situacao = 'pronto' AND o.pronto_em >= coalesce(c.auto_desde, now()) AND o.pronto_em >= now() - interval '1 day'
                  AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'pronto' AND k.referencia = o.id::text)
                  AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'pronto' AND m.referencia = o.id::text)
                ORDER BY o.pronto_em LIMIT 50 LOOP
        IF public._wa_enfileirar(c.tenant_id, 'pronto', r.id::text, 'automatico', NULL, false) IS NOT NULL THEN v_total := v_total + 1; END IF;
      END LOOP;
    END IF;
    IF c.auto_plano THEN
      FOR r IN SELECT a.id FROM public.lr_assinaturas a
                WHERE a.tenant_id = c.tenant_id AND a.situacao = 'ativa' AND a.vence_em BETWEEN v_hoje AND v_hoje + 3
                  AND NOT EXISTS (SELECT 1 FROM public.lr_assinaturas b WHERE b.veiculo_id = a.veiculo_id AND b.situacao = 'ativa' AND b.vence_em > a.vence_em)
                  AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'plano_vencendo' AND k.referencia = a.id::text)
                  AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'plano_vencendo' AND m.referencia = a.id::text)
                ORDER BY a.vence_em LIMIT 50 LOOP
        IF public._wa_enfileirar(c.tenant_id, 'plano_vencendo', r.id::text, 'automatico', NULL, false) IS NOT NULL THEN v_total := v_total + 1; END IF;
      END LOOP;
    END IF;
    IF (c.auto_reforco OR c.auto_retorno) AND public._wa_clinica_liberada(c.tenant_id) THEN
      IF c.auto_reforco THEN
        FOR r IN SELECT q.pet_id, q.ref
                  FROM (
                    SELECT DISTINCT ON (v.pet_id, v.catalogo_id) v.pet_id, v.proxima_dose_em AS ref
                      FROM public.pet_vacinacoes v
                      JOIN public.pets p ON p.id = v.pet_id
                      JOIN public.pet_vacinas_catalogo k ON k.id = v.catalogo_id AND k.ativo
                     WHERE v.tenant_id = c.tenant_id AND v.situacao = 'ativa' AND p.ativo
                     ORDER BY v.pet_id, v.catalogo_id, v.aplicada_em DESC, v.created_at DESC
                  ) q
                 WHERE q.ref IS NOT NULL AND q.ref BETWEEN v_hoje - 7 AND v_hoje + 3
                   AND NOT EXISTS (SELECT 1 FROM public.pet_contatos t WHERE t.pet_id = q.pet_id AND t.tipo = 'reforco' AND t.referencia = q.ref)
                   AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'reforco_vacina'
                                     AND m.referencia = q.pet_id::text || ':' || q.ref::text)
                   AND NOT EXISTS (SELECT 1 FROM public.pet_agendamentos a
                                     JOIN public.pet_agendamento_itens i ON i.agendamento_id = a.id
                                     JOIN public.pet_servicos s ON s.id = i.servico_id
                                    WHERE a.pet_id = q.pet_id AND s.categoria = 'vacina'
                                      AND a.situacao IN ('agendado', 'confirmado', 'em_atendimento') AND a.inicio >= now() - interval '1 day')
                 ORDER BY q.ref LIMIT 50 LOOP
          IF public._wa_enfileirar(c.tenant_id, 'reforco_vacina', r.pet_id::text || ':' || r.ref::text, 'automatico', NULL, false) IS NOT NULL THEN
            v_total := v_total + 1;
          END IF;
        END LOOP;
      END IF;
      IF c.auto_retorno THEN
        FOR r IN SELECT a.id FROM public.pet_atendimentos_clinicos a
                  JOIN public.pets p ON p.id = a.pet_id
                 WHERE a.tenant_id = c.tenant_id AND a.situacao = 'fechado' AND a.retorno_em BETWEEN v_hoje AND v_hoje + 2 AND p.ativo
                   AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'retorno_consulta' AND m.referencia = a.id::text)
                 ORDER BY a.retorno_em LIMIT 50 LOOP
          IF public._wa_enfileirar(c.tenant_id, 'retorno_consulta', r.id::text, 'automatico', NULL, false) IS NOT NULL THEN
            v_total := v_total + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  RETURN v_total;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_auto_varrer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_varrer() TO service_role;

-- Reserva o que está na hora: reconfere cada mensagem (também as da clínica), cancela o automático de chave
-- desligada e envia o modelo de texto certo para cada tipo (lava rápido, reforço ou retorno da clínica).
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
  -- automático com a chave desligada (ou desconectado) não sai mais: cancela o que ficou na fila, o manual segue
  UPDATE public.wa_mensagens m SET situacao = 'cancelada', erro = 'Envio automático desligado'
   WHERE m.situacao = 'na_fila' AND m.origem = 'automatico'
     AND NOT EXISTS (SELECT 1 FROM public.wa_config c WHERE c.tenant_id = m.tenant_id AND c.estado = 'conectada'
                       AND ((m.tipo = 'pronto' AND c.auto_pronto) OR (m.tipo = 'plano_vencendo' AND c.auto_plano)
                         OR (m.tipo = 'reforco_vacina' AND c.auto_reforco) OR (m.tipo = 'retorno_consulta' AND c.auto_retorno)));
  -- reconfere cada mensagem na hora de enviar: cliente que deixou de aceitar mensagens, pediu SAIR, ficou sem telefone válido
  -- ou ocasião que já não vale são cancelados. Quem segue valendo é enviado ao telefone e com os dados de agora.
  UPDATE public.wa_mensagens m
     SET situacao = CASE WHEN x.v IS NULL THEN 'cancelada' ELSE m.situacao END,
         erro = CASE WHEN x.v IS NULL THEN 'O cliente não pode mais receber esta mensagem' ELSE m.erro END,
         numero = coalesce(x.v ->> 'numero', m.numero),
         variaveis = coalesce(x.v, m.variaveis)
    FROM (SELECT d.id, public._wa_variaveis(d.tenant_id, d.tipo, d.referencia) AS v
            FROM public.wa_mensagens d
           WHERE d.situacao = 'na_fila' AND d.proxima_tentativa <= now()) x
   WHERE m.id = x.id AND m.situacao = 'na_fila';
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
           'modelo', CASE WHEN r.tipo = 'reforco_vacina'
                          THEN (SELECT mm.texto FROM public.pet_mensagem_modelos mm WHERE mm.tenant_id = r.tenant_id AND mm.tipo = 'reforco')
                          WHEN r.tipo = 'retorno_consulta'
                          THEN (SELECT mm.texto FROM public.pet_mensagem_modelos mm WHERE mm.tenant_id = r.tenant_id AND mm.tipo = 'retorno_clinica')
                          ELSE (SELECT mm.texto FROM public.lr_mensagem_modelos mm WHERE mm.tenant_id = r.tenant_id AND mm.tipo = r.tipo) END,
           'loja', (SELECT coalesce(nullif(e.nome_fantasia, ''), e.razao_social) FROM public.empresas e WHERE e.tenant_id = r.tenant_id ORDER BY e.created_at, e.id LIMIT 1))), '[]'::jsonb)
    INTO v_itens
    FROM reservadas r JOIN public.wa_config c ON c.tenant_id = r.tenant_id;
  RETURN v_itens;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_reservar(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reservar(integer, integer, boolean) TO service_role;

-- Resultado do envio. Enviada: sai da lista de chamadas (lava rápido: lr_contatos; vacina da clínica: pet_contatos,
-- que tira o pet da lista manual de reforços da recepção). Falha com p_proxima: volta para a fila nesse horário.
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
    IF m.tipo = 'reforco_vacina' AND m.pet_id IS NOT NULL AND m.referencia ~ ':\d{4}-\d{2}-\d{2}$' THEN
      INSERT INTO public.pet_contatos (tenant_id, pet_id, tipo, referencia, canal, contatado_por)
      VALUES (m.tenant_id, m.pet_id, 'reforco', right(m.referencia, 10)::date, 'whatsapp', m.criado_por)
      ON CONFLICT (pet_id, tipo, referencia) DO NOTHING;
    ELSIF m.tipo IN ('pronto', 'plano_vencendo', 'retorno') THEN
      INSERT INTO public.lr_contatos (tenant_id, tipo, referencia, cliente_id, veiculo_id, canal, feito_por)
      VALUES (m.tenant_id, m.tipo, m.referencia, m.cliente_id, m.veiculo_id, 'whatsapp', m.criado_por)
      ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING;
    END IF;
  ELSIF p_proxima IS NOT NULL THEN
    UPDATE public.wa_mensagens SET situacao = 'na_fila', proxima_tentativa = p_proxima, erro = left(p_erro, 300) WHERE id = p_id;
  ELSE
    UPDATE public.wa_mensagens SET situacao = 'falhou', erro = left(p_erro, 300) WHERE id = p_id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) TO service_role;
