-- Manufatura, Fase 1: perfil do encarregado da oficina (aponta produção e vê as ordens, sem custo). Fica em arquivo próprio porque um valor
-- novo de enum só pode ser usado depois de confirmado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'producao';
