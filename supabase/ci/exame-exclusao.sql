-- Real behavior, all temporary exam fixtures rolled back; never deletes a saved clinical exam.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; v uuid; t uuid; pet uuid; modelo uuid; ex uuid; outro uuid; r jsonb; log uuid; recusado boolean; n integer;
BEGIN
 SELECT p.profile_id,p.id,p.tenant_id INTO u,v,t FROM public.pet_profissionais p
 WHERE p.ativo AND p.funcao='veterinario' AND p.crmv IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.profile_id AND r.tenant_id=p.tenant_id AND r.role='veterinario')
 AND EXISTS(SELECT 1 FROM public.pet_exame_modelos m WHERE m.tenant_id=p.tenant_id AND m.ativo)
 AND EXISTS(SELECT 1 FROM public.pets a WHERE a.tenant_id=p.tenant_id) LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'Need veterinarian fixtures before exclusion test'; END IF;
 SELECT id INTO pet FROM public.pets WHERE tenant_id=t LIMIT 1;
 SELECT id INTO modelo FROM public.pet_exame_modelos WHERE tenant_id=t AND ativo LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r := public.clinica_exame_abrir(pet,modelo,'{"laboratorio":"Teste exclusão CI"}');
 ex := (r->>'id')::uuid;
 outro := (public.clinica_exame_abrir(pet,modelo,'{"laboratorio":"Exame preservado CI"}')->>'id')::uuid;
 recusado := false;
 BEGIN PERFORM public.clinica_exame_excluir(ex,' ',true); EXCEPTION WHEN OTHERS THEN recusado:=true; END;
 IF NOT recusado THEN RAISE EXCEPTION 'Exclusion accepted empty reason'; END IF;
 recusado := false;
 BEGIN PERFORM public.clinica_exame_excluir(ex,'Teste',false); EXCEPTION WHEN OTHERS THEN recusado:=true; END;
 IF NOT recusado THEN RAISE EXCEPTION 'Exclusion accepted absent confirmation'; END IF;
 -- Delete direct is still forbidden even when a browser attempts to forge a flag.
 PERFORM set_config('app.exame_excluir',ex::text,true);
 recusado := false;
 BEGIN DELETE FROM public.pet_exames WHERE id=ex; EXCEPTION WHEN OTHERS THEN recusado:=true; END;
 IF NOT recusado THEN RAISE EXCEPTION 'Direct DELETE allowed'; END IF;
 r := public.clinica_exame_excluir(ex,'Registro de teste removido',true);
 log := (r->>'exclusao_id')::uuid;
 IF public.clinica_exame_excluir(ex,'Registro de teste removido',true)->>'exclusao_id' <> log::text THEN RAISE EXCEPTION 'Retry duplicated exclusion'; END IF;
 recusado := false;
 BEGIN UPDATE public.clinica_exames_exclusoes SET motivo='alterado' WHERE id=log; EXCEPTION WHEN OTHERS THEN recusado:=true; END;
 IF NOT recusado THEN RAISE EXCEPTION 'Log editable'; END IF;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.pet_exames WHERE id=ex) OR EXISTS(SELECT 1 FROM public.pet_exame_resultados WHERE exame_id=ex) THEN RAISE EXCEPTION 'Exam or results not physically deleted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pet_exames WHERE id=outro) THEN RAISE EXCEPTION 'Sibling exam removed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clinica_exames_exclusoes WHERE id=log AND usuario_id=u AND veterinario_id=v AND motivo='Registro de teste removido' AND excluido_em IS NOT NULL) THEN RAISE EXCEPTION 'Log missing actor/time/reason'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.auditoria WHERE entidade_id=ex AND operacao='DELETE') THEN RAISE EXCEPTION 'Audit missing'; END IF;
 IF has_function_privilege('anon','public.clinica_exame_excluir(uuid,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous exclusion allowed'; END IF;
 RAISE NOTICE 'Exclusion removes exam/results, keeps immutable log, preserves sibling and refuses unconfirmed operation';
END $$;
ROLLBACK;