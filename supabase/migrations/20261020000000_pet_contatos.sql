-- Pet shop, Fase 2 (PR 5): contatos com o tutor. Aniversário do pet e retorno de banho viram listas para a recepção;
-- o contato registrado tira o pet da lista naquela ocasião. Sem envio automático: o clique é da recepção.

CREATE TABLE IF NOT EXISTS public.pet_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  tipo text NOT NULL CHECK (tipo IN ('aniversario', 'retorno')),
  -- a ocasião: o dia do aniversário, ou a data do último atendimento que motivou o retorno
  referencia date NOT NULL,
  canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'telefone', 'outro')),
  observacao text,
  contatado_por uuid DEFAULT auth.uid(),
  contatado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pet_id, tipo, referencia)
);
CREATE INDEX IF NOT EXISTS pet_contatos_tenant_idx ON public.pet_contatos (tenant_id, tipo, referencia);

ALTER TABLE public.pet_contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_contatos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pet_contatos TO authenticated;
GRANT ALL ON public.pet_contatos TO service_role;
CREATE POLICY pet_contatos_ler ON public.pet_contatos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.pet_contatos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- p_tipo: 'aniversario' (p_janela = dias à frente) ou 'retorno' (p_dias = dias sem atendimento).
CREATE OR REPLACE FUNCTION public.pet_contatos_pendentes(p_tipo text, p_dias integer DEFAULT 30, p_janela integer DEFAULT 7)
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
  IF p_tipo NOT IN ('aniversario', 'retorno') THEN RAISE EXCEPTION 'Tipo de contato inválido'; END IF;

  IF p_tipo = 'aniversario' THEN
    IF p_janela IS NULL OR p_janela < 0 OR p_janela > 60 THEN RAISE EXCEPTION 'A janela precisa ficar entre 0 e 60 dias'; END IF;
    RETURN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'pet_id', t.id, 'pet', t.nome, 'tutor', t.tutor, 'telefone', t.telefone,
               'referencia', t.prox, 'anos', extract(year FROM age(t.prox, t.nascimento))::int) ORDER BY t.prox, t.nome)
        FROM (
          SELECT x.*, CASE WHEN x.cand < v_hoje THEN (x.nascimento + make_interval(years => x.anos + 1))::date ELSE x.cand END AS prox
            FROM (
              SELECT p.id, p.nome, p.nascimento, c.nome AS tutor, c.telefone,
                     extract(year FROM age(v_hoje, p.nascimento))::int AS anos,
                     (p.nascimento + make_interval(years => extract(year FROM age(v_hoje, p.nascimento))::int))::date AS cand
                FROM public.pets p JOIN public.clientes c ON c.id = p.cliente_id
               WHERE p.tenant_id = v_tenant AND p.ativo AND p.nascimento IS NOT NULL AND p.nascimento <= v_hoje
            ) x
        ) t
       WHERE t.prox BETWEEN v_hoje AND v_hoje + p_janela
         AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = t.id AND k.tipo = 'aniversario' AND k.referencia = t.prox)
    ), '[]'::jsonb);
  END IF;

  IF p_dias IS NULL OR p_dias < 7 OR p_dias > 365 THEN RAISE EXCEPTION 'O prazo precisa ficar entre 7 e 365 dias'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'pet_id', t.id, 'pet', t.nome, 'tutor', t.tutor, 'telefone', t.telefone,
             'referencia', t.ultimo, 'dias', v_hoje - t.ultimo) ORDER BY t.ultimo, t.nome)
      FROM (
        SELECT p.id, p.nome, c.nome AS tutor, c.telefone,
               (SELECT max((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date) FROM public.pet_agendamentos a
                 WHERE a.pet_id = p.id AND a.situacao = 'retirado') AS ultimo
          FROM public.pets p JOIN public.clientes c ON c.id = p.cliente_id
         WHERE p.tenant_id = v_tenant AND p.ativo
           -- já tem atendimento marcado ou em andamento: não precisa de lembrete
           AND NOT EXISTS (SELECT 1 FROM public.pet_agendamentos f WHERE f.pet_id = p.id
                            AND f.situacao IN ('agendado', 'confirmado', 'em_atendimento', 'pronto') AND f.inicio >= now() - interval '1 day')
      ) t
     WHERE t.ultimo IS NOT NULL AND t.ultimo <= v_hoje - p_dias
       AND NOT EXISTS (SELECT 1 FROM public.pet_contatos k WHERE k.pet_id = t.id AND k.tipo = 'retorno' AND k.referencia = t.ultimo)
     LIMIT 300
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.pet_contatos_pendentes(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_contatos_pendentes(text, integer, integer) TO authenticated;

-- Registrar é idempotente: repetir a mesma ocasião não duplica nem falha.
CREATE OR REPLACE FUNCTION public.pet_contato_registrar(p_pet_id uuid, p_tipo text, p_referencia date, p_canal text DEFAULT 'whatsapp', p_observacao text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_tipo NOT IN ('aniversario', 'retorno') THEN RAISE EXCEPTION 'Tipo de contato inválido'; END IF;
  IF p_canal NOT IN ('whatsapp', 'telefone', 'outro') THEN RAISE EXCEPTION 'Canal inválido'; END IF;
  IF p_referencia IS NULL THEN RAISE EXCEPTION 'Informe a ocasião do contato'; END IF;
  PERFORM 1 FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  INSERT INTO public.pet_contatos (tenant_id, pet_id, tipo, referencia, canal, observacao)
  VALUES (v_tenant, p_pet_id, p_tipo, p_referencia, p_canal, nullif(btrim(p_observacao), ''))
  ON CONFLICT (pet_id, tipo, referencia) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.pet_contato_registrar(uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_contato_registrar(uuid, text, date, text, text) TO authenticated;
