CREATE OR REPLACE FUNCTION public._clinica_documento_guarda()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.clinica_documento_excluir', true) = OLD.id::text THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Documento emitido só é excluído pelo botão Excluir do prontuário';
  END IF;
  IF OLD.situacao = 'cancelado' THEN RAISE EXCEPTION 'Documento cancelado não muda'; END IF;
  IF NEW.situacao <> 'cancelado'
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
     OR NEW.atendimento_id IS DISTINCT FROM OLD.atendimento_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id
     OR NEW.crmv IS DISTINCT FROM OLD.crmv OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.ano IS DISTINCT FROM OLD.ano OR NEW.numero IS DISTINCT FROM OLD.numero OR NEW.titulo IS DISTINCT FROM OLD.titulo
     OR NEW.corpo IS DISTINCT FROM OLD.corpo OR NEW.itens IS DISTINCT FROM OLD.itens OR NEW.emitido_em IS DISTINCT FROM OLD.emitido_em
  THEN RAISE EXCEPTION 'Documento emitido não pode ser alterado: cancele e emita outro'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.clinica_documento_excluir(p_id uuid, p_motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  d public.pet_documentos%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_contador();
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Informe o motivo da exclusão (pelo menos 5 caracteres)'; END IF;
  IF length(v_motivo) > 300 THEN RAISE EXCEPTION 'O motivo aceita até 300 caracteres'; END IF;
  SELECT * INTO d FROM public.pet_documentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado'; END IF;
  IF d.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário que emitiu exclui o documento'; END IF;
  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (d.tenant_id, auth.uid(), 'pet_documentos', d.id, 'excluir', to_jsonb(d), jsonb_build_object('motivo', v_motivo));
  PERFORM set_config('app.clinica_documento_excluir', d.id::text, true);
  DELETE FROM public.pet_documentos WHERE id = d.id;
  PERFORM set_config('app.clinica_documento_excluir', '', true);
END $function$;

REVOKE ALL ON FUNCTION public.clinica_documento_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_documento_excluir(uuid, text) TO authenticated;