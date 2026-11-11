-- Papel do contador (acesso externo, restrito a uma empresa). O valor novo do enum precisa de migration própria:
-- ele só pode ser usado depois do commit. As regras de acesso estão em 20270120000000_contador_acesso.sql.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'contador';
