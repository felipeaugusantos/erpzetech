ALTER TABLE public.os_ordens
  ADD COLUMN IF NOT EXISTS pet_id uuid REFERENCES public.pets(id),
  ADD COLUMN IF NOT EXISTS pet_resumo jsonb,
  ADD COLUMN IF NOT EXISTS pet_profissional_id uuid REFERENCES public.pet_profissionais(id);
CREATE INDEX IF NOT EXISTS os_ordens_pet_idx ON public.os_ordens (tenant_id, pet_id) WHERE pet_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.os_ordens_protege_pet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.pet_id := NULL; NEW.pet_resumo := NULL; NEW.pet_profissional_id := NULL;
    ELSE
      NEW.pet_id := OLD.pet_id; NEW.pet_resumo := OLD.pet_resumo; NEW.pet_profissional_id := OLD.pet_profissional_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS os_ordens_protege_pet_trg ON public.os_ordens;
CREATE TRIGGER os_ordens_protege_pet_trg BEFORE INSERT OR UPDATE ON public.os_ordens
  FOR EACH ROW EXECUTE FUNCTION public.os_ordens_protege_pet();

CREATE OR REPLACE FUNCTION public._pet_os_resumo(p_pet_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('nome', p.nome, 'especie', p.especie, 'raca', p.raca, 'porte', p.porte, 'sexo', p.sexo,
                            'pelagem', p.pelagem, 'peso_kg', p.peso_kg, 'nascimento', p.nascimento, 'castrado', p.castrado,
                            'alergias', p.alergias, 'microchip', p.microchip,
                            'tutor', c.nome, 'tutor_telefone', coalesce(c.telefone, c.whatsapp))
    FROM public.pets p JOIN public.clientes c ON c.id = p.cliente_id
   WHERE p.id = p_pet_id AND p.tenant_id = public.current_tenant_id();
$$;
REVOKE ALL ON FUNCTION public._pet_os_resumo(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pet_os_total(p_os_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.os_ordens o SET valor_total = greatest(o.valor_pecas + o.valor_servicos - coalesce(o.desconto, 0), 0) WHERE o.id = p_os_id;
$$;
REVOKE ALL ON FUNCTION public._pet_os_total(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pet_os_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_pet uuid := nullif(p_dados ->> 'pet_id', '')::uuid;
  v_prof uuid := nullif(p_dados ->> 'profissional_id', '')::uuid;
  v_dep uuid := nullif(p_dados ->> 'deposito_id', '')::uuid;
  v_prof_nome text;
  v_desc numeric := coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0);
  v_prio text := coalesce(nullif(p_dados ->> 'prioridade', ''), 'normal');
  v_previsao date := nullif(p_dados ->> 'previsao', '')::date;
  v_cliente uuid;
  v_emp uuid; v_fil uuid;
  o public.os_ordens%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF v_desc < 0 THEN RAISE EXCEPTION 'O desconto não pode ser negativo'; END IF;
  IF v_prio NOT IN ('baixa', 'normal', 'alta', 'urgente') THEN RAISE EXCEPTION 'Prioridade inválida'; END IF;
  IF v_prof IS NOT NULL THEN
    SELECT nome INTO v_prof_nome FROM public.pet_profissionais WHERE id = v_prof AND tenant_id = v_tenant AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado ou inativo'; END IF;
  END IF;
  IF v_dep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = v_dep AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Depósito não encontrado';
  END IF;

  IF v_id IS NULL THEN
    IF v_pet IS NULL THEN RAISE EXCEPTION 'Escolha o animal da ordem de serviço'; END IF;
    SELECT cliente_id INTO v_cliente FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Animal não encontrado ou inativo'; END IF;
    SELECT empresa_id, filial_id INTO v_emp, v_fil FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.os_ordens (tenant_id, empresa_id, filial_id, cliente_id, equipamento, defeito_relatado, observacoes, prioridade,
                                  previsao, desconto, garantia_dias, deposito_id, tecnico_nome, pet_id, pet_resumo, pet_profissional_id)
    VALUES (v_tenant, v_emp, v_fil, v_cliente, (public._pet_os_resumo(v_pet) ->> 'nome'), nullif(btrim(p_dados ->> 'queixa'), ''),
            nullif(btrim(p_dados ->> 'observacoes'), ''), v_prio, v_previsao, v_desc, 0,
            coalesce(v_dep, (SELECT d.id FROM public.depositos d WHERE d.tenant_id = v_tenant AND d.ativo ORDER BY d.created_at LIMIT 1)),
            v_prof_nome, v_pet, public._pet_os_resumo(v_pet), v_prof)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO o FROM public.os_ordens WHERE id = v_id AND tenant_id = v_tenant AND pet_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada'; END IF;
    IF o.situacao IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'Ordem já encerrada: não pode mais ser alterada'; END IF;
    IF v_pet IS NOT NULL AND v_pet <> o.pet_id THEN RAISE EXCEPTION 'O animal não muda depois de aberta a ordem: cancele e abra outra'; END IF;
    UPDATE public.os_ordens SET defeito_relatado = nullif(btrim(p_dados ->> 'queixa'), ''), observacoes = nullif(btrim(p_dados ->> 'observacoes'), ''),
           prioridade = v_prio, previsao = v_previsao, desconto = v_desc, deposito_id = coalesce(v_dep, deposito_id),
           tecnico_nome = v_prof_nome, pet_profissional_id = v_prof,
           pet_resumo = CASE WHEN o.situacao IN ('aberta', 'em_analise', 'orcamento') THEN public._pet_os_resumo(o.pet_id) ELSE o.pet_resumo END
     WHERE id = v_id;
    PERFORM public._pet_os_total(v_id);
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_os_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_os_item_adicionar(p_os_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_prod uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_qtd numeric := coalesce(nullif(p_dados ->> 'quantidade', '')::numeric, 1);
  v_preco numeric := nullif(p_dados ->> 'preco', '')::numeric;
  v_tipo text := 'servico';
  v_item uuid;
  o public.os_ordens%ROWTYPE;
  pr public.produtos%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO o FROM public.os_ordens WHERE id = p_os_id AND tenant_id = v_tenant AND pet_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada'; END IF;
  IF o.situacao IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'Ordem já encerrada: não aceita novos itens'; END IF;
  IF v_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade precisa ser maior que zero'; END IF;
  IF v_preco IS NOT NULL AND v_preco < 0 THEN RAISE EXCEPTION 'O preço não pode ser negativo'; END IF;
  IF v_prod IS NOT NULL THEN
    SELECT * INTO pr FROM public.produtos WHERE id = v_prod AND tenant_id = v_tenant AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto ou serviço não encontrado'; END IF;
    IF pr.controla_estoque THEN v_tipo := 'peca'; END IF;
    IF v_desc = '' THEN v_desc := pr.descricao; END IF;
    v_preco := coalesce(v_preco, pr.preco_venda, 0);
  ELSE
    v_preco := coalesce(v_preco, 0);
  END IF;
  IF v_desc = '' THEN RAISE EXCEPTION 'Informe o produto ou o serviço'; END IF;
  INSERT INTO public.os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total)
  VALUES (v_tenant, p_os_id, v_tipo, v_prod, v_desc, v_qtd, v_preco, round(v_qtd * v_preco, 2))
  RETURNING id INTO v_item;
  PERFORM public._pet_os_total(p_os_id);
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.pet_os_item_adicionar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_item_adicionar(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_os_item_remover(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_os uuid;
  v_sit public.os_situacao;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT i.os_id, o.situacao INTO v_os, v_sit FROM public.os_itens i JOIN public.os_ordens o ON o.id = i.os_id
   WHERE i.id = p_item_id AND i.tenant_id = public.current_tenant_id() AND o.pet_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  IF v_sit IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'Ordem já encerrada: não aceita mudar itens'; END IF;
  DELETE FROM public.os_itens WHERE id = p_item_id;
  PERFORM public._pet_os_total(v_os);
END $$;
REVOKE ALL ON FUNCTION public.pet_os_item_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_item_remover(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_os_situacao(p_os_id uuid, p_situacao text, p_deposito_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.os_ordens%ROWTYPE;
  v_dep uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_situacao NOT IN ('aberta', 'orcamento', 'aprovada', 'em_reparo', 'pronta', 'entregue', 'cancelada') THEN
    RAISE EXCEPTION 'Situação inválida';
  END IF;
  SELECT * INTO o FROM public.os_ordens WHERE id = p_os_id AND tenant_id = v_tenant AND pet_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada'; END IF;
  IF o.situacao IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'Ordem já encerrada'; END IF;
  IF p_situacao = o.situacao::text THEN RETURN; END IF;
  IF p_situacao = 'entregue' AND o.situacao <> 'pronta' THEN RAISE EXCEPTION 'Só a ordem pronta pode ser entregue'; END IF;
  IF p_deposito_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = p_deposito_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Depósito não encontrado';
  END IF;
  v_dep := coalesce(p_deposito_id, o.deposito_id, (SELECT d.id FROM public.depositos d WHERE d.tenant_id = v_tenant AND d.ativo ORDER BY d.created_at LIMIT 1));
  UPDATE public.os_ordens SET situacao = p_situacao::public.os_situacao, deposito_id = v_dep,
         entregue_em = CASE WHEN p_situacao = 'entregue' THEN now() ELSE entregue_em END
   WHERE id = p_os_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_os_situacao(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_situacao(uuid, text, uuid) TO authenticated;