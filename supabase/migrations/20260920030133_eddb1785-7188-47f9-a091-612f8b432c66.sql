alter table public.locacao_equipamentos
  add column if not exists quantidade integer not null default 1;