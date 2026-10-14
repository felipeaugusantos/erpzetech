-- Vendedor e caixa também emitem a nota fiscal do balcão (decisão do dono sobre a tabela de papéis da Fase 0).
-- Cancelar nota continua só administrador e gestor (no servidor).
DO $$
DECLARE
  sig text;
  def text;
  novo text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.gerar_nfe(uuid, text)',
    'public.gerar_nfe_agrupada(uuid[], text)',
    'public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean)'
  ] LOOP
    def := pg_get_functiondef(sig::regprocedure);
    -- a função ampliada tem a lista escrita de um dos dois jeitos (injetada com espaços, ou do invólucro sem espaços)
    novo := replace(replace(def,
      $q$'gestor', 'financeiro']::text[]$q$, $q$'gestor', 'financeiro', 'vendedor', 'caixa']::text[]$q$),
      $q$'gestor','financeiro']$q$, $q$'gestor','financeiro','vendedor','caixa']$q$);
    IF novo = def THEN RAISE EXCEPTION 'Não foi possível ampliar o papel em %', sig; END IF;
    EXECUTE novo;
  END LOOP;
END $$;

DROP POLICY IF EXISTS nfe_insere_fiscal ON public.nfe;
DROP POLICY IF EXISTS nfe_altera_fiscal ON public.nfe;
CREATE POLICY nfe_insere_fiscal ON public.nfe FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'vendedor')
                   OR public.has_role(auth.uid(), 'caixa')));
CREATE POLICY nfe_altera_fiscal ON public.nfe FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'vendedor')
              OR public.has_role(auth.uid(), 'caixa')))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS nfe_itens_insere_fiscal ON public.nfe_itens;
DROP POLICY IF EXISTS nfe_itens_altera_fiscal ON public.nfe_itens;
CREATE POLICY nfe_itens_insere_fiscal ON public.nfe_itens FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                   OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'vendedor')
                   OR public.has_role(auth.uid(), 'caixa')));
CREATE POLICY nfe_itens_altera_fiscal ON public.nfe_itens FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
              OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'vendedor')
              OR public.has_role(auth.uid(), 'caixa')))
  WITH CHECK (tenant_id = public.current_tenant_id());
