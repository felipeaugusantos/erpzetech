-- A tela da auditoria lista do mais recente para o mais antigo, por empresa, com filtro opcional por entidade.
-- A tabela só cresce (cada alteração auditada é uma linha), então os índices evitam que a tela fique mais lenta com o tempo.
CREATE INDEX IF NOT EXISTS auditoria_tenant_criado_idx ON public.auditoria (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_tenant_entidade_criado_idx ON public.auditoria (tenant_id, entidade, created_at DESC);
