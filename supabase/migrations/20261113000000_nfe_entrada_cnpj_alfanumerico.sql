-- CNPJ alfanumérico (NT 2026.004): a conferência de fornecedor e transportadora na entrada de notas e no CT-e
-- comparava só os números do CNPJ. Dois CNPJs diferentes que só mudam nas letras viravam o "mesmo" fornecedor.
-- Passa a comparar letras e números, em maiúsculas.
DO $$
DECLARE
  def text;
  novo text;
  v record;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('public.importar_nfe_entrada(jsonb, jsonb, jsonb, uuid, boolean, integer, date)'),
      ('public.nfe_entrada_ja_importada(text, text, text, text)'),
      ('public.nfe_entrada_vincular_cte(uuid, jsonb, date)')
    ) AS t(assinatura)
  LOOP
    def := pg_get_functiondef(v.assinatura::regprocedure);
    novo := def;
    novo := replace(novo, $a$regexp_replace(coalesce(p_fornecedor->>'cnpj',''), '\D', '', 'g')$a$,
                          $b$upper(regexp_replace(coalesce(p_fornecedor->>'cnpj',''), '[^0-9A-Za-z]', '', 'g'))$b$);
    novo := replace(novo, $a$regexp_replace(coalesce(cnpj,''), '\D', '', 'g')$a$,
                          $b$upper(regexp_replace(coalesce(cnpj,''), '[^0-9A-Za-z]', '', 'g'))$b$);
    novo := replace(novo, $a$regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')$a$,
                          $b$upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g'))$b$);
    novo := replace(novo, $a$regexp_replace(coalesce(f.cnpj, ''), '\D', '', 'g')$a$,
                          $b$upper(regexp_replace(coalesce(f.cnpj, ''), '[^0-9A-Za-z]', '', 'g'))$b$);
    novo := replace(novo, $a$regexp_replace(coalesce(p_cte->>'chave',''), '\D', '', 'g')$a$,
                          $b$upper(regexp_replace(coalesce(p_cte->>'chave',''), '[^0-9A-Za-z]', '', 'g'))$b$);
    novo := replace(novo, $a$regexp_replace(coalesce(p_cte->>'cnpj',''), '\D', '', 'g')$a$,
                          $b$upper(regexp_replace(coalesce(p_cte->>'cnpj',''), '[^0-9A-Za-z]', '', 'g'))$b$);
    novo := replace(novo, $a$regexp_replace(k, '\D', '', 'g') = c.nfe_chave$a$,
                          $b$upper(regexp_replace(k, '[^0-9A-Za-z]', '', 'g')) = c.nfe_chave$b$);
    IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar a comparação de CNPJ em %', v.assinatura; END IF;
    EXECUTE novo;
  END LOOP;
END $$;
