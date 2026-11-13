CREATE TABLE public.clinica_exames_exclusoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, exame_id uuid NOT NULL UNIQUE, pet_id uuid NOT NULL, nome text NOT NULL, data_coleta date, situacao text NOT NULL, usuario_id uuid NOT NULL, veterinario_id uuid NOT NULL, excluido_em timestamptz NOT NULL DEFAULT now(), motivo text NOT NULL, transacao text NOT NULL DEFAULT pg_current_xact_id()::text
);
GRANT SELECT ON public.clinica_exames_exclusoes TO authenticated;
GRANT ALL ON public.clinica_exames_exclusoes TO service_role;
ALTER TABLE public.clinica_exames_exclusoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY leitura_log ON public.clinica_exames_exclusoes FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() AND public.clinica_liberada() AND (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'veterinario')));
CREATE POLICY salao_restrito ON public.clinica_exames_exclusoes AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
CREATE TRIGGER log_imutavel BEFORE UPDATE OR DELETE ON public.clinica_exames_exclusoes FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_adendo_guarda();
CREATE TABLE public.clinica_exames_limpeza (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exclusao_id uuid NOT NULL REFERENCES public.clinica_exames_exclusoes(id), tenant_id uuid NOT NULL, caminho text NOT NULL UNIQUE, concluido_em timestamptz, tentativas integer NOT NULL DEFAULT 0, erro text
);
GRANT ALL ON public.clinica_exames_limpeza TO service_role;
ALTER TABLE public.clinica_exames_limpeza ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.clinica_exames_limpeza AS RESTRICTIVE FOR ALL TO authenticated USING (false);
CREATE FUNCTION public._clinica_exclusao_autorizada(p_exame uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO public AS $$
 SELECT EXISTS(SELECT 1 FROM public.clinica_exames_exclusoes l WHERE l.exame_id=p_exame AND l.transacao=pg_current_xact_id()::text AND l.usuario_id=auth.uid() AND l.tenant_id=public.current_tenant_id());
$$;
REVOKE ALL ON FUNCTION public._clinica_exclusao_autorizada(uuid) FROM PUBLIC,anon,authenticated;
-- Preserve every existing UPDATE/INSERT guard; only add a transaction-bound DELETE exception.
DO $$ DECLARE n text; d text; expr text; BEGIN
 FOREACH n IN ARRAY ARRAY['_clinica_exame_guarda','_clinica_exame_resultado_guarda','_clinica_exame_adendo_guarda','_clinica_anexo_guarda'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname=n AND p.pronargs=0;
  expr := CASE WHEN n='_clinica_exame_guarda' THEN 'OLD.id' ELSE 'OLD.exame_id' END;
  d := replace(d, E'BEGIN\n', E'BEGIN\n  IF TG_OP = ''DELETE'' AND public._clinica_exclusao_autorizada(' || expr || E') THEN RETURN OLD; END IF;\n');
  -- Trigger invoker is the SECURITY DEFINER deletion function, never the browser role.
  EXECUTE d;
 END LOOP;
END $$;
CREATE FUNCTION public.clinica_exame_excluir(p_id uuid,p_motivo text,p_confirmado boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_vet uuid := public._clinica_vet(); e public.pet_exames%ROWTYPE; v_log uuid; v_motivo text := btrim(coalesce(p_motivo,''));
BEGIN
 IF p_confirmado IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirme a exclusão definitiva'; END IF;
 IF length(v_motivo) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Informe o motivo com até 500 caracteres'; END IF;
 SELECT * INTO e FROM public.pet_exames WHERE id=p_id AND tenant_id=public.current_tenant_id() FOR UPDATE;
 IF NOT FOUND THEN
  SELECT id INTO v_log FROM public.clinica_exames_exclusoes WHERE exame_id=p_id AND tenant_id=public.current_tenant_id() AND veterinario_id=v_vet AND usuario_id=auth.uid();
  IF v_log IS NOT NULL THEN RETURN jsonb_build_object('exclusao_id',v_log,'exame_id',p_id); END IF;
  RAISE EXCEPTION 'Exame não encontrado';
 END IF;
 IF e.veterinario_id IS DISTINCT FROM v_vet THEN RAISE EXCEPTION 'Só o veterinário responsável pode excluir este exame'; END IF;
 INSERT INTO public.clinica_exames_exclusoes(tenant_id,exame_id,pet_id,nome,data_coleta,situacao,usuario_id,veterinario_id,motivo) VALUES(e.tenant_id,e.id,e.pet_id,e.nome,e.data_coleta,e.situacao,auth.uid(),v_vet,v_motivo) RETURNING id INTO v_log;
 INSERT INTO public.clinica_exames_limpeza(exclusao_id,tenant_id,caminho) SELECT v_log,e.tenant_id,a.caminho FROM public.pet_exame_anexos a WHERE a.exame_id=e.id;
 UPDATE public.portal_liberacoes SET retirado_em=now(),retirado_por=v_vet WHERE tipo='exame' AND ref_id=e.id AND tenant_id=e.tenant_id AND retirado_em IS NULL;
 UPDATE public.clinica_acessos SET anexo_id=NULL WHERE anexo_id IN(SELECT id FROM public.pet_exame_anexos WHERE exame_id=e.id);
 DELETE FROM public.pet_exame_anexos WHERE exame_id=e.id;
 DELETE FROM public.pet_exame_adendos WHERE exame_id=e.id;
 -- One statement removes both calculated and base results, satisfying self-references at statement end.
 DELETE FROM public.pet_exame_resultados WHERE exame_id=e.id;
 DELETE FROM public.pet_exames WHERE id=e.id AND tenant_id=e.tenant_id;
 INSERT INTO public.auditoria(tenant_id,usuario_id,entidade,entidade_id,operacao,valor_anterior,valor_novo) VALUES(e.tenant_id,auth.uid(),'pet_exames',e.id,'DELETE',jsonb_build_object('nome',e.nome,'pet_id',e.pet_id,'data_coleta',e.data_coleta,'situacao',e.situacao),jsonb_build_object('motivo',v_motivo,'exclusao_id',v_log,'veterinario_id',v_vet));
 RETURN jsonb_build_object('exclusao_id',v_log,'exame_id',e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_excluir(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_excluir(uuid,text,boolean) TO authenticated;
CREATE FUNCTION public.clinica_exame_exclusao_acesso(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v uuid := public._clinica_vet(); t uuid;
BEGIN
 SELECT tenant_id INTO t FROM public.clinica_exames_exclusoes WHERE id=p_id AND tenant_id=public.current_tenant_id() AND veterinario_id=v AND usuario_id=auth.uid();
 IF t IS NULL THEN RAISE EXCEPTION 'Exclusão não encontrada'; END IF;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_exclusao_acesso(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_exclusao_acesso(uuid) TO authenticated;