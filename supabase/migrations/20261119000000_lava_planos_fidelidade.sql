-- Lava rápido (Fase 2, etapa 1): planos mensais (assinatura de lavagens por veículo) e fidelidade (a N-ésima lavagem é brinde).
-- Plano: vendido na frente de caixa como produto sem estoque; vale por um período e dá N lavagens de um serviço para UM veículo.
-- Não há cobrança automática no cartão: renovar é vender o plano de novo no caixa (o vencimento aparece nos avisos da etapa 2).
-- Cobertura: ao abrir a ordem, o serviço coberto por plano ou brinde fica marcado (cobertura) e não entra na cobrança, na comissão
-- nem na NFS-e; ordem só de itens cobertos é entregue sem passar pelo caixa. Cancelar a ordem devolve a lavagem ao plano.

ALTER TABLE public.lr_ordem_itens ADD COLUMN IF NOT EXISTS cobertura text CHECK (cobertura IN ('assinatura', 'fidelidade'));
ALTER TABLE public.lr_ordem_itens ADD COLUMN IF NOT EXISTS assinatura_id uuid;

CREATE TABLE IF NOT EXISTS public.lr_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  servico_id uuid NOT NULL REFERENCES public.lr_servicos(id),
  lavagens integer NOT NULL CHECK (lavagens BETWEEN 2 AND 60),
  validade_dias integer NOT NULL DEFAULT 30 CHECK (validade_dias BETWEEN 7 AND 366),
  tipo text CHECK (tipo IN ('carro', 'moto', 'caminhonete', 'aviao', 'helicoptero')),
  preco numeric(14,2) NOT NULL CHECK (preco > 0),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_planos_nome_idx ON public.lr_planos (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS lr_planos_produto_idx ON public.lr_planos (produto_id);

CREATE TABLE IF NOT EXISTS public.lr_assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  plano_id uuid NOT NULL REFERENCES public.lr_planos(id),
  veiculo_id uuid NOT NULL REFERENCES public.lr_veiculos(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  servico_id uuid NOT NULL REFERENCES public.lr_servicos(id),
  lavagens integer NOT NULL CHECK (lavagens > 0),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  comprado_em date NOT NULL,
  vence_em date NOT NULL,
  venda_id uuid UNIQUE REFERENCES public.pedidos(id),
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'cancelada')),
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_assinaturas_veiculo_idx ON public.lr_assinaturas (tenant_id, veiculo_id, situacao, vence_em);

CREATE TABLE IF NOT EXISTS public.lr_assinatura_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  assinatura_id uuid NOT NULL REFERENCES public.lr_assinaturas(id),
  item_id uuid NOT NULL UNIQUE REFERENCES public.lr_ordem_itens(id) ON DELETE CASCADE,
  desfeito boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_assinatura_usos_assinatura_idx ON public.lr_assinatura_usos (assinatura_id);

-- Uma linha por empresa. ativo_desde: só as lavagens entregues depois de ligar o programa contam selo.
CREATE TABLE IF NOT EXISTS public.lr_fidelidade_config (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT false,
  lavagens_para_brinde integer NOT NULL DEFAULT 10 CHECK (lavagens_para_brinde BETWEEN 2 AND 50),
  servico_id uuid REFERENCES public.lr_servicos(id),
  ativo_desde timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_planos', 'lr_assinaturas', 'lr_assinatura_usos', 'lr_fidelidade_config'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $$;

-- ============ apoio ============
CREATE OR REPLACE FUNCTION public._lr_assinatura_restam(p_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT a.lavagens - (SELECT count(*)::int FROM public.lr_assinatura_usos u WHERE u.assinatura_id = a.id AND NOT u.desfeito)
    FROM public.lr_assinaturas a WHERE a.id = p_id
$$;
REVOKE ALL ON FUNCTION public._lr_assinatura_restam(uuid) FROM PUBLIC, anon, authenticated;

-- Selos, brindes e o que falta para o próximo. Selo = ordem entregue (cobrada ou coberta) depois de ligar o programa;
-- brinde usado = item de fidelidade em ordem não cancelada.
CREATE OR REPLACE FUNCTION public._lr_fidelidade(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  c public.lr_fidelidade_config%ROWTYPE;
  v_selos integer; v_usados integer; v_ganhos integer; v_disp integer;
BEGIN
  SELECT * INTO c FROM public.lr_fidelidade_config WHERE tenant_id = v_tenant;
  IF NOT FOUND OR NOT c.ativo OR c.servico_id IS NULL THEN
    RETURN jsonb_build_object('ativo', false, 'selos', 0, 'disponiveis', 0, 'faltam', 0, 'necessarias', 0);
  END IF;
  SELECT count(*)::int INTO v_selos FROM public.lr_ordens o
   WHERE o.tenant_id = v_tenant AND o.cliente_id = p_cliente_id AND o.situacao = 'entregue' AND o.entregue_em >= c.ativo_desde;
  SELECT count(*)::int INTO v_usados FROM public.lr_ordem_itens i JOIN public.lr_ordens o ON o.id = i.ordem_id
   WHERE i.tenant_id = v_tenant AND o.cliente_id = p_cliente_id AND i.cobertura = 'fidelidade'
     AND o.situacao <> 'cancelada' AND o.created_at >= c.ativo_desde;
  v_ganhos := v_selos / c.lavagens_para_brinde;
  v_disp := greatest(v_ganhos - v_usados, 0);
  RETURN jsonb_build_object('ativo', true, 'selos', v_selos, 'necessarias', c.lavagens_para_brinde, 'brindes_usados', v_usados,
                            'disponiveis', v_disp, 'faltam', c.lavagens_para_brinde - (v_selos % c.lavagens_para_brinde),
                            'servico_id', c.servico_id);
END $$;
REVOKE ALL ON FUNCTION public._lr_fidelidade(uuid) FROM PUBLIC, anon, authenticated;

-- Quais serviços da ordem ficam cobertos: primeiro o plano do veículo (vence primeiro), depois o brinde (um por ordem).
CREATE OR REPLACE FUNCTION public._lr_cobertura(p_veiculo_id uuid, p_servicos uuid[])
RETURNS TABLE (servico_id uuid, cobertura text, assinatura_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_cliente uuid; v_fid jsonb; v_brinde boolean := false; s uuid; a uuid;
BEGIN
  SELECT v.cliente_id INTO v_cliente FROM public.lr_veiculos v WHERE v.id = p_veiculo_id AND v.tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN; END IF;
  v_fid := public._lr_fidelidade(v_cliente);
  FOREACH s IN ARRAY p_servicos LOOP
    a := NULL;
    SELECT x.id INTO a FROM public.lr_assinaturas x
     WHERE x.tenant_id = v_tenant AND x.veiculo_id = p_veiculo_id AND x.servico_id = s AND x.situacao = 'ativa'
       AND x.vence_em >= v_hoje AND public._lr_assinatura_restam(x.id) > 0
     ORDER BY x.vence_em, x.created_at LIMIT 1;
    IF a IS NOT NULL THEN
      servico_id := s; cobertura := 'assinatura'; assinatura_id := a; RETURN NEXT; CONTINUE;
    END IF;
    IF NOT v_brinde AND (v_fid ->> 'disponiveis')::int > 0 AND (v_fid ->> 'servico_id')::uuid = s THEN
      v_brinde := true;
      servico_id := s; cobertura := 'fidelidade'; assinatura_id := NULL; RETURN NEXT; CONTINUE;
    END IF;
    servico_id := s; cobertura := NULL; assinatura_id := NULL; RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._lr_cobertura(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- Prévia para a tela de nova ordem (mesma regra de quando a ordem é aberta).
CREATE OR REPLACE FUNCTION public.lr_cobertura_previa(p_veiculo_id uuid, p_servicos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ids uuid[];
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF jsonb_typeof(p_servicos) IS DISTINCT FROM 'array' THEN RETURN '[]'::jsonb; END IF;
  SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_servicos) x;
  IF v_ids IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('servico_id', c.servico_id, 'cobertura', c.cobertura))
                     FROM public._lr_cobertura(p_veiculo_id, v_ids) c), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.lr_cobertura_previa(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_cobertura_previa(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_fidelidade_cliente(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id AND c.tenant_id = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;
  RETURN public._lr_fidelidade(p_cliente_id);
END $$;
REVOKE ALL ON FUNCTION public.lr_fidelidade_cliente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fidelidade_cliente(uuid) TO authenticated;

-- ============ cadastros ============
CREATE OR REPLACE FUNCTION public.lr_fidelidade_salvar(p_ativo boolean, p_lavagens integer, p_servico_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  c public.lr_fidelidade_config%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF p_lavagens IS NULL OR p_lavagens < 2 OR p_lavagens > 50 THEN RAISE EXCEPTION 'O brinde sai entre a 2ª e a 50ª lavagem'; END IF;
  IF p_ativo AND (p_servico_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lr_servicos s WHERE s.id = p_servico_id AND s.tenant_id = v_tenant AND s.ativo)) THEN
    RAISE EXCEPTION 'Escolha o serviço que será o brinde';
  END IF;
  SELECT * INTO c FROM public.lr_fidelidade_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.lr_fidelidade_config (tenant_id, ativo, lavagens_para_brinde, servico_id) VALUES (v_tenant, p_ativo, p_lavagens, p_servico_id);
  ELSE
    -- ligar de novo (estava desligado) recomeça a contagem de selos
    UPDATE public.lr_fidelidade_config
       SET ativo = p_ativo, lavagens_para_brinde = p_lavagens, servico_id = p_servico_id,
           ativo_desde = CASE WHEN p_ativo AND NOT c.ativo THEN now() ELSE c.ativo_desde END
     WHERE tenant_id = v_tenant;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_fidelidade_salvar(boolean, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fidelidade_salvar(boolean, integer, uuid) TO authenticated;

-- Plano: cria (ou atualiza) o produto sem estoque que vai para o caixa.
CREATE OR REPLACE FUNCTION public.lr_plano_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_serv uuid := nullif(p_dados ->> 'servico_id', '')::uuid;
  v_lav integer := nullif(p_dados ->> 'lavagens', '')::integer;
  v_val integer := coalesce(nullif(p_dados ->> 'validade_dias', '')::integer, 30);
  v_tipo text := nullif(btrim(coalesce(p_dados ->> 'tipo', '')), '');
  v_preco numeric := nullif(p_dados ->> 'preco', '')::numeric;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_prod uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do plano'; END IF;
  IF v_lav IS NULL OR v_lav < 2 OR v_lav > 60 THEN RAISE EXCEPTION 'O plano precisa ter de 2 a 60 lavagens'; END IF;
  IF v_val < 7 OR v_val > 366 THEN RAISE EXCEPTION 'A validade precisa ficar entre 7 e 366 dias'; END IF;
  IF v_preco IS NULL OR v_preco <= 0 THEN RAISE EXCEPTION 'Informe o preço do plano'; END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('carro', 'moto', 'caminhonete', 'aviao', 'helicoptero') THEN RAISE EXCEPTION 'Tipo de veículo inválido'; END IF;
  IF v_serv IS NULL OR NOT EXISTS (SELECT 1 FROM public.lr_servicos s WHERE s.id = v_serv AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o serviço do plano';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_plano:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.lr_planos p WHERE p.tenant_id = v_tenant AND lower(btrim(p.nome)) = lower(v_nome) AND p.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um plano com este nome';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque, ativo)
    VALUES (v_tenant, '', v_nome, 'UN', v_preco, false, v_ativo) RETURNING id INTO v_prod;
    INSERT INTO public.lr_planos (tenant_id, nome, servico_id, lavagens, validade_dias, tipo, preco, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_serv, v_lav, v_val, v_tipo, round(v_preco, 2), v_prod, v_ativo) RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_planos SET nome = v_nome, servico_id = v_serv, lavagens = v_lav, validade_dias = v_val, tipo = v_tipo,
           preco = round(v_preco, 2), ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant RETURNING produto_id INTO v_prod;
    IF v_prod IS NULL THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
    UPDATE public.produtos SET descricao = v_nome, preco_venda = round(v_preco, 2), ativo = v_ativo WHERE id = v_prod AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_plano_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_plano_salvar(jsonb) TO authenticated;

-- ============ venda do plano: confere a venda do caixa e cria a assinatura do veículo ============
CREATE OR REPLACE FUNCTION public.lr_plano_vender(
  p_plano_id uuid, p_veiculo_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  pl public.lr_planos%ROWTYPE;
  vc public.lr_veiculos%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  v_existente uuid; v_valor numeric; v_id uuid; v_nfe uuid; v_serv text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO pl FROM public.lr_planos WHERE id = p_plano_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  IF NOT pl.ativo THEN RAISE EXCEPTION 'Este plano não está à venda'; END IF;
  SELECT * INTO vc FROM public.lr_veiculos WHERE id = p_veiculo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  IF NOT vc.ativo THEN RAISE EXCEPTION 'Este veículo está inativo'; END IF;
  IF pl.tipo IS NOT NULL AND pl.tipo <> vc.tipo THEN RAISE EXCEPTION 'Este plano é só para %', pl.tipo; END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_plano_venda:' || v_pedido::text, 0));
  -- repetir a chamada (resposta perdida) devolve a mesma assinatura
  SELECT id INTO v_existente FROM public.lr_assinaturas WHERE venda_id = v_pedido;
  IF v_existente IS NOT NULL THEN
    RETURN jsonb_build_object('assinatura_id', v_existente, 'repetido', true);
  END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A venda do plano é feita na frente de caixa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = pl.produto_id
                  AND pi.preco_unitario = pl.preco AND pi.quantidade = 1) THEN
    RAISE EXCEPTION 'A venda não traz o plano "%" uma vez, por %', pl.nome, pl.preco;
  END IF;

  v_valor := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(pl.preco * v_ped.total / v_ped.subtotal, 2) ELSE pl.preco END;
  INSERT INTO public.lr_assinaturas (tenant_id, plano_id, veiculo_id, cliente_id, servico_id, lavagens, valor, comprado_em, vence_em, venda_id)
  VALUES (v_tenant, pl.id, vc.id, vc.cliente_id, pl.servico_id, pl.lavagens, v_valor, v_hoje, v_hoje + pl.validade_dias, v_pedido)
  RETURNING id INTO v_id;

  SELECT nome INTO v_serv FROM public.lr_servicos WHERE id = pl.servico_id;
  v_nfe := public._pet_nfse_criar(vc.cliente_id, v_pedido,
             jsonb_build_array(jsonb_build_object('descricao', pl.nome || ' (' || pl.lavagens || ' x ' || coalesce(v_serv, 'serviço') || ') — ' || vc.identificacao, 'valor', pl.preco)),
             v_valor, 'Prestação de serviço — plano de lavagem de veículos');
  RETURN jsonb_build_object('assinatura_id', v_id, 'nfe_id', v_nfe, 'vence_em', v_hoje + pl.validade_dias, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.lr_plano_vender(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_plano_vender(uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_assinatura_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF nullif(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  UPDATE public.lr_assinaturas SET situacao = 'cancelada', motivo = btrim(p_motivo)
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'ativa';
  IF NOT FOUND THEN RAISE EXCEPTION 'Assinatura não encontrada ou já cancelada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_assinatura_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_assinatura_cancelar(uuid, text) TO authenticated;

-- ============ ordem: abre já com a cobertura marcada ============
CREATE OR REPLACE FUNCTION public.lr_ordem_criar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_veic public.lr_veiculos%ROWTYPE;
  v_lavador uuid := nullif(p_dados ->> 'lavador_id', '')::uuid;
  v_ids uuid[];
  v_id uuid;
  v_item uuid;
  s uuid;
  c record;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO v_veic FROM public.lr_veiculos WHERE id = nullif(p_dados ->> 'veiculo_id', '')::uuid AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  IF NOT v_veic.ativo THEN RAISE EXCEPTION 'Este veículo está inativo'; END IF;
  IF jsonb_typeof(p_dados -> 'servicos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'servicos') = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um serviço';
  END IF;
  SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_dados -> 'servicos') x;
  IF (SELECT count(*) FROM public.lr_servicos WHERE id = ANY (v_ids) AND tenant_id = v_tenant AND ativo) <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'Serviço não encontrado ou inativo';
  END IF;
  IF v_lavador IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lr_lavadores l WHERE l.id = v_lavador AND l.tenant_id = v_tenant AND l.ativo) THEN
    RAISE EXCEPTION 'Lavador não encontrado ou inativo';
  END IF;
  -- duas ordens do mesmo cliente ao mesmo tempo não gastam o mesmo brinde ou a mesma lavagem do plano
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_cobertura:' || v_veic.cliente_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.lr_ordens o WHERE o.veiculo_id = v_veic.id AND o.situacao IN ('aguardando', 'lavando', 'secando', 'pronto')) THEN
    RAISE EXCEPTION 'Este veículo já tem uma ordem aberta';
  END IF;

  INSERT INTO public.lr_ordens (tenant_id, veiculo_id, cliente_id, lavador_id, box, observacoes)
  VALUES (v_tenant, v_veic.id, v_veic.cliente_id, v_lavador, nullif(btrim(p_dados ->> 'box'), ''), nullif(btrim(p_dados ->> 'observacoes'), ''))
  RETURNING id INTO v_id;
  FOR c IN SELECT * FROM public._lr_cobertura(v_veic.id, v_ids) LOOP
    INSERT INTO public.lr_ordem_itens (tenant_id, ordem_id, servico_id, preco_aplicado, cobertura, assinatura_id)
    VALUES (v_tenant, v_id, c.servico_id, public._lr_preco(c.servico_id, v_veic.tipo), c.cobertura, c.assinatura_id)
    RETURNING id INTO v_item;
    IF c.cobertura = 'assinatura' THEN
      INSERT INTO public.lr_assinatura_usos (tenant_id, assinatura_id, item_id) VALUES (v_tenant, c.assinatura_id, v_item);
    END IF;
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_ordem_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_criar(jsonb) TO authenticated;

-- Cancelar a ordem devolve a lavagem ao plano (o brinde volta sozinho: ordem cancelada não conta como usado).
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lr_ordem_situacao';
  IF def IS NULL THEN RAISE EXCEPTION 'lr_ordem_situacao não encontrada'; END IF;
  nova := replace(def, E'         motivo_cancelamento = CASE WHEN p_para = ''cancelada'' THEN nullif(btrim(p_motivo), '''') ELSE NULL END\n   WHERE id = o.id;',
    E'         motivo_cancelamento = CASE WHEN p_para = ''cancelada'' THEN nullif(btrim(p_motivo), '''') ELSE NULL END\n   WHERE id = o.id;\n'
    || E'  IF p_para = ''cancelada'' THEN\n'
    || E'    UPDATE public.lr_assinatura_usos SET desfeito = true WHERE item_id IN (SELECT id FROM public.lr_ordem_itens WHERE ordem_id = o.id);\n'
    || E'  END IF;');
  IF nova = def THEN RAISE EXCEPTION 'lr_ordem_situacao: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

-- NFS-e da ordem: só o que foi cobrado (itens cobertos por plano ou brinde ficam de fora).
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_lr_nfse_rascunho';
  IF def IS NULL THEN RAISE EXCEPTION '_lr_nfse_rascunho não encontrada'; END IF;
  nova := replace(def, 'FROM public.lr_ordem_itens WHERE ordem_id = o.id;', 'FROM public.lr_ordem_itens WHERE ordem_id = o.id AND cobertura IS NULL;');
  nova := replace(nova, E'   WHERE i.ordem_id = o.id;', E'   WHERE i.ordem_id = o.id AND i.cobertura IS NULL;');
  IF nova = def OR (length(nova) - length(replace(nova, 'cobertura IS NULL', ''))) / length('cobertura IS NULL') <> 2 THEN
    RAISE EXCEPTION '_lr_nfse_rascunho: trechos esperados não encontrados';
  END IF;
  EXECUTE nova;
END $$;

-- Entregar e cobrar: só os itens não cobertos passam pelo caixa; ordem só de itens cobertos é entregue direto.
CREATE OR REPLACE FUNCTION public.lr_ordem_retirar(p_ordem_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  lv public.lr_lavadores%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  r record;
  v_cobrados integer;
  v_bruto numeric; v_liquido numeric; v_valor numeric; v_nfe uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  SELECT count(*)::int INTO v_cobrados FROM public.lr_ordem_itens WHERE ordem_id = o.id AND cobertura IS NULL;

  IF o.situacao = 'entregue' THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    IF v_cobrados = 0 THEN
      RETURN jsonb_build_object('pedido_id', NULL, 'nfe_id', NULL, 'comissao', 0, 'repetido', true);
    END IF;
    IF o.venda_id IS NOT NULL AND (o.venda_id = p_pedido_id OR p_pedido_id IS NULL) THEN
      RETURN jsonb_build_object('pedido_id', o.venda_id,
        'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = o.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1), 'repetido', true);
    END IF;
  END IF;
  IF o.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para entregar e cobrar ordem pronta (situação atual: %)', o.situacao; END IF;

  IF v_cobrados = 0 THEN
    UPDATE public.lr_ordens SET situacao = 'entregue', entregue_em = now() WHERE id = o.id;
    RETURN jsonb_build_object('pedido_id', NULL, 'nfe_id', NULL, 'comissao', 0, 'repetido', false);
  END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A cobrança do lava rápido é feita na frente de caixa'; END IF;
  IF EXISTS (SELECT 1 FROM public.lr_ordens x WHERE x.venda_id = v_pedido AND x.id <> o.id) THEN
    RAISE EXCEPTION 'Esta venda já cobrou outra ordem';
  END IF;

  -- a venda precisa ter cada serviço cobrado da ordem, pelo valor combinado
  FOR r IN SELECT i.servico_id, i.preco_aplicado, s.produto_id, s.nome
             FROM public.lr_ordem_itens i JOIN public.lr_servicos s ON s.id = i.servico_id
            WHERE i.ordem_id = o.id AND i.cobertura IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                    AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
      RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
    END IF;
  END LOOP;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.lr_ordem_itens WHERE ordem_id = o.id AND cobertura IS NULL;
  -- o desconto da venda reparte-se por igual entre todos os itens: o serviço fica com a parte proporcional
  v_liquido := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(v_bruto * v_ped.total / v_ped.subtotal, 2) ELSE v_bruto END;

  UPDATE public.lr_ordens SET situacao = 'entregue', venda_id = v_pedido, entregue_em = now() WHERE id = o.id;

  IF o.lavador_id IS NOT NULL THEN
    SELECT * INTO lv FROM public.lr_lavadores WHERE id = o.lavador_id;
    v_valor := round(v_liquido * lv.comissao_percentual / 100, 2);
    IF v_valor > 0 THEN
      INSERT INTO public.lr_comissoes (tenant_id, lavador_id, ordem_id, pedido_id, base, percentual, valor)
      VALUES (v_tenant, o.lavador_id, o.id, v_pedido, v_liquido, lv.comissao_percentual, v_valor)
      -- cobrar de novo depois de uma venda cancelada reativa a comissão cancelada (uma por ordem)
      ON CONFLICT (ordem_id) DO UPDATE
         SET pedido_id = EXCLUDED.pedido_id, base = EXCLUDED.base, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor,
             situacao = 'a_aprovar', aprovada_em = NULL, aprovada_por = NULL
       WHERE public.lr_comissoes.situacao = 'cancelada';
    END IF;
  END IF;

  v_nfe := public._lr_nfse_rascunho(o.id, v_pedido, v_liquido);
  RETURN jsonb_build_object('pedido_id', v_pedido, 'nfe_id', v_nfe, 'comissao', coalesce(v_valor, 0), 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.lr_ordem_retirar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_retirar(uuid, uuid, uuid) TO authenticated;

-- Venda cancelada no caixa: além da ordem, a assinatura vendida nela é cancelada (a lavagem já usada continua usada).
CREATE OR REPLACE FUNCTION public.lr_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado' THEN
    IF EXISTS (SELECT 1 FROM public.lr_ordens WHERE venda_id = NEW.id) THEN
      UPDATE public.lr_comissoes SET situacao = 'cancelada' WHERE pedido_id = NEW.id AND situacao IN ('a_aprovar', 'aprovada');
      DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
      UPDATE public.lr_ordens SET situacao = 'pronto', venda_id = NULL, entregue_em = NULL WHERE venda_id = NEW.id AND situacao = 'entregue';
    END IF;
    IF EXISTS (SELECT 1 FROM public.lr_assinaturas WHERE venda_id = NEW.id) THEN
      DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
      UPDATE public.lr_assinaturas SET situacao = 'cancelada', motivo = 'Venda cancelada no caixa' WHERE venda_id = NEW.id AND situacao = 'ativa';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lr_venda_cancelada() FROM PUBLIC, anon, authenticated;
