-- Importação de extrato bancário (OFX) na conciliação.
-- O arquivo é lido na tela; o banco recebe só as linhas. Cada linha do banco (FITID) entra uma única vez por conta;
-- a que bate com um lançamento do sistema (mesma conta, mesmo valor, mesmo sentido, até 3 dias de diferença) concilia
-- esse lançamento sozinha; as demais ficam pendentes para lançar ou ignorar.

CREATE TABLE IF NOT EXISTS public.banco_extrato_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES public.contas_bancarias(id),
  fitid text NOT NULL CHECK (length(fitid) BETWEEN 1 AND 100),
  data date NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor <> 0),
  descricao text NOT NULL,
  documento text,
  arquivo text,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('conciliada', 'pendente', 'ignorada')),
  movimento_id uuid REFERENCES public.banco_movimentos(id),
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, fitid)
);
CREATE INDEX IF NOT EXISTS banco_extrato_linhas_tenant_idx ON public.banco_extrato_linhas (tenant_id, situacao, data);
CREATE UNIQUE INDEX IF NOT EXISTS banco_extrato_linhas_mov_idx ON public.banco_extrato_linhas (movimento_id) WHERE movimento_id IS NOT NULL;

ALTER TABLE public.banco_extrato_linhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.banco_extrato_linhas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.banco_extrato_linhas TO authenticated;
GRANT ALL ON public.banco_extrato_linhas TO service_role;
CREATE POLICY banco_extrato_linhas_ler ON public.banco_extrato_linhas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro')));
CREATE POLICY salao_restrito ON public.banco_extrato_linhas AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- p_linhas: [{fitid, data (AAAA-MM-DD), valor (com sinal), descricao, documento}]
CREATE OR REPLACE FUNCTION public.banco_extrato_importar(
  p_conta_id uuid, p_linhas jsonb, p_arquivo text DEFAULT NULL, p_simular boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  it jsonb;
  v_n integer := 0;
  v_fitid text; v_data date; v_valor numeric; v_desc text; v_doc text;
  v_mov uuid; v_usados uuid[] := '{}';
  v_vistos text[] := '{}';
  v_sit text;
  v_conc integer := 0; v_pend integer := 0; v_rep integer := 0;
  v_saida boolean;
  v_saidas constant text[] := ARRAY['saida', 'tarifa', 'transferencia_saida', 'pagamento'];
  v_saida_lista jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  IF jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'O extrato não tem lançamentos';
  END IF;
  IF jsonb_array_length(p_linhas) > 2000 THEN
    RAISE EXCEPTION 'O extrato tem mais de 2000 lançamentos; importe por períodos menores';
  END IF;
  PERFORM 1 FROM public.contas_bancarias WHERE id = p_conta_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta bancária não encontrada'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('extrato:' || p_conta_id::text, 0));

  FOR it IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_n := v_n + 1;
    BEGIN
      v_fitid := nullif(btrim(it ->> 'fitid'), '');
      v_data := (it ->> 'data')::date;
      IF jsonb_typeof(it -> 'valor') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'valor'; END IF;
      v_valor := round((it ->> 'valor')::numeric, 2);
      v_desc := left(coalesce(nullif(btrim(it ->> 'descricao'), ''), 'Lançamento do extrato'), 200);
      v_doc := nullif(btrim(it ->> 'documento'), '');
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Lançamento % do extrato está inválido', v_n;
    END;
    IF v_fitid IS NULL OR length(v_fitid) > 100 OR v_data IS NULL OR v_valor IS NULL OR v_valor = 0 THEN
      RAISE EXCEPTION 'Lançamento % do extrato está inválido', v_n;
    END IF;
    IF v_fitid = ANY (v_vistos) THEN
      RAISE EXCEPTION 'Lançamento %: identificador % repetido no arquivo', v_n, v_fitid;
    END IF;
    v_vistos := v_vistos || v_fitid;

    IF EXISTS (SELECT 1 FROM public.banco_extrato_linhas l WHERE l.conta_id = p_conta_id AND l.fitid = v_fitid) THEN
      v_rep := v_rep + 1;
      v_sit := 'repetida';
    ELSE
      v_saida := v_valor < 0;
      SELECT m.id INTO v_mov
        FROM public.banco_movimentos m
       WHERE m.tenant_id = v_tenant AND m.conta_id = p_conta_id AND NOT m.conciliado
         AND m.valor = abs(v_valor)
         AND (m.tipo = ANY (v_saidas)) = v_saida
         AND abs(m.data - v_data) <= 3
         AND m.id <> ALL (v_usados)
         AND NOT EXISTS (SELECT 1 FROM public.banco_extrato_linhas l WHERE l.movimento_id = m.id)
       ORDER BY abs(m.data - v_data), m.created_at
       LIMIT 1;
      IF v_mov IS NOT NULL THEN
        v_sit := 'conciliada'; v_conc := v_conc + 1; v_usados := v_usados || v_mov;
      ELSE
        v_sit := 'pendente'; v_pend := v_pend + 1;
      END IF;
      IF NOT p_simular THEN
        INSERT INTO public.banco_extrato_linhas (tenant_id, conta_id, fitid, data, valor, descricao, documento, arquivo, situacao, movimento_id)
        VALUES (v_tenant, p_conta_id, v_fitid, v_data, v_valor, v_desc, v_doc, left(p_arquivo, 200), v_sit, v_mov);
        IF v_mov IS NOT NULL THEN
          UPDATE public.banco_movimentos SET conciliado = true, conciliado_em = now() WHERE id = v_mov;
        END IF;
      END IF;
    END IF;
    v_mov := NULL;
    IF v_n <= 1000 THEN
      v_saida_lista := v_saida_lista || jsonb_build_object(
        'fitid', v_fitid, 'data', v_data, 'valor', v_valor, 'descricao', v_desc, 'situacao', v_sit);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'simulado', p_simular, 'total', v_n, 'conciliadas', v_conc,
                            'pendentes', v_pend, 'repetidas', v_rep, 'linhas', v_saida_lista);
END $$;
REVOKE ALL ON FUNCTION public.banco_extrato_importar(uuid, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_extrato_importar(uuid, jsonb, text, boolean) TO authenticated;

-- Linha do banco que o sistema não conhecia vira lançamento (já conciliado).
CREATE OR REPLACE FUNCTION public.banco_extrato_lancar(p_linha_id uuid, p_categoria text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  l public.banco_extrato_linhas%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  SELECT * INTO l FROM public.banco_extrato_linhas WHERE id = p_linha_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento do extrato não encontrado'; END IF;
  IF l.situacao <> 'pendente' THEN RAISE EXCEPTION 'Este lançamento do extrato já foi tratado'; END IF;
  INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, documento, origem, conciliado, conciliado_em, usuario_id)
  VALUES (v_tenant, l.conta_id, l.data, CASE WHEN l.valor < 0 THEN 'saida' ELSE 'entrada' END,
          coalesce(nullif(btrim(p_categoria), ''), 'extrato'), abs(l.valor), l.descricao, l.documento, 'extrato', true, now(), auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.banco_extrato_linhas SET situacao = 'conciliada', movimento_id = v_id WHERE id = l.id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.banco_extrato_lancar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_extrato_lancar(uuid, text) TO authenticated;

-- Ignorar (ex.: lançamento que não é da empresa) e voltar atrás.
CREATE OR REPLACE FUNCTION public.banco_extrato_ignorar(p_linha_id uuid, p_ignorar boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  UPDATE public.banco_extrato_linhas
     SET situacao = CASE WHEN p_ignorar THEN 'ignorada' ELSE 'pendente' END
   WHERE id = p_linha_id AND tenant_id = public.current_tenant_id()
     AND situacao = CASE WHEN p_ignorar THEN 'pendente' ELSE 'ignorada' END;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Lançamento do extrato não encontrado ou já tratado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.banco_extrato_ignorar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_extrato_ignorar(uuid, boolean) TO authenticated;
