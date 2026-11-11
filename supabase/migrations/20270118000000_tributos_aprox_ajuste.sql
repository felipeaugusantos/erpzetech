-- Ajuste do cliente sobre os tributos aproximados (Lei 12.741/2012).
-- A tabela da IBPT (tributos_aprox_ncm) NÃO muda: importar o CSV de novo ou consultar a API só mexe nela e nunca
-- apaga um ajuste. O ajuste fica em tabela própria, por empresa e por NCM, com validade explícita, motivo e quem fez.
-- Regras:
--   * só administrador, gestor ou financeiro ajusta ou remove; leitura só da própria empresa;
--   * o ajuste precisa de um NCM que já tenha linha da IBPT na empresa (a origem continua rastreável) e de uma data
--     de validade (hoje ou depois); vencido, a nota volta a usar a tabela da IBPT, sem aviso silencioso na tela;
--   * um ajuste ativo por NCM: ajustar de novo encerra o anterior (o histórico fica, nada se apaga);
--   * cada ajuste e cada remoção entra na auditoria.
-- O valor ajustado não é da IBPT: a emissão passa a dizer isso no texto da nota.

CREATE TABLE IF NOT EXISTS public.tributos_aprox_ajuste (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ncm text NOT NULL CHECK (ncm ~ '^[0-9]{8}$'),
  aliq_nacional_federal numeric(6,2) NOT NULL CHECK (aliq_nacional_federal BETWEEN 0 AND 100),
  aliq_importado_federal numeric(6,2) NOT NULL CHECK (aliq_importado_federal BETWEEN 0 AND 100),
  aliq_estadual numeric(6,2) NOT NULL CHECK (aliq_estadual BETWEEN 0 AND 100),
  aliq_municipal numeric(6,2) NOT NULL CHECK (aliq_municipal BETWEEN 0 AND 100),
  valido_ate date NOT NULL,
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 5 AND 500),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz,
  removido_por uuid
);

-- no máximo um ajuste ativo (não removido) por NCM
CREATE UNIQUE INDEX IF NOT EXISTS tributos_aprox_ajuste_ativo
  ON public.tributos_aprox_ajuste (tenant_id, ncm) WHERE removido_em IS NULL;

ALTER TABLE public.tributos_aprox_ajuste ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tributos_aprox_ajuste FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tributos_aprox_ajuste TO authenticated;
GRANT ALL ON public.tributos_aprox_ajuste TO service_role;
DROP POLICY IF EXISTS tributos_aprox_ajuste_leitura ON public.tributos_aprox_ajuste;
CREATE POLICY tributos_aprox_ajuste_leitura ON public.tributos_aprox_ajuste FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS salao_restrito ON public.tributos_aprox_ajuste;
CREATE POLICY salao_restrito ON public.tributos_aprox_ajuste AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.tributos_aprox_ajustar(
  p_ncm text, p_nacional_federal numeric, p_importado_federal numeric, p_estadual numeric, p_municipal numeric,
  p_valido_ate date, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ncm text := regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g');
  v_id uuid;
  v_anterior jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Somente administrador, gestor ou financeiro ajusta os tributos aproximados';
  END IF;
  IF v_ncm !~ '^[0-9]{8}$' THEN RAISE EXCEPTION 'NCM inválido: informe 8 dígitos'; END IF;
  IF p_nacional_federal IS NULL OR p_importado_federal IS NULL OR p_estadual IS NULL OR p_municipal IS NULL
     OR LEAST(p_nacional_federal, p_importado_federal, p_estadual, p_municipal) < 0
     OR GREATEST(p_nacional_federal, p_importado_federal, p_estadual, p_municipal) > 100 THEN
    RAISE EXCEPTION 'Cada alíquota deve ficar entre 0 e 100';
  END IF;
  IF p_valido_ate IS NULL OR p_valido_ate < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Informe a validade do ajuste (hoje ou uma data futura)';
  END IF;
  IF char_length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do ajuste (por exemplo, a orientação do contador)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tributos_aprox_ncm WHERE tenant_id = v_tenant AND ncm = v_ncm) THEN
    RAISE EXCEPTION 'Este NCM ainda não tem alíquota da IBPT na empresa: importe a tabela antes de ajustar';
  END IF;

  -- encerra o ajuste ativo do mesmo NCM (o histórico fica) e guarda o antes na auditoria
  SELECT to_jsonb(a) - 'tenant_id' INTO v_anterior FROM public.tributos_aprox_ajuste a
   WHERE a.tenant_id = v_tenant AND a.ncm = v_ncm AND a.removido_em IS NULL;
  UPDATE public.tributos_aprox_ajuste SET removido_em = now(), removido_por = auth.uid()
   WHERE tenant_id = v_tenant AND ncm = v_ncm AND removido_em IS NULL;

  INSERT INTO public.tributos_aprox_ajuste (tenant_id, ncm, aliq_nacional_federal, aliq_importado_federal,
    aliq_estadual, aliq_municipal, valido_ate, motivo, criado_por)
  VALUES (v_tenant, v_ncm, round(p_nacional_federal, 2), round(p_importado_federal, 2), round(p_estadual, 2),
          round(p_municipal, 2), p_valido_ate, btrim(p_motivo), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (v_tenant, auth.uid(), 'tributos_aprox_ajuste', v_id, CASE WHEN v_anterior IS NULL THEN 'insert' ELSE 'update' END,
          v_anterior,
          jsonb_build_object('ncm', v_ncm, 'aliq_nacional_federal', round(p_nacional_federal, 2),
            'aliq_importado_federal', round(p_importado_federal, 2), 'aliq_estadual', round(p_estadual, 2),
            'aliq_municipal', round(p_municipal, 2), 'valido_ate', p_valido_ate, 'motivo', btrim(p_motivo)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.tributos_aprox_ajuste_remover(p_ncm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ncm text := regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g');
  v_row public.tributos_aprox_ajuste;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Somente administrador, gestor ou financeiro remove um ajuste dos tributos aproximados';
  END IF;
  UPDATE public.tributos_aprox_ajuste SET removido_em = now(), removido_por = auth.uid()
   WHERE tenant_id = v_tenant AND ncm = v_ncm AND removido_em IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior)
  VALUES (v_tenant, auth.uid(), 'tributos_aprox_ajuste', v_row.id, 'delete',
          jsonb_build_object('ncm', v_row.ncm, 'aliq_nacional_federal', v_row.aliq_nacional_federal,
            'aliq_importado_federal', v_row.aliq_importado_federal, 'aliq_estadual', v_row.aliq_estadual,
            'aliq_municipal', v_row.aliq_municipal, 'valido_ate', v_row.valido_ate, 'motivo', v_row.motivo));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.tributos_aprox_ajustar(text, numeric, numeric, numeric, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tributos_aprox_ajustar(text, numeric, numeric, numeric, numeric, date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.tributos_aprox_ajuste_remover(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tributos_aprox_ajuste_remover(text) TO authenticated;
