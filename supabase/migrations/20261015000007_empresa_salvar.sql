-- "Salvar empresa" numa transação só (pendência do R8).
--
-- A tela gravava em três chamadas: a empresa, o vínculo do administrador com ela (no primeiro cadastro) e o regime da
-- configuração fiscal. Se uma falhasse no meio, sobrava a empresa sem vínculo ou o regime tributário diferente do cadastro.
-- Agora a tela chama `empresa_salvar`: ou grava tudo, ou nada. Só administrador, como as políticas de `empresas`.
-- Campo que não vem no pacote mantém o valor atual; no primeiro cadastro, fica com o padrão da coluna.
CREATE OR REPLACE FUNCTION public.empresa_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_empresa uuid;
  v_regime text;
  v_razao text := btrim(coalesce(p_dados ->> 'razao_social', ''));
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Perfil sem empresa vinculada'; END IF;
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN RAISE EXCEPTION 'Informe os dados da empresa'; END IF;
  IF v_razao = '' THEN RAISE EXCEPTION 'Informe a razão social'; END IF;
  IF char_length(v_razao) > 200 THEN RAISE EXCEPTION 'Razão social muito longa'; END IF;
  IF p_dados ? 'cor_primaria' AND coalesce(p_dados ->> 'cor_primaria', '') !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Cor inválida';
  END IF;

  SELECT id INTO v_empresa FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;

  IF v_empresa IS NOT NULL THEN
    UPDATE public.empresas SET
      razao_social = v_razao,
      nome_fantasia = CASE WHEN p_dados ? 'nome_fantasia' THEN p_dados ->> 'nome_fantasia' ELSE nome_fantasia END,
      cnpj = CASE WHEN p_dados ? 'cnpj' THEN p_dados ->> 'cnpj' ELSE cnpj END,
      inscricao_estadual = CASE WHEN p_dados ? 'inscricao_estadual' THEN p_dados ->> 'inscricao_estadual' ELSE inscricao_estadual END,
      inscricao_municipal = CASE WHEN p_dados ? 'inscricao_municipal' THEN p_dados ->> 'inscricao_municipal' ELSE inscricao_municipal END,
      cnae = CASE WHEN p_dados ? 'cnae' THEN p_dados ->> 'cnae' ELSE cnae END,
      cnae_secundarios = CASE WHEN p_dados ? 'cnae_secundarios' THEN p_dados ->> 'cnae_secundarios' ELSE cnae_secundarios END,
      regime_tributario = coalesce(nullif(p_dados ->> 'regime_tributario', ''), regime_tributario),
      ramo_atividade = coalesce(nullif(p_dados ->> 'ramo_atividade', ''), ramo_atividade),
      telefone = CASE WHEN p_dados ? 'telefone' THEN p_dados ->> 'telefone' ELSE telefone END,
      email = CASE WHEN p_dados ? 'email' THEN p_dados ->> 'email' ELSE email END,
      cep = CASE WHEN p_dados ? 'cep' THEN p_dados ->> 'cep' ELSE cep END,
      endereco = CASE WHEN p_dados ? 'endereco' THEN p_dados ->> 'endereco' ELSE endereco END,
      numero = CASE WHEN p_dados ? 'numero' THEN p_dados ->> 'numero' ELSE numero END,
      complemento = CASE WHEN p_dados ? 'complemento' THEN p_dados ->> 'complemento' ELSE complemento END,
      bairro = CASE WHEN p_dados ? 'bairro' THEN p_dados ->> 'bairro' ELSE bairro END,
      cidade = CASE WHEN p_dados ? 'cidade' THEN p_dados ->> 'cidade' ELSE cidade END,
      estado = CASE WHEN p_dados ? 'estado' THEN p_dados ->> 'estado' ELSE estado END,
      codigo_municipio = CASE WHEN p_dados ? 'codigo_municipio' THEN p_dados ->> 'codigo_municipio' ELSE codigo_municipio END,
      logo_path = CASE WHEN p_dados ? 'logo_path' THEN p_dados ->> 'logo_path' ELSE logo_path END,
      cor_primaria = coalesce(nullif(p_dados ->> 'cor_primaria', ''), cor_primaria)
    WHERE id = v_empresa
    RETURNING regime_tributario INTO v_regime;
  ELSE
    INSERT INTO public.empresas (tenant_id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal,
      cnae, cnae_secundarios, regime_tributario, ramo_atividade, telefone, email, cep, endereco, numero, complemento,
      bairro, cidade, estado, codigo_municipio, logo_path, cor_primaria)
    VALUES (v_tenant, v_razao, p_dados ->> 'nome_fantasia', p_dados ->> 'cnpj', p_dados ->> 'inscricao_estadual',
      p_dados ->> 'inscricao_municipal', p_dados ->> 'cnae', p_dados ->> 'cnae_secundarios',
      coalesce(nullif(p_dados ->> 'regime_tributario', ''), 'simples'),
      coalesce(nullif(p_dados ->> 'ramo_atividade', ''), 'construcao'),
      p_dados ->> 'telefone', p_dados ->> 'email', p_dados ->> 'cep', p_dados ->> 'endereco', p_dados ->> 'numero',
      p_dados ->> 'complemento', p_dados ->> 'bairro', p_dados ->> 'cidade', p_dados ->> 'estado',
      p_dados ->> 'codigo_municipio', p_dados ->> 'logo_path',
      coalesce(nullif(p_dados ->> 'cor_primaria', ''), '#008037'))
    RETURNING id, regime_tributario INTO v_empresa, v_regime;
  END IF;

  -- o administrador do primeiro acesso passa a pertencer à empresa cadastrada
  UPDATE public.profiles SET empresa_id = v_empresa WHERE id = auth.uid() AND empresa_id IS NULL;

  -- o regime usado na emissão fiscal é o do cadastro
  UPDATE public.fiscal_config SET regime_tributario = v_regime
   WHERE tenant_id = v_tenant AND empresa_id = v_empresa AND filial_id IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id, regime_tributario) VALUES (v_tenant, v_empresa, v_regime);
  END IF;

  RETURN v_empresa;
END $$;

REVOKE ALL ON FUNCTION public.empresa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empresa_salvar(jsonb) TO authenticated;
