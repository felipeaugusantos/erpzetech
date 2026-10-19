-- Clínica (Fase 3, PR 1): perfil do veterinário. Fica em arquivo próprio porque um valor novo de enum só pode ser usado depois de confirmado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'veterinario';
