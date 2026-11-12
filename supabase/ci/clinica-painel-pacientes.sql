-- Somente leituras; todas as configurações de sessão são locais à transação.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE fonte text := pg_get_functiondef('public.clinica_painel_pacientes(date,date,text,integer)'::regprocedure);
BEGIN
  IF has_function_privilege('anon','public.clinica_painel_pacientes(date,date,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Visitante não pode consultar os pacientes da gestão';
  END IF;
  IF NOT has_function_privilege('authenticated','public.clinica_painel_pacientes(date,date,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'A função precisa estar disponível para usuários autenticados';
  END IF;
  IF fonte NOT LIKE '%exige_papel(ARRAY[''administrador'',''gestor''])%' THEN
    RAISE EXCEPTION 'A consulta deve exigir administrador ou gestor';
  END IF;
END $$;
-- Sem sessão, a execução deve falhar mesmo com o papel authenticated.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$
DECLARE recusado boolean := false;
BEGIN
  BEGIN PERFORM public.clinica_painel_pacientes('2026-11-01','2026-11-30');
  EXCEPTION WHEN OTHERS THEN recusado := true; END;
  IF NOT recusado THEN RAISE EXCEPTION 'Uma sessão ausente não pode ler pacientes'; END IF;
END $$;
RESET ROLE;
-- Usa uma gestão existente somente para leitura; nenhum dado da empresa é modificado.
DO $$
DECLARE u uuid; t uuid; resultado jsonb; p jsonb; a jsonb; e jsonb;
BEGIN
  SELECT pr.id,pr.tenant_id INTO u,t FROM public.profiles pr
  WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=pr.id AND r.role IN ('administrador','gestor'))
    AND EXISTS(SELECT 1 FROM public.pet_atendimentos_clinicos a WHERE a.tenant_id=pr.tenant_id)
    AND EXISTS(SELECT 1 FROM public.empresas em WHERE em.tenant_id=pr.tenant_id AND (em.ramo_atividade IN ('clinica','petshop') OR EXISTS(SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id=em.id AND m.modulo='clinica')))
  ORDER BY pr.id LIMIT 1;
  IF u IS NULL THEN RAISE NOTICE 'Sem gestão com pacientes para prova de leitura'; RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  resultado := public.clinica_painel_pacientes('2026-01-01','2026-12-31');
  EXECUTE 'RESET ROLE';
  IF (resultado->>'total')::integer=0 THEN RAISE EXCEPTION 'Esperava pacientes reais no período'; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(resultado->'pacientes') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.pets WHERE id=(p->>'id')::uuid AND tenant_id=t) THEN RAISE EXCEPTION 'Paciente de outra empresa'; END IF;
    FOR a IN SELECT value FROM jsonb_array_elements(p->'visitas') LOOP
      IF NOT EXISTS(SELECT 1 FROM public.pet_atendimentos_clinicos WHERE id=(a->>'id')::uuid AND tenant_id=t AND pet_id=(p->>'id')::uuid) THEN RAISE EXCEPTION 'Visita de outro paciente ou empresa'; END IF;
      IF a - ARRAY['id','data','situacao','veterinario'] <> '{}'::jsonb THEN RAISE EXCEPTION 'A gestão não recebe texto clínico'; END IF;
    END LOOP;
    FOR e IN SELECT value FROM jsonb_array_elements(p->'exames') LOOP
      IF e - ARRAY['id','nome','data','situacao','origem','veterinario'] <> '{}'::jsonb THEN RAISE EXCEPTION 'A gestão não recebe resultados de exames'; END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Leitura autenticada, isolamento e ausência de texto clínico conferidos';
END $$;
ROLLBACK;