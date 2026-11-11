-- Contador: aplica de novo as travas (política restritiva em toda tabela com RLS e trava em toda função chamável)
-- porque as tabelas e funções do drizzle são criadas depois de supabase/migrations/20270120000000_contador_acesso.sql.
-- Reaplicável sem efeito colateral.
SELECT public._contador_travas_tabelas();
SELECT public._contador_travas_funcoes();
