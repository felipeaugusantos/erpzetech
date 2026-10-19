-- Pet shop, Fase 2 (PR 8): perfil do profissional (banhista, tosador, groomer). Fica em arquivo próprio porque um valor novo
-- de enum só pode ser usado depois de confirmado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'profissional';
