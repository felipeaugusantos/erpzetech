-- Clínica (Fase 4, PR 5e): anexos sem internet. O arquivo fica cifrado no cofre do notebook e a operação da fila reserva o caminho aqui; o envio do
-- arquivo ao armazenamento e a confirmação seguem como no anexo normal. Reenviar a mesma operação não cria outra reserva: devolve a mesma
-- (anexo pendente), ou avisa que o anexo já está confirmado. A reserva de mais de 50 minutos sem envio é refeita, porque o armazenamento só
-- aceita o envio na primeira hora; a chave guarda sempre a reserva mais nova. Quando o anexo é de um exame aberto no notebook, a operação aponta
-- para a chave da abertura do exame (o id do exame nasce no banco).

-- p_dados: os de clinica_anexo_preparar (categoria, descricao, nome_arquivo, mime, tamanho) mais o alvo: atendimento_id (o id nascido no
-- notebook) ou exame_abrir_chave (a chave da operação que abriu o exame).
CREATE OR REPLACE FUNCTION public.clinica_anexo_offline_preparar(p_chave uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  o public.clinica_operacoes_offline%ROWTYPE;
  a public.pet_exame_anexos%ROWTYPE;
  v_abrir uuid;
  v_dados jsonb;
  r jsonb;
BEGIN
  PERFORM public._clinica_vet();
  v_tenant := public.current_tenant_id();
  IF p_chave IS NULL THEN RAISE EXCEPTION 'Operação sem chave de repetição'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_op_offline:' || p_chave::text, 0));

  SELECT * INTO o FROM public.clinica_operacoes_offline WHERE chave = p_chave;
  IF FOUND THEN
    IF o.tenant_id <> v_tenant OR o.profile_id <> auth.uid() OR o.tipo <> 'anexo_preparar' THEN RAISE EXCEPTION 'Chave de repetição já usada'; END IF;
    SELECT * INTO a FROM public.pet_exame_anexos WHERE id = (o.resultado ->> 'anexo_id')::uuid AND tenant_id = v_tenant;
    IF FOUND AND (a.situacao <> 'pendente' OR a.created_at > now() - interval '50 minutes') THEN
      RETURN jsonb_build_object('anexo_id', a.id, 'caminho', a.caminho, 'mime', a.mime, 'situacao', a.situacao, 'repetido', true);
    END IF;
    -- reserva antiga: se o arquivo já chegou ao armazenamento (a confirmação é que se perdeu), a mesma reserva continua valendo e o
    -- envio seguinte só confirma; refazer deixaria o arquivo antigo e a reserva pendente órfãos (nenhum dos dois pode ser apagado)
    IF FOUND AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'clinica-anexos' AND name = a.caminho) THEN
      RETURN jsonb_build_object('anexo_id', a.id, 'caminho', a.caminho, 'mime', a.mime, 'situacao', a.situacao, 'repetido', true);
    END IF;
    -- reserva antiga sem o arquivo enviado: o envio não vale mais, reserva de novo
  END IF;

  v_dados := p_dados - 'exame_abrir_chave';
  IF p_dados ? 'exame_abrir_chave' THEN
    BEGIN
      v_abrir := (p_dados ->> 'exame_abrir_chave')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Operação de abertura do exame inválida';
    END;
    v_dados := v_dados || jsonb_build_object('exame_id', (public._clinica_op_resultado(v_abrir, 'exame_abrir')) ->> 'exame_id');
  END IF;
  r := public.clinica_anexo_preparar(v_dados);
  INSERT INTO public.clinica_operacoes_offline (chave, tenant_id, tipo, resultado)
  VALUES (p_chave, v_tenant, 'anexo_preparar', jsonb_build_object('anexo_id', r ->> 'id'))
  ON CONFLICT (chave) DO UPDATE SET resultado = EXCLUDED.resultado, created_at = now();
  RETURN jsonb_build_object('anexo_id', r ->> 'id', 'caminho', r ->> 'caminho', 'mime', r ->> 'mime', 'situacao', 'pendente', 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_offline_preparar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_offline_preparar(uuid, jsonb) TO authenticated;
