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

-- As políticas de escrita direta em nfe e nfe_itens ficam como estão (administrador, gestor, financeiro): vendedor e
-- caixa emitem só pelas funções acima, que rodam como dono do banco, e o servidor grava o retorno da Sefaz com a
-- chave de serviço. Assim eles não reescrevem totais, CFOP ou dados do emitente de uma nota já autorizada.
