-- Backup por cliente (fase 3): rotina noturna que grava um arquivo por cliente em armazenamento PRIVADO e o registro de cada execução.
-- Regras:
--   * o bucket é privado e NÃO tem política para authenticated nem anon: só o serviço (rotina da equipe) lê e grava;
--   * backup_execucoes é só do serviço (sem acesso direto do app, nem do próprio cliente): é controle interno da Ze Tech;
--   * um backup concluído (ou em andamento) por cliente por dia: o índice único impede rodada duplicada ou concorrente.

-- ============ bucket privado ============
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('backups-clientes', 'backups-clientes', false, NULL, ARRAY['application/gzip'])
ON CONFLICT (id) DO UPDATE SET public = false, allowed_mime_types = ARRAY['application/gzip'];

-- ============ execuções ============
CREATE TABLE IF NOT EXISTS public.backup_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dia date NOT NULL,
  tipos text[] NOT NULL DEFAULT ARRAY['diario'] CHECK (tipos <@ ARRAY['diario', 'semanal', 'mensal'] AND cardinality(tipos) >= 1),
  situacao text NOT NULL DEFAULT 'em_andamento' CHECK (situacao IN ('em_andamento', 'concluido', 'erro', 'expirado')),
  caminho text,
  tamanho bigint CHECK (tamanho IS NULL OR tamanho >= 0),
  tabelas integer CHECK (tabelas IS NULL OR tabelas >= 0),
  linhas bigint CHECK (linhas IS NULL OR linhas >= 0),
  erro text,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  expirado_em timestamptz,
  CHECK ((situacao = 'concluido') = (concluido_em IS NOT NULL)),
  CHECK (situacao <> 'concluido' OR (caminho IS NOT NULL AND tamanho IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS backup_execucoes_um_por_dia
  ON public.backup_execucoes (tenant_id, dia) WHERE situacao IN ('em_andamento', 'concluido');
CREATE INDEX IF NOT EXISTS backup_execucoes_cliente_idx ON public.backup_execucoes (tenant_id, dia DESC);

ALTER TABLE public.backup_execucoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_execucoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.backup_execucoes TO service_role;
