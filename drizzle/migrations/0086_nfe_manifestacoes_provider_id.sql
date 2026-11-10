-- nfe_manifestacoes: guarda o id do evento no emissor fiscal para conferir manifestações pendentes.
-- A 0085 ganhou esta coluna depois de já ter sido aplicada em um banco; CREATE TABLE IF NOT EXISTS não altera
-- tabela existente, então a coluna entra aqui (sem efeito onde a 0085 já a criou).
ALTER TABLE public.nfe_manifestacoes ADD COLUMN IF NOT EXISTS provider_id text;
