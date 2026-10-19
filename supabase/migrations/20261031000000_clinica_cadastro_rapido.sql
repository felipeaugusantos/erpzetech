-- Clínica (Fase 4, PR 5b): cadastro rápido de tutor e pet pelo veterinário, feito (também) sem internet. O veterinário é um perfil restrito e não
-- usa o cadastro de clientes e pets; esta função da clínica cria só o essencial (nome e telefone do tutor, e o pet — cão ou gato) com os
-- identificadores que nasceram no notebook, para o pet novo já receber atendimento antes de a fila sincronizar. A chave de repetição vem da
-- operação da fila: reenviar a mesma chave devolve o mesmo resultado e não duplica nada. Tutor com o mesmo telefone de um cadastro existente é
-- criado mesmo assim e marcado nas observações, para a recepção conferir e unir; nada é apagado nem alterado no cadastro que já existia.

CREATE TABLE IF NOT EXISTS public.clinica_cadastros_rapidos (
  chave uuid PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  criado_por uuid NOT NULL DEFAULT auth.uid(),
  possivel_duplicado_de uuid REFERENCES public.clientes(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinica_cadastros_rapidos_idx ON public.clinica_cadastros_rapidos (tenant_id, created_at DESC);

ALTER TABLE public.clinica_cadastros_rapidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinica_cadastros_rapidos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinica_cadastros_rapidos TO service_role;
CREATE POLICY salao_restrito ON public.clinica_cadastros_rapidos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- p_dados: cliente_id (tutor que já existe) OU cliente {id, nome, telefone} (tutor novo, com o id nascido no notebook);
-- pet {id, nome, especie (cao|gato), raca, sexo, porte, nascimento, peso_kg, castrado, alergias}.
CREATE OR REPLACE FUNCTION public.clinica_cadastro_rapido(p_chave uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_pet jsonb := p_dados -> 'pet';
  v_cli jsonb := p_dados -> 'cliente';
  v_cli_existente uuid;
  v_cli_id uuid;
  v_pet_id uuid;
  v_nome_tutor text;
  v_fone text;
  v_digitos text;
  v_dup_id uuid;
  v_dup_nome text;
  v_obs text;
  v_nome_pet text;
  v_especie text;
  v_peso numeric;
  v_nasc date;
  v_resultado jsonb;
BEGIN
  PERFORM public._clinica_vet();
  IF p_chave IS NULL THEN RAISE EXCEPTION 'Operação sem chave de repetição'; END IF;
  IF v_pet IS NULL OR jsonb_typeof(v_pet) <> 'object' THEN RAISE EXCEPTION 'Informe os dados do pet'; END IF;

  -- mesma chave: devolve o que já foi feito (reenvio da fila), sem criar nada
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_cadastro_rapido:' || p_chave::text, 0));
  SELECT jsonb_build_object('cliente_id', cliente_id, 'pet_id', pet_id, 'repetido', true,
                            'possivel_duplicado_de', possivel_duplicado_de)
    INTO v_resultado FROM public.clinica_cadastros_rapidos WHERE chave = p_chave AND tenant_id = v_tenant;
  IF v_resultado IS NOT NULL THEN RETURN v_resultado; END IF;
  IF EXISTS (SELECT 1 FROM public.clinica_cadastros_rapidos WHERE chave = p_chave) THEN RAISE EXCEPTION 'Chave de repetição já usada'; END IF;

  BEGIN
    v_cli_existente := nullif(btrim(coalesce(p_dados ->> 'cliente_id', '')), '')::uuid;
    v_cli_id := nullif(btrim(coalesce(v_cli ->> 'id', '')), '')::uuid;
    v_pet_id := nullif(btrim(coalesce(v_pet ->> 'id', '')), '')::uuid;
    v_peso := nullif(replace(btrim(coalesce(v_pet ->> 'peso_kg', '')), ',', '.'), '')::numeric;
    v_nasc := nullif(btrim(coalesce(v_pet ->> 'nascimento', '')), '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira os identificadores, o peso e a data de nascimento';
  END;

  -- pet
  v_nome_pet := btrim(coalesce(v_pet ->> 'nome', ''));
  v_especie := coalesce(nullif(v_pet ->> 'especie', ''), 'cao');
  IF v_pet_id IS NULL THEN RAISE EXCEPTION 'O pet precisa de um identificador'; END IF;
  IF v_nome_pet = '' OR length(v_nome_pet) > 80 THEN RAISE EXCEPTION 'Informe o nome do pet (até 80 letras)'; END IF;
  IF v_especie NOT IN ('cao', 'gato') THEN RAISE EXCEPTION 'Escolha cão ou gato'; END IF;
  IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso > 200) THEN RAISE EXCEPTION 'Peso fora do esperado (até 200 kg)'; END IF;
  IF v_nasc IS NOT NULL AND v_nasc > v_hoje THEN RAISE EXCEPTION 'O nascimento não pode ser no futuro'; END IF;
  IF nullif(v_pet ->> 'sexo', '') IS NOT NULL AND v_pet ->> 'sexo' NOT IN ('macho', 'femea') THEN RAISE EXCEPTION 'Sexo inválido'; END IF;
  IF nullif(v_pet ->> 'porte', '') IS NOT NULL AND v_pet ->> 'porte' NOT IN ('mini', 'pequeno', 'medio', 'grande', 'gigante') THEN RAISE EXCEPTION 'Porte inválido'; END IF;
  IF length(coalesce(v_pet ->> 'raca', '')) > 60 OR length(coalesce(v_pet ->> 'alergias', '')) > 1000 THEN RAISE EXCEPTION 'Raça ou alergias grande demais'; END IF;
  IF jsonb_typeof(v_pet -> 'castrado') IS NOT NULL AND jsonb_typeof(v_pet -> 'castrado') NOT IN ('boolean', 'null') THEN RAISE EXCEPTION 'Castrado precisa ser sim ou não'; END IF;
  IF EXISTS (SELECT 1 FROM public.pets WHERE id = v_pet_id) THEN RAISE EXCEPTION 'Identificador do pet já usado'; END IF;

  -- tutor: um que já existe, ou um novo
  IF v_cli_existente IS NOT NULL THEN
    IF v_cli IS NOT NULL AND jsonb_typeof(v_cli) = 'object' THEN RAISE EXCEPTION 'Informe o tutor que já existe ou um tutor novo, não os dois'; END IF;
    PERFORM 1 FROM public.clientes WHERE id = v_cli_existente AND tenant_id = v_tenant AND ativo AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tutor não encontrado'; END IF;
    v_cli_id := v_cli_existente;
  ELSE
    IF v_cli IS NULL OR jsonb_typeof(v_cli) <> 'object' THEN RAISE EXCEPTION 'Informe o tutor'; END IF;
    v_nome_tutor := btrim(coalesce(v_cli ->> 'nome', ''));
    v_fone := nullif(btrim(coalesce(v_cli ->> 'telefone', '')), '');
    IF v_cli_id IS NULL THEN RAISE EXCEPTION 'O tutor precisa de um identificador'; END IF;
    IF length(v_nome_tutor) < 2 OR length(v_nome_tutor) > 120 THEN RAISE EXCEPTION 'Informe o nome do tutor (de 2 a 120 letras)'; END IF;
    v_digitos := regexp_replace(coalesce(v_fone, ''), '\D', '', 'g');
    IF v_fone IS NOT NULL AND (length(v_digitos) < 10 OR length(v_digitos) > 13 OR length(v_fone) > 30) THEN
      RAISE EXCEPTION 'Telefone inválido: informe com DDD';
    END IF;
    IF EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cli_id) THEN RAISE EXCEPTION 'Identificador do tutor já usado'; END IF;
    -- o mesmo telefone em outro cadastro: cria assim mesmo e avisa a recepção (sem mexer no cadastro antigo)
    IF length(v_digitos) >= 10 THEN
      SELECT c.id, c.nome INTO v_dup_id, v_dup_nome FROM public.clientes c
       WHERE c.tenant_id = v_tenant AND c.ativo AND c.deleted_at IS NULL
         AND (regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = v_digitos OR regexp_replace(coalesce(c.whatsapp, ''), '\D', '', 'g') = v_digitos)
       ORDER BY c.created_at LIMIT 1;
    END IF;
    v_obs := 'Cadastro rápido da clínica (veterinário).';
    IF v_dup_id IS NOT NULL THEN
      v_obs := v_obs || ' Possível duplicado do cadastro "' || v_dup_nome || '" (mesmo telefone): a recepção confere e une.';
    END IF;
    INSERT INTO public.clientes (id, tenant_id, nome, telefone, whatsapp, observacoes)
    VALUES (v_cli_id, v_tenant, v_nome_tutor, v_fone, v_fone, v_obs);
  END IF;

  INSERT INTO public.pets (id, tenant_id, cliente_id, nome, especie, raca, porte, sexo, nascimento, peso_kg, castrado, alergias, ativo)
  VALUES (v_pet_id, v_tenant, v_cli_id, v_nome_pet, v_especie, nullif(btrim(coalesce(v_pet ->> 'raca', '')), ''), nullif(v_pet ->> 'porte', ''),
          nullif(v_pet ->> 'sexo', ''), v_nasc, v_peso, (v_pet ->> 'castrado')::boolean, nullif(btrim(coalesce(v_pet ->> 'alergias', '')), ''), true);

  INSERT INTO public.clinica_cadastros_rapidos (chave, tenant_id, cliente_id, pet_id, possivel_duplicado_de)
  VALUES (p_chave, v_tenant, v_cli_id, v_pet_id, v_dup_id);
  RETURN jsonb_build_object('cliente_id', v_cli_id, 'pet_id', v_pet_id, 'repetido', false, 'possivel_duplicado_de', v_dup_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_cadastro_rapido(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_cadastro_rapido(uuid, jsonb) TO authenticated;
