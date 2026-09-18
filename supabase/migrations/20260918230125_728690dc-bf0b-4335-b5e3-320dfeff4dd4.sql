ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS cor_primaria text NOT NULL DEFAULT '#008037';