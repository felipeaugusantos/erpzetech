alter table public.nfe
  add column if not exists provider text,
  add column if not exists provider_id text,
  add column if not exists provider_status text,
  add column if not exists retorno jsonb,
  add column if not exists transmitida_em timestamptz,
  add column if not exists autorizada_em timestamptz;

alter table public.empresas
  add column if not exists codigo_municipio text;

alter table public.clientes
  add column if not exists codigo_municipio text;

alter table public.fiscal_config
  add column if not exists conta_emissor text,
  add column if not exists responsavel_tecnico_cnpj text,
  add column if not exists responsavel_tecnico_contato text,
  add column if not exists responsavel_tecnico_email text,
  add column if not exists responsavel_tecnico_fone text;

create index if not exists nfe_provider_id_idx on public.nfe (provider_id);