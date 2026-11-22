-- wa_assistente_preferencias (migração 0134) ficou sem a política restritiva do contador que toda tabela com RLS tem.
-- Hoje a tabela só dá GRANT ao service_role e as funções de leitura e gravação já chamam exige_nao_contador, então não havia
-- acesso do contador; isto fecha também pelo RLS (defesa em profundidade) e devolve o smoke.sql ao verde.
CREATE POLICY contador_restrito ON public.wa_assistente_preferencias AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));
