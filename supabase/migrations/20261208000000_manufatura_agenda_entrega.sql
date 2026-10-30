-- Manufatura (fase 2): agenda de entrega e instalação do móvel sob medida. Cada compromisso é ligado a uma ordem de produção
-- (entrega, instalação ou as duas), com data, hora, endereço, responsável e situação (agendada, em andamento, concluída, cancelada).
-- Escrita só pelas funções; leitura da tabela só da gestão; a produção lê pela função da agenda (sem custo) e só avança a situação.
-- Não mexe em pedido, estoque nem no módulo de entregas do delivery. Reexecutável.

CREATE TABLE IF NOT EXISTS public.mf_entregas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.mf_ordens(id),
  tipo text NOT NULL CHECK (tipo IN ('entrega', 'instalacao', 'entrega_instalacao')),
  data date NOT NULL,
  hora time,
  endereco text NOT NULL CHECK (length(btrim(endereco)) > 0),
  responsavel text,
  observacoes text,
  situacao text NOT NULL DEFAULT 'agendada' CHECK (situacao IN ('agendada', 'em_andamento', 'concluida', 'cancelada')),
  concluida_em timestamptz,
  criada_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mf_entregas_data_idx ON public.mf_entregas (tenant_id, data);
CREATE INDEX IF NOT EXISTS mf_entregas_ordem_idx ON public.mf_entregas (ordem_id);

ALTER TABLE public.mf_entregas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mf_entregas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mf_entregas TO authenticated;
GRANT ALL ON public.mf_entregas TO service_role;
DROP POLICY IF EXISTS mf_entregas_ler ON public.mf_entregas;
DROP POLICY IF EXISTS salao_restrito ON public.mf_entregas;
CREATE POLICY mf_entregas_ler ON public.mf_entregas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
CREATE POLICY salao_restrito ON public.mf_entregas AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
DROP TRIGGER IF EXISTS trg_mf_entregas_updated ON public.mf_entregas;
CREATE TRIGGER trg_mf_entregas_updated BEFORE UPDATE ON public.mf_entregas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Cria (sem id) ou reagenda um compromisso que ainda não terminou.
-- p_dados: id?, ordem_id, tipo, data, hora?, endereco? (se vazio, usa o endereço de entrega do pedido da ordem), responsavel?, observacoes?
CREATE OR REPLACE FUNCTION public.mf_entrega_salvar(p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_ordem uuid := nullif(p_dados ->> 'ordem_id', '')::uuid;
  v_tipo text := coalesce(p_dados ->> 'tipo', '');
  v_data date := nullif(p_dados ->> 'data', '')::date;
  v_hora time := nullif(p_dados ->> 'hora', '')::time;
  v_end text := nullif(btrim(coalesce(p_dados ->> 'endereco', '')), '');
  v_resp text := nullif(btrim(coalesce(p_dados ->> 'responsavel', '')), '');
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), '');
  o public.mf_ordens; e public.mf_entregas;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF v_tipo NOT IN ('entrega', 'instalacao', 'entrega_instalacao') THEN RAISE EXCEPTION 'Escolha entrega, instalação ou entrega e instalação'; END IF;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data'; END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO e FROM public.mf_entregas WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Compromisso não encontrado'; END IF;
    IF e.situacao IN ('concluida', 'cancelada') THEN RAISE EXCEPTION 'Compromisso já encerrado: crie um novo'; END IF;
    v_ordem := e.ordem_id;
  END IF;
  SELECT * INTO o FROM public.mf_ordens WHERE id = v_ordem AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao = 'cancelada' THEN RAISE EXCEPTION 'A ordem está cancelada'; END IF;
  IF v_end IS NULL AND o.pedido_id IS NOT NULL THEN
    SELECT nullif(btrim(concat_ws(', ', nullif(btrim(p.entrega_endereco), ''), nullif(btrim(p.entrega_numero), ''), nullif(btrim(p.entrega_bairro), ''),
                                  nullif(btrim(p.entrega_cidade), ''), nullif(btrim(p.entrega_estado), ''))), '')
      INTO v_end FROM public.pedidos p WHERE p.id = o.pedido_id AND p.tenant_id = v_tenant;
  END IF;
  IF v_end IS NULL THEN RAISE EXCEPTION 'Informe o endereço'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.mf_entregas (tenant_id, ordem_id, tipo, data, hora, endereco, responsavel, observacoes, criada_por)
    VALUES (v_tenant, v_ordem, v_tipo, v_data, v_hora, v_end, v_resp, v_obs, auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.mf_entregas SET tipo = v_tipo, data = v_data, hora = v_hora, endereco = v_end, responsavel = v_resp, observacoes = v_obs WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_entrega_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_entrega_salvar(jsonb) TO authenticated;

-- Avança a situação: agendada -> em andamento -> concluída. A produção só avança; cancelar é da gestão. Encerrado não volta.
CREATE OR REPLACE FUNCTION public.mf_entrega_situacao(p_id uuid, p_situacao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  e public.mf_entregas;
  v_gestao boolean;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  v_gestao := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  IF p_situacao NOT IN ('em_andamento', 'concluida', 'cancelada') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  IF p_situacao = 'cancelada' AND NOT v_gestao THEN RAISE EXCEPTION 'Só a gestão cancela um compromisso'; END IF;
  SELECT * INTO e FROM public.mf_entregas WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compromisso não encontrado'; END IF;
  IF e.situacao IN ('concluida', 'cancelada') THEN RAISE EXCEPTION 'Compromisso já encerrado'; END IF;
  IF p_situacao = 'em_andamento' AND e.situacao <> 'agendada' THEN RAISE EXCEPTION 'O compromisso já está em andamento'; END IF;
  UPDATE public.mf_entregas SET situacao = p_situacao, concluida_em = CASE WHEN p_situacao = 'concluida' THEN now() ELSE concluida_em END WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_entrega_situacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_entrega_situacao(uuid, text) TO authenticated;

-- Agenda do período (até 1 ano) para a gestão e a produção: sem custo nenhum.
CREATE OR REPLACE FUNCTION public.mf_entregas_agenda(p_de date, p_ate date)
RETURNS TABLE (id uuid, ordem_id uuid, ordem_numero bigint, descricao text, cliente text, tipo text, data date, hora time, endereco text,
               responsavel text, observacoes text, situacao text, concluida_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 366 THEN RAISE EXCEPTION 'Informe um período de até um ano'; END IF;
  RETURN QUERY
  SELECT e.id, e.ordem_id, o.numero, o.descricao, c.nome, e.tipo, e.data, e.hora, e.endereco, e.responsavel, e.observacoes, e.situacao, e.concluida_em
    FROM public.mf_entregas e
    JOIN public.mf_ordens o ON o.id = e.ordem_id AND o.tenant_id = e.tenant_id
    LEFT JOIN public.pedidos p ON p.id = o.pedido_id AND p.tenant_id = e.tenant_id
    LEFT JOIN public.clientes c ON c.id = p.cliente_id AND c.tenant_id = e.tenant_id
   WHERE e.tenant_id = public.current_tenant_id() AND e.data BETWEEN p_de AND p_ate
   ORDER BY e.data, e.hora NULLS LAST, o.numero;
END $$;
REVOKE ALL ON FUNCTION public.mf_entregas_agenda(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_entregas_agenda(date, date) TO authenticated;
