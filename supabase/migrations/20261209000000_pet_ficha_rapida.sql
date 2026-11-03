-- Pet: microchip e foto do animal, histórico de pesagens e farmacêutico (CRF) no cadastro de profissionais.
-- Escrita só por funções (mesmo papel e mesma trava do salão de pet_salvar). A foto é uma miniatura JPEG pequena
-- (a tela reduz antes de enviar); o banco confere formato e tamanho de novo.

-- ============ pets: microchip e foto ============
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS microchip text;
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS foto text;
ALTER TABLE public.pets DROP CONSTRAINT IF EXISTS pets_microchip_chk;
ALTER TABLE public.pets ADD CONSTRAINT pets_microchip_chk CHECK (microchip IS NULL OR microchip ~ '^[0-9]{9,15}$');
ALTER TABLE public.pets DROP CONSTRAINT IF EXISTS pets_foto_chk;
ALTER TABLE public.pets ADD CONSTRAINT pets_foto_chk CHECK (
  foto IS NULL OR (foto LIKE 'data:image/jpeg;base64,%' AND length(foto) <= 120000)
);
CREATE UNIQUE INDEX IF NOT EXISTS pets_microchip_idx ON public.pets (tenant_id, microchip) WHERE microchip IS NOT NULL;

-- A foto só muda quando a chave "foto" vem no pacote (null remove); o microchip segue o mesmo cuidado.
CREATE OR REPLACE FUNCTION public.pet_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_cliente uuid := nullif(p_dados ->> 'cliente_id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_peso numeric := nullif(p_dados ->> 'peso_kg', '')::numeric;
  v_chip text := nullif(regexp_replace(coalesce(p_dados ->> 'microchip', ''), '\D', '', 'g'), '');
  v_foto text := nullif(p_dados ->> 'foto', '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do pet'; END IF;
  IF v_peso IS NOT NULL AND v_peso <= 0 THEN RAISE EXCEPTION 'O peso precisa ser maior que zero'; END IF;
  IF coalesce(p_dados ->> 'especie', 'cao') NOT IN ('cao', 'gato', 'outro') THEN RAISE EXCEPTION 'Espécie inválida'; END IF;
  IF nullif(p_dados ->> 'porte', '') IS NOT NULL AND p_dados ->> 'porte' NOT IN ('mini', 'pequeno', 'medio', 'grande', 'gigante') THEN RAISE EXCEPTION 'Porte inválido'; END IF;
  IF nullif(p_dados ->> 'pelagem', '') IS NOT NULL AND p_dados ->> 'pelagem' NOT IN ('curta', 'media', 'longa', 'dupla', 'crespa', 'sem_pelo') THEN RAISE EXCEPTION 'Pelagem inválida'; END IF;
  IF nullif(p_dados ->> 'sexo', '') IS NOT NULL AND p_dados ->> 'sexo' NOT IN ('macho', 'femea') THEN RAISE EXCEPTION 'Sexo inválido'; END IF;
  IF v_chip IS NOT NULL AND v_chip !~ '^[0-9]{9,15}$' THEN RAISE EXCEPTION 'O microchip tem de 9 a 15 números'; END IF;
  IF v_foto IS NOT NULL AND (v_foto NOT LIKE 'data:image/jpeg;base64,%' OR length(v_foto) > 120000) THEN
    RAISE EXCEPTION 'A foto precisa ser JPEG e pequena (até cerca de 90 KB)';
  END IF;
  IF v_cliente IS NULL OR NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o tutor (cliente) do pet';
  END IF;
  IF v_chip IS NOT NULL AND EXISTS (SELECT 1 FROM public.pets x WHERE x.tenant_id = v_tenant AND x.microchip = v_chip AND x.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe outro pet com este microchip';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.pets (tenant_id, cliente_id, nome, especie, raca, porte, sexo, pelagem, peso_kg, nascimento, castrado, alergias, observacoes, ativo, microchip, foto)
    VALUES (v_tenant, v_cliente, v_nome, coalesce(nullif(p_dados ->> 'especie', ''), 'cao'), nullif(btrim(p_dados ->> 'raca'), ''),
            nullif(p_dados ->> 'porte', ''), nullif(p_dados ->> 'sexo', ''), nullif(p_dados ->> 'pelagem', ''), v_peso,
            nullif(p_dados ->> 'nascimento', '')::date, (p_dados ->> 'castrado')::boolean, nullif(btrim(p_dados ->> 'alergias'), ''),
            nullif(btrim(p_dados ->> 'observacoes'), ''), coalesce((p_dados ->> 'ativo')::boolean, true), v_chip, v_foto)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.pets SET cliente_id = v_cliente, nome = v_nome, especie = coalesce(nullif(p_dados ->> 'especie', ''), 'cao'),
           raca = nullif(btrim(p_dados ->> 'raca'), ''), porte = nullif(p_dados ->> 'porte', ''), sexo = nullif(p_dados ->> 'sexo', ''),
           pelagem = nullif(p_dados ->> 'pelagem', ''), peso_kg = v_peso, nascimento = nullif(p_dados ->> 'nascimento', '')::date,
           castrado = (p_dados ->> 'castrado')::boolean, alergias = nullif(btrim(p_dados ->> 'alergias'), ''),
           observacoes = nullif(btrim(p_dados ->> 'observacoes'), ''), ativo = coalesce((p_dados ->> 'ativo')::boolean, true),
           microchip = CASE WHEN p_dados ? 'microchip' THEN v_chip ELSE microchip END,
           foto = CASE WHEN p_dados ? 'foto' THEN v_foto ELSE foto END
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_salvar(jsonb) TO authenticated;

-- ============ pesagens ============
CREATE TABLE IF NOT EXISTS public.pet_pesagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  pesado_em date NOT NULL DEFAULT current_date CHECK (pesado_em <= current_date + 1),
  peso_kg numeric(6,2) NOT NULL CHECK (peso_kg > 0 AND peso_kg <= 200),
  observacao text,
  registrado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_pesagens_pet_idx ON public.pet_pesagens (tenant_id, pet_id, pesado_em DESC, created_at DESC);
ALTER TABLE public.pet_pesagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pet_pesagens_select ON public.pet_pesagens;
CREATE POLICY pet_pesagens_select ON public.pet_pesagens FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
REVOKE ALL ON public.pet_pesagens FROM anon, authenticated;
GRANT SELECT ON public.pet_pesagens TO authenticated;
GRANT ALL ON public.pet_pesagens TO service_role;
DROP POLICY IF EXISTS salao_restrito ON public.pet_pesagens;
CREATE POLICY salao_restrito ON public.pet_pesagens AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- O peso do cadastro acompanha a pesagem mais recente.
CREATE OR REPLACE FUNCTION public._pet_peso_atual(p_pet_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.pets p SET peso_kg = (
    SELECT g.peso_kg FROM public.pet_pesagens g WHERE g.pet_id = p.id AND g.tenant_id = p.tenant_id
     ORDER BY g.pesado_em DESC, g.created_at DESC LIMIT 1)
   WHERE p.id = p_pet_id AND p.tenant_id = public.current_tenant_id()
     AND EXISTS (SELECT 1 FROM public.pet_pesagens g WHERE g.pet_id = p.id);
$$;
REVOKE ALL ON FUNCTION public._pet_peso_atual(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pet_pesagem_registrar(p_pet_id uuid, p_peso_kg numeric, p_data date DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_data date := coalesce(p_data, current_date);
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa', 'veterinario', 'profissional']);
  IF p_peso_kg IS NULL OR p_peso_kg <= 0 OR p_peso_kg > 200 THEN RAISE EXCEPTION 'Informe um peso entre 0,01 e 200 kg'; END IF;
  IF v_data > current_date + 1 THEN RAISE EXCEPTION 'A data da pesagem não pode ser futura'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  INSERT INTO public.pet_pesagens (tenant_id, pet_id, pesado_em, peso_kg, observacao)
  VALUES (v_tenant, p_pet_id, v_data, p_peso_kg, nullif(btrim(p_observacao), ''))
  RETURNING id INTO v_id;
  PERFORM public._pet_peso_atual(p_pet_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_pesagem_registrar(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pesagem_registrar(uuid, numeric, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_pesagem_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pet uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  DELETE FROM public.pet_pesagens WHERE id = p_id AND tenant_id = public.current_tenant_id() RETURNING pet_id INTO v_pet;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesagem não encontrada'; END IF;
  PERFORM public._pet_peso_atual(v_pet);
END $$;
REVOKE ALL ON FUNCTION public.pet_pesagem_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_pesagem_excluir(uuid) TO authenticated;

-- ============ farmacêutico (CRF) ============
ALTER TABLE public.pet_profissionais DROP CONSTRAINT IF EXISTS pet_profissionais_funcao_check;
ALTER TABLE public.pet_profissionais ADD CONSTRAINT pet_profissionais_funcao_check
  CHECK (funcao IN ('banhista', 'tosador', 'groomer', 'veterinario', 'farmaceutico', 'auxiliar', 'outro'));
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS crf text;
ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS crf_uf text;
ALTER TABLE public.pet_profissionais DROP CONSTRAINT IF EXISTS pet_profissionais_crf_chk;
ALTER TABLE public.pet_profissionais ADD CONSTRAINT pet_profissionais_crf_chk CHECK (
  (crf IS NULL AND crf_uf IS NULL)
  OR (crf IS NOT NULL AND crf_uf IS NOT NULL AND crf ~ '^[0-9A-Z]{3,12}$' AND crf_uf ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$')
);

CREATE OR REPLACE FUNCTION public.pet_profissional_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_funcao text := coalesce(nullif(p_dados ->> 'funcao', ''), 'tosador');
  v_com numeric := coalesce(nullif(p_dados ->> 'comissao_percentual', '')::numeric, 0);
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_crmv text := upper(regexp_replace(coalesce(p_dados ->> 'crmv', ''), '[^0-9A-Za-z]', '', 'g'));
  v_uf text := upper(btrim(coalesce(p_dados ->> 'crmv_uf', '')));
  v_crf text := upper(regexp_replace(coalesce(p_dados ->> 'crf', ''), '[^0-9A-Za-z]', '', 'g'));
  v_crf_uf text := upper(btrim(coalesce(p_dados ->> 'crf_uf', '')));
  v_ufs constant text := '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$';
  v_profile uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do profissional'; END IF;
  IF v_funcao NOT IN ('banhista', 'tosador', 'groomer', 'veterinario', 'farmaceutico', 'auxiliar', 'outro') THEN RAISE EXCEPTION 'Função inválida'; END IF;
  IF v_com < 0 OR v_com > 100 THEN RAISE EXCEPTION 'A comissão precisa ficar entre 0 e 100%%'; END IF;
  IF v_filial IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filiais f WHERE f.id = v_filial AND f.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  IF v_funcao = 'veterinario' THEN
    IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa: informe o CNAE 7500 ou o ramo Clínica veterinária no cadastro da empresa'; END IF;
    IF v_crmv !~ '^[0-9A-Z]{3,12}$' THEN RAISE EXCEPTION 'Informe o CRMV do veterinário'; END IF;
    IF v_uf !~ v_ufs THEN RAISE EXCEPTION 'Informe a UF do CRMV'; END IF;
  ELSE
    v_crmv := NULL; v_uf := NULL;
  END IF;
  IF v_funcao = 'farmaceutico' THEN
    IF v_crf !~ '^[0-9A-Z]{3,12}$' THEN RAISE EXCEPTION 'Informe o CRF do farmacêutico'; END IF;
    IF v_crf_uf !~ v_ufs THEN RAISE EXCEPTION 'Informe a UF do CRF'; END IF;
  ELSE
    v_crf := NULL; v_crf_uf := NULL;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_profissionais (tenant_id, filial_id, nome, funcao, comissao_percentual, ativo, crmv, crmv_uf, crf, crf_uf)
    VALUES (v_tenant, v_filial, v_nome, v_funcao, v_com, coalesce((p_dados ->> 'ativo')::boolean, true), v_crmv, v_uf, v_crf, v_crf_uf)
    RETURNING id INTO v_id;
  ELSE
    SELECT profile_id INTO v_profile FROM public.pet_profissionais WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
    IF v_profile IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.user_roles r WHERE r.user_id = v_profile AND r.tenant_id = v_tenant
            AND r.role = (CASE WHEN v_funcao = 'veterinario' THEN 'veterinario' ELSE 'profissional' END)::public.app_role) THEN
      RAISE EXCEPTION 'A conta ligada não tem o perfil desta função: desfaça o vínculo da conta antes de mudar a função';
    END IF;
    UPDATE public.pet_profissionais SET filial_id = v_filial, nome = v_nome, funcao = v_funcao, comissao_percentual = v_com,
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true), crmv = v_crmv, crmv_uf = v_uf, crf = v_crf, crf_uf = v_crf_uf
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_salvar(jsonb) TO authenticated;

-- A ficha do paciente leva microchip e foto (para a ficha impressa).
CREATE OR REPLACE FUNCTION public.clinica_historico(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  v_tutor text;
BEGIN
  PERFORM public._clinica_vet();
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT nome INTO v_tutor FROM public.clientes WHERE id = pt.cliente_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'historico');
  RETURN jsonb_build_object(
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'sexo', pt.sexo,
                              'pelagem', pt.pelagem, 'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado,
                              'alergias', pt.alergias, 'observacoes', pt.observacoes, 'microchip', pt.microchip, 'foto', pt.foto),
    'tutor', v_tutor,
    'atendimentos', coalesce((SELECT jsonb_agg(public._clinica_atendimento_json(a.id) ORDER BY a.aberto_em DESC)
                                FROM public.pet_atendimentos_clinicos a WHERE a.pet_id = pt.id AND a.tenant_id = v_tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_historico(uuid) TO authenticated;
