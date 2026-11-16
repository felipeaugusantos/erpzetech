-- O log de exclusão de exames e a fila de limpeza de arquivos (0092) não tinham a política restritiva do contador exigida pela CI
-- (smoke.sql: "toda tabela com RLS tem política restritiva do contador"). O contador nunca lê dado clínico: o log já só era lido
-- por administrador, gestor e veterinário, e a fila é só do serviço; esta política torna a regra explícita. Reaplicável.
DROP POLICY IF EXISTS contador_restrito ON public.clinica_exames_exclusoes;
CREATE POLICY contador_restrito ON public.clinica_exames_exclusoes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));
DROP POLICY IF EXISTS contador_restrito ON public.clinica_exames_limpeza;
CREATE POLICY contador_restrito ON public.clinica_exames_limpeza AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));

-- A exclusão de exame e o acesso ao log (0092) já exigiam o veterinário (_clinica_vet), mas não tinham a trava explícita do contador
-- (exige_nao_contador) que a CI cobra de toda função chamável. Acrescenta a trava logo no início do corpo, sem mudar o resto.
DO $$
DECLARE n text; d text;
BEGIN
  FOREACH n IN ARRAY ARRAY['clinica_exame_excluir', 'clinica_exame_exclusao_acesso'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname = n;
    IF d IS NULL THEN RAISE EXCEPTION 'Função % não encontrada', n; END IF;
    IF d NOT LIKE '%exige_nao_contador%' THEN
      d := regexp_replace(d, E'BEGIN\n', E'BEGIN\n PERFORM public.exige_nao_contador();\n');
      EXECUTE d;
    END IF;
  END LOOP;
END $$;
