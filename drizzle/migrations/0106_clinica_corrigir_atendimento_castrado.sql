-- Correção de atendimento fechado (com motivo e versão anterior guardada) e castração definida pelo veterinário na consulta.
-- A correção grava um adendo imutável com autor, CRMV, motivo e os valores antes/depois; a ficha original continua rastreável.

ALTER TABLE public.pet_atendimento_adendos ADD COLUMN IF NOT EXISTS anterior jsonb;
ALTER TABLE public.pet_atendimento_adendos ADD COLUMN IF NOT EXISTS correcao jsonb;
COMMENT ON COLUMN public.pet_atendimento_adendos.anterior IS 'Valores do atendimento antes da correção (só dos campos corrigidos).';
COMMENT ON COLUMN public.pet_atendimento_adendos.correcao IS 'Valores do atendimento depois da correção (só dos campos corrigidos).';

-- A trava continua: atendimento fechado só muda pela função de correção, que liga a marca local da transação.
CREATE OR REPLACE FUNCTION public._clinica_atendimento_guarda()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O prontuário não se apaga'; END IF;
  IF OLD.situacao = 'fechado' THEN
    IF coalesce(current_setting('app.clinica_correcao', true), '') <> OLD.id::text
       OR NEW.situacao IS DISTINCT FROM OLD.situacao OR NEW.fechado_em IS DISTINCT FROM OLD.fechado_em THEN
      RAISE EXCEPTION 'Atendimento fechado não pode ser alterado: registre um adendo';
    END IF;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
     OR NEW.agendamento_id IS DISTINCT FROM OLD.agendamento_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id
     OR NEW.crmv IS DISTINCT FROM OLD.crmv OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.aberto_em IS DISTINCT FROM OLD.aberto_em THEN
    RAISE EXCEPTION 'Estes dados do atendimento não mudam';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.clinica_atendimento_corrigir(p_id uuid, p_dados jsonb, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_atendimentos_clinicos%ROWTYPE;
  motivo text := btrim(coalesce(p_motivo, ''));
  k text; novo text; atual text;
  texto_keys constant text[] := ARRAY['queixa','anamnese','exame_fisico','diagnostico','conduta','observacoes'];
  rotulos constant jsonb := '{"queixa":"Queixa","anamnese":"Anamnese","exame_fisico":"Exame físico","diagnostico":"Diagnóstico","conduta":"Conduta","observacoes":"Observações","peso_kg":"Peso (kg)","temperatura_c":"Temperatura (°C)","freq_cardiaca":"Freq. cardíaca","freq_respiratoria":"Freq. respiratória","retorno_em":"Retorno sugerido"}';
  v_peso numeric; v_temp numeric; v_fc integer; v_fr integer; v_ret date;
  antes jsonb := '{}'::jsonb; depois jsonb := '{}'::jsonb; resumo text := '';
BEGIN
 PERFORM public.exige_nao_contador();
 SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
 IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário responsável corrige o atendimento'; END IF;
 IF a.situacao <> 'fechado' THEN RAISE EXCEPTION 'Atendimento aberto: edite direto, sem correção'; END IF;
 IF motivo = '' THEN RAISE EXCEPTION 'Informe o motivo da correção'; END IF;
 IF length(motivo) > 2000 THEN RAISE EXCEPTION 'O motivo aceita até 2000 caracteres'; END IF;
 IF EXISTS (SELECT 1 FROM unnest(texto_keys) t WHERE length(coalesce(p_dados ->> t, '')) > 8000) THEN
   RAISE EXCEPTION 'Cada campo de texto aceita até 8000 caracteres';
 END IF;
 BEGIN
   IF p_dados ? 'peso_kg' THEN v_peso := nullif(replace(btrim(coalesce(p_dados ->> 'peso_kg', '')), ',', '.'), '')::numeric; END IF;
   IF p_dados ? 'temperatura_c' THEN v_temp := nullif(replace(btrim(coalesce(p_dados ->> 'temperatura_c', '')), ',', '.'), '')::numeric; END IF;
   IF p_dados ? 'freq_cardiaca' THEN v_fc := nullif(btrim(coalesce(p_dados ->> 'freq_cardiaca', '')), '')::integer; END IF;
   IF p_dados ? 'freq_respiratoria' THEN v_fr := nullif(btrim(coalesce(p_dados ->> 'freq_respiratoria', '')), '')::integer; END IF;
   IF p_dados ? 'retorno_em' THEN v_ret := nullif(btrim(coalesce(p_dados ->> 'retorno_em', '')), '')::date; END IF;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'Confira os números e a data do retorno';
 END;
 IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso > 200) THEN RAISE EXCEPTION 'Peso fora do esperado (até 200 kg)'; END IF;
 IF v_temp IS NOT NULL AND (v_temp < 30 OR v_temp > 45) THEN RAISE EXCEPTION 'Temperatura fora do esperado (30 a 45 °C)'; END IF;
 IF v_fc IS NOT NULL AND (v_fc < 10 OR v_fc > 400) THEN RAISE EXCEPTION 'Frequência cardíaca fora do esperado'; END IF;
 IF v_fr IS NOT NULL AND (v_fr < 2 OR v_fr > 200) THEN RAISE EXCEPTION 'Frequência respiratória fora do esperado'; END IF;
 -- compara campo a campo com o que está gravado; só entra na correção o que mudou
 FOREACH k IN ARRAY (texto_keys || ARRAY['peso_kg','temperatura_c','freq_cardiaca','freq_respiratoria','retorno_em']) LOOP
   CONTINUE WHEN NOT (p_dados ? k);
   novo := CASE k WHEN 'peso_kg' THEN v_peso::text WHEN 'temperatura_c' THEN v_temp::text WHEN 'freq_cardiaca' THEN v_fc::text
                  WHEN 'freq_respiratoria' THEN v_fr::text WHEN 'retorno_em' THEN v_ret::text
                  ELSE nullif(btrim(coalesce(p_dados ->> k, '')), '') END;
   atual := to_jsonb(a) ->> k;
   CONTINUE WHEN novo IS NOT DISTINCT FROM atual
     OR (k IN ('peso_kg','temperatura_c') AND novo IS NOT NULL AND atual IS NOT NULL AND novo::numeric = atual::numeric);
   IF k IN ('queixa','conduta') AND novo IS NULL THEN RAISE EXCEPTION '% não pode ficar vazia', rotulos ->> k; END IF;
   antes := antes || jsonb_build_object(k, atual);
   depois := depois || jsonb_build_object(k, novo);
   resumo := resumo || CASE WHEN k = ANY(texto_keys) THEN format('%s alterada. ', rotulos ->> k)
                            ELSE format('%s: %s → %s. ', rotulos ->> k, coalesce(replace(atual, '.', ','), 'vazio'), coalesce(replace(novo, '.', ','), 'vazio')) END;
 END LOOP;
 IF depois = '{}'::jsonb THEN RAISE EXCEPTION 'Nenhuma informação foi alterada'; END IF;
 PERFORM set_config('app.clinica_correcao', a.id::text, true);
 UPDATE public.pet_atendimentos_clinicos SET
   queixa = CASE WHEN depois ? 'queixa' THEN depois ->> 'queixa' ELSE queixa END,
   anamnese = CASE WHEN depois ? 'anamnese' THEN depois ->> 'anamnese' ELSE anamnese END,
   exame_fisico = CASE WHEN depois ? 'exame_fisico' THEN depois ->> 'exame_fisico' ELSE exame_fisico END,
   diagnostico = CASE WHEN depois ? 'diagnostico' THEN depois ->> 'diagnostico' ELSE diagnostico END,
   conduta = CASE WHEN depois ? 'conduta' THEN depois ->> 'conduta' ELSE conduta END,
   observacoes = CASE WHEN depois ? 'observacoes' THEN depois ->> 'observacoes' ELSE observacoes END,
   peso_kg = CASE WHEN depois ? 'peso_kg' THEN v_peso ELSE peso_kg END,
   temperatura_c = CASE WHEN depois ? 'temperatura_c' THEN v_temp ELSE temperatura_c END,
   freq_cardiaca = CASE WHEN depois ? 'freq_cardiaca' THEN v_fc ELSE freq_cardiaca END,
   freq_respiratoria = CASE WHEN depois ? 'freq_respiratoria' THEN v_fr ELSE freq_respiratoria END,
   retorno_em = CASE WHEN depois ? 'retorno_em' THEN v_ret ELSE retorno_em END
  WHERE id = a.id AND tenant_id = a.tenant_id;
 PERFORM set_config('app.clinica_correcao', '', true);
 INSERT INTO public.pet_atendimento_adendos(tenant_id, atendimento_id, veterinario_id, crmv, crmv_uf, texto, anterior, correcao)
 VALUES (a.tenant_id, a.id, v_vet, a.crmv, a.crmv_uf, left('Correção do atendimento. ' || resumo || 'Motivo: ' || motivo, 8000), antes, depois);
 RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_corrigir(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_corrigir(uuid, jsonb, text) TO authenticated;

-- Castração definida na consulta, só pelo veterinário responsável; a mudança fica na auditoria (quem, quando, antes e depois).
CREATE OR REPLACE FUNCTION public.clinica_pet_castrado_definir(p_atendimento_id uuid, p_castrado boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_vet uuid := public._clinica_vet(); a public.pet_atendimentos_clinicos%ROWTYPE;
BEGIN
 PERFORM public.exige_nao_contador();
 IF p_castrado IS NULL THEN RAISE EXCEPTION 'Informe se o animal é castrado'; END IF;
 SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_atendimento_id AND tenant_id = public.current_tenant_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
 IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário responsável altera a castração'; END IF;
 UPDATE public.pets SET castrado = p_castrado WHERE id = a.pet_id AND tenant_id = a.tenant_id;
 RETURN jsonb_build_object('pet_id', a.pet_id, 'castrado', p_castrado);
END $$;
REVOKE ALL ON FUNCTION public.clinica_pet_castrado_definir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_pet_castrado_definir(uuid, boolean) TO authenticated;

DROP TRIGGER IF EXISTS trg_auditar_pets_castrado ON public.pets;
CREATE TRIGGER trg_auditar_pets_castrado
  AFTER UPDATE ON public.pets
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('castrado');
