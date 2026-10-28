-- Lava rápido: o veículo é cadastrado por placa (ou prefixo da aeronave), fabricante e modelo.
-- "descricao" (marca/modelo em um campo só) vira "modelo"; o fabricante dos já cadastrados fica "Não informado" até a edição.
ALTER TABLE public.lr_veiculos ADD COLUMN IF NOT EXISTS fabricante text;
ALTER TABLE public.lr_veiculos ADD COLUMN IF NOT EXISTS modelo text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lr_veiculos' AND column_name = 'descricao') THEN
    UPDATE public.lr_veiculos SET modelo = coalesce(modelo, descricao);
    ALTER TABLE public.lr_veiculos DROP COLUMN descricao;
  END IF;
END $$;

UPDATE public.lr_veiculos SET fabricante = 'Não informado' WHERE fabricante IS NULL;
UPDATE public.lr_veiculos SET modelo = 'Não informado' WHERE modelo IS NULL;
ALTER TABLE public.lr_veiculos ALTER COLUMN fabricante SET NOT NULL;
ALTER TABLE public.lr_veiculos ALTER COLUMN modelo SET NOT NULL;
ALTER TABLE public.lr_veiculos ADD CONSTRAINT lr_veiculos_fabricante_ck CHECK (length(btrim(fabricante)) > 0);
ALTER TABLE public.lr_veiculos ADD CONSTRAINT lr_veiculos_modelo_ck CHECK (length(btrim(modelo)) > 0);

CREATE OR REPLACE FUNCTION public.lr_veiculo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_cliente uuid := nullif(p_dados ->> 'cliente_id', '')::uuid;
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'carro');
  v_ident text := upper(regexp_replace(coalesce(p_dados ->> 'identificacao', ''), '[^0-9A-Za-z]', '', 'g'));
  v_fab text := btrim(coalesce(p_dados ->> 'fabricante', ''));
  v_mod text := btrim(coalesce(p_dados ->> 'modelo', ''));
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF v_tipo NOT IN ('carro', 'moto', 'caminhonete', 'aviao', 'helicoptero') THEN RAISE EXCEPTION 'Tipo de veículo inválido'; END IF;
  IF v_tipo IN ('aviao', 'helicoptero') THEN
    IF v_ident !~ '^[A-Z0-9]{4,6}$' THEN RAISE EXCEPTION 'Informe o prefixo da aeronave (ex.: PTABC)'; END IF;
  ELSIF v_ident !~ '^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$' THEN
    RAISE EXCEPTION 'Informe a placa (ex.: ABC1234 ou ABC1D23)';
  END IF;
  IF v_fab = '' THEN RAISE EXCEPTION 'Informe o fabricante do veículo'; END IF;
  IF v_mod = '' THEN RAISE EXCEPTION 'Informe o modelo do veículo'; END IF;
  IF v_cliente IS NULL OR NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o cliente dono do veículo';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lr_veiculos x WHERE x.tenant_id = v_tenant AND x.identificacao = v_ident AND x.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um veículo com esta identificação';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.lr_veiculos (tenant_id, cliente_id, tipo, identificacao, fabricante, modelo, cor, observacoes, ativo)
    VALUES (v_tenant, v_cliente, v_tipo, v_ident, v_fab, v_mod, nullif(btrim(p_dados ->> 'cor'), ''),
            nullif(btrim(p_dados ->> 'observacoes'), ''), coalesce((p_dados ->> 'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_veiculos SET cliente_id = v_cliente, tipo = v_tipo, identificacao = v_ident, fabricante = v_fab, modelo = v_mod,
           cor = nullif(btrim(p_dados ->> 'cor'), ''), observacoes = nullif(btrim(p_dados ->> 'observacoes'), ''),
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_veiculo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_veiculo_salvar(jsonb) TO authenticated;
