-- Run only in an isolated PostgreSQL database: fixture auth helpers are not production auth.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE plpgsql STABLE AS
$$ BEGIN RETURN current_setting('test.user_id')::uuid; END $$;
CREATE FUNCTION public.current_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS
$$ BEGIN RETURN current_setting('test.tenant_id')::uuid; END $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE plpgsql STABLE AS
$$ BEGIN RETURN $1 = auth.uid() AND $2 = current_setting('test.role'); END $$;
CREATE FUNCTION public.eh_salao_restrito() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN RETURN false; END $$;
CREATE FUNCTION public.eh_contador_restrito() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN RETURN false; END $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated;
\ir ../drizzle/migrations/0140_campanha_modelos_aprovados.sql
INSERT INTO public.clinica_wa_campanha_modelos (id, tenant_id, titulo, texto, aprovado_por)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'Teste isolado', 'Mensagem de teste sem envio', '33333333-3333-3333-3333-333333333333');
SELECT set_config('test.user_id', '44444444-4444-4444-4444-444444444444', true);
SELECT set_config('test.tenant_id', '22222222-2222-2222-2222-222222222222', true);
SELECT set_config('test.role', 'gestor', true);
SET LOCAL ROLE authenticated;
-- Reproduce the original failure with a different approver.
DO $$ BEGIN
  BEGIN
    UPDATE public.clinica_wa_campanha_modelos SET ativo = false;
    RAISE EXCEPTION 'Original policy unexpectedly allowed another approver';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\ir ../drizzle/migrations/0141_campanha_modelos_desativacao_gestores.sql
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; papel text; original uuid; active_value boolean; BEGIN
  FOREACH papel IN ARRAY ARRAY['gestor', 'administrador'] LOOP
    PERFORM set_config('test.role', papel, true);
    UPDATE public.clinica_wa_campanha_modelos SET ativo = false
      WHERE id = '11111111-1111-1111-1111-111111111111';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION '% must deactivate another approver''s message', papel; END IF;
    SELECT aprovado_por, ativo INTO original, active_value FROM public.clinica_wa_campanha_modelos
      WHERE id = '11111111-1111-1111-1111-111111111111';
    IF original IS DISTINCT FROM '33333333-3333-3333-3333-333333333333'::uuid
      OR active_value IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Deactivation must persist and preserve original approver';
    END IF;
  END LOOP;
  PERFORM set_config('test.role', 'veterinario', true);
  UPDATE public.clinica_wa_campanha_modelos SET ativo = true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Veterinarian must not edit approved messages'; END IF;
  PERFORM set_config('test.role', 'administrador', true);
  BEGIN
    UPDATE public.clinica_wa_campanha_modelos SET tenant_id = '55555555-5555-5555-5555-555555555555';
    RAISE EXCEPTION 'Moving a message to another tenant must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('test.tenant_id', '55555555-5555-5555-5555-555555555555', true);
  UPDATE public.clinica_wa_campanha_modelos SET ativo = true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Administrator from another tenant must not edit messages'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: original failure reproduced; manager/admin deactivation, persistence, approver and tenant isolation verified.'