ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS obito boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.pets.obito IS 'Marcação de falecimento do pet; independente de ativo, preserva histórico clínico.';
CREATE OR REPLACE FUNCTION public.pet_salvar_com_obito(p_dados jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public.pet_salvar(p_dados);
  IF p_dados ? 'obito' THEN
    IF jsonb_typeof(p_dados -> 'obito') <> 'boolean' THEN RAISE EXCEPTION 'Óbito precisa ser sim ou não'; END IF;
    UPDATE public.pets SET obito = (p_dados ->> 'obito')::boolean WHERE id = v_id AND tenant_id = public.current_tenant_id();
    IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_salvar_com_obito(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_salvar_com_obito(jsonb) TO authenticated, service_role;