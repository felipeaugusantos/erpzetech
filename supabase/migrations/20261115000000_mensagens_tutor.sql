-- Mensagens ao tutor: novos avisos para a recepção chamar no WhatsApp (confirmar agenda, pet pronto, exame pronto), modelos de mensagem
-- guardados por empresa (antes ficavam só no navegador) e a opção do tutor de não receber mensagens (LGPD).
-- Sem envio automático: o clique continua sendo da recepção. A fila e os modelos já servem de base para ligar a API oficial depois.

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS aceita_mensagens boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.clientes.aceita_mensagens IS 'Tutor que pediu para não receber mensagens: some das listas de contato do pet shop e da clínica.';

ALTER TABLE public.pet_contatos DROP CONSTRAINT IF EXISTS pet_contatos_tipo_check;
ALTER TABLE public.pet_contatos ADD CONSTRAINT pet_contatos_tipo_check
  CHECK (tipo IN ('aniversario', 'retorno', 'reforco', 'confirmacao', 'pronto', 'exame'));

-- Modelos de mensagem por empresa. Sem linha = vale o texto padrão do sistema.
CREATE TABLE IF NOT EXISTS public.pet_mensagem_modelos (
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('aniversario', 'retorno', 'reforco', 'confirmacao', 'pronto', 'exame')),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 5 AND 600),
  atualizado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tipo)
);
ALTER TABLE public.pet_mensagem_modelos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_mensagem_modelos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pet_mensagem_modelos TO authenticated;
GRANT ALL ON public.pet_mensagem_modelos TO service_role;
CREATE POLICY pet_mensagem_modelos_ler ON public.pet_mensagem_modelos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.pet_mensagem_modelos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- Texto em branco volta ao padrão do sistema.
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
  IF p_tipo NOT IN ('aniversario', 'retorno', 'reforco', 'confirmacao', 'pronto', 'exame') THEN RAISE EXCEPTION 'Tipo de mensagem inválido'; END IF;
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

-- Registrar contato aceita os novos tipos; "exame" exige a clínica liberada, como o reforço.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_contato_registrar';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_contato_registrar não encontrada'; END IF;
  IF position('''confirmacao''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, E'IF p_tipo NOT IN (''aniversario'', ''retorno'', ''reforco'') THEN RAISE EXCEPTION ''Tipo de contato inválido''; END IF;',
    E'IF p_tipo NOT IN (''aniversario'', ''retorno'', ''reforco'', ''confirmacao'', ''pronto'', ''exame'') THEN RAISE EXCEPTION ''Tipo de contato inválido''; END IF;\n'
    || E'  IF p_tipo = ''exame'' AND NOT public.clinica_liberada() THEN RAISE EXCEPTION ''A clínica não está liberada para esta empresa''; END IF;');
  IF nova = def THEN RAISE EXCEPTION 'pet_contato_registrar: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- Tutor que não quer mensagens sai das listas que já existem, e as listas passam a usar o WhatsApp do tutor (quando tem) em vez do telefone.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_contatos_pendentes';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_contatos_pendentes não encontrada'; END IF;
  IF position('aceita_mensagens' IN def) = 0 THEN
    nova := replace(def, 'WHERE p.tenant_id = v_tenant AND p.ativo', 'WHERE p.tenant_id = v_tenant AND p.ativo AND c.aceita_mensagens');
    nova := replace(nova, 'c.telefone,', 'coalesce(nullif(btrim(c.whatsapp), ''''), c.telefone) AS telefone,');
    IF nova = def THEN RAISE EXCEPTION 'pet_contatos_pendentes: trecho esperado não encontrado'; END IF;
    EXECUTE nova;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'clinica_reforcos_pendentes';
  IF def IS NULL THEN RAISE EXCEPTION 'clinica_reforcos_pendentes não encontrada'; END IF;
  IF position('aceita_mensagens' IN def) = 0 THEN
    nova := replace(def, 'WHERE v.tenant_id = v_tenant AND v.situacao = ''ativa'' AND p.ativo', 'WHERE v.tenant_id = v_tenant AND v.situacao = ''ativa'' AND p.ativo AND c.aceita_mensagens');
    nova := replace(nova, 'c.telefone,', 'coalesce(nullif(btrim(c.whatsapp), ''''), c.telefone) AS telefone,');
    IF nova = def THEN RAISE EXCEPTION 'clinica_reforcos_pendentes: trecho esperado não encontrado'; END IF;
    EXECUTE nova;
  END IF;
END $$;

-- Avisos de rotina do dia. p_tipo:
--   'confirmacao': agendamentos de banho e tosa ainda "agendado" de hoje até p_janela dias à frente (pedir para confirmar);
--   'pronto': pets "pronto" para retirar, dos últimos 2 dias;
--   'exame': exames fechados nos últimos p_janela dias (só avisa que está pronto; nada do resultado vai na mensagem).
-- Quem já foi chamado para aquela ocasião sai da lista; tutor que não quer mensagens não entra.
CREATE OR REPLACE FUNCTION public.pet_mensagens_pendentes(p_tipo text, p_janela integer DEFAULT 1)
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
  IF p_tipo NOT IN ('confirmacao', 'pronto', 'exame') THEN RAISE EXCEPTION 'Tipo de aviso inválido'; END IF;
  IF p_janela IS NULL OR p_janela < 0 OR p_janela > 30 THEN RAISE EXCEPTION 'A janela precisa ficar entre 0 e 30 dias'; END IF;

  IF p_tipo = 'confirmacao' THEN
    RETURN coalesce((
      SELECT jsonb_agg(jsonb_build_object('pet_id', x.pet_id, 'pet', x.pet, 'tutor', x.tutor, 'telefone', x.telefone,
                                           'referencia', x.dia, 'hora', x.hora, 'servicos', x.servicos) ORDER BY x.dia, x.hora, x.pet)
        FROM (
          SELECT DISTINCT ON (a.pet_id, (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date)
                 a.pet_id, p.nome AS pet, c.nome AS tutor, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone) AS telefone,
                 (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                 to_char(a.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora,
                 (SELECT string_agg(s.nome, ' e ' ORDER BY s.nome) FROM public.pet_agendamento_itens i
                    JOIN public.pet_servicos s ON s.id = i.servico_id WHERE i.agendamento_id = a.id) AS servicos
            FROM public.pet_agendamentos a
            JOIN public.pets p ON p.id = a.pet_id
            JOIN public.clientes c ON c.id = p.cliente_id
           WHERE a.tenant_id = v_tenant AND a.situacao = 'agendado' AND p.ativo AND c.aceita_mensagens
             AND a.inicio >= now() AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= v_hoje + p_janela
             AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = a.pet_id AND k.tipo = 'confirmacao'
                              AND k.referencia = (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date)
           ORDER BY a.pet_id, (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date, a.inicio
           LIMIT 300
        ) x
    ), '[]'::jsonb);
  END IF;

  IF p_tipo = 'pronto' THEN
    RETURN coalesce((
      SELECT jsonb_agg(jsonb_build_object('pet_id', x.pet_id, 'pet', x.pet, 'tutor', x.tutor, 'telefone', x.telefone,
                                           'referencia', x.dia) ORDER BY x.dia, x.pet)
        FROM (
          SELECT DISTINCT ON (a.pet_id, (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date)
                 a.pet_id, p.nome AS pet, c.nome AS tutor, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone) AS telefone,
                 (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date AS dia
            FROM public.pet_agendamentos a
            JOIN public.pets p ON p.id = a.pet_id
            JOIN public.clientes c ON c.id = p.cliente_id
           WHERE a.tenant_id = v_tenant AND a.situacao = 'pronto' AND p.ativo AND c.aceita_mensagens
             AND (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date >= v_hoje - 2
             AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = a.pet_id AND k.tipo = 'pronto'
                              AND k.referencia = (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date)
           ORDER BY a.pet_id, (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date
           LIMIT 300
        ) x
    ), '[]'::jsonb);
  END IF;

  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('pet_id', x.pet_id, 'pet', x.pet, 'tutor', x.tutor, 'telefone', x.telefone,
                                         'referencia', x.dia) ORDER BY x.dia, x.pet)
      FROM (
        SELECT DISTINCT ON (e.pet_id, (e.fechado_em AT TIME ZONE 'America/Sao_Paulo')::date)
               e.pet_id, p.nome AS pet, c.nome AS tutor, coalesce(nullif(btrim(c.whatsapp), ''), c.telefone) AS telefone,
               (e.fechado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
          FROM public.pet_exames e
          JOIN public.pets p ON p.id = e.pet_id
          JOIN public.clientes c ON c.id = p.cliente_id
         WHERE e.tenant_id = v_tenant AND e.situacao = 'fechado' AND p.ativo AND c.aceita_mensagens
           AND (e.fechado_em AT TIME ZONE 'America/Sao_Paulo')::date >= v_hoje - p_janela
           AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = e.pet_id AND k.tipo = 'exame'
                            AND k.referencia = (e.fechado_em AT TIME ZONE 'America/Sao_Paulo')::date)
         ORDER BY e.pet_id, (e.fechado_em AT TIME ZONE 'America/Sao_Paulo')::date
         LIMIT 300
      ) x
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_mensagens_pendentes(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_mensagens_pendentes(text, integer) TO authenticated;
