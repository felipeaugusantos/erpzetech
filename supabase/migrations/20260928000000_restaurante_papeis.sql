-- Restaurante (Rodada 6, etapa R1): perfis do salão.
-- Fica em arquivo próprio porque um valor novo de enum só pode ser usado depois de confirmado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'garcom';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cozinha';
