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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._lr_assinatura_restam(p_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT a.lavagens - (SELECT count(*)::int FROM public.lr_assinatura_usos u WHERE u.assinatura_id = a.id AND NOT u.desfeito)
    FROM public.lr_assinaturas a WHERE a.id = p_id
$$;
REVOKE ALL ON FUNCTION public._lr_assinatura_restam(uuid) FROM PUBLIC, anon, authenticated;

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
    UPDATE public.lr_fidelidade_config
       SET ativo = p_ativo, lavagens_para_brinde = p_lavagens, servico_id = p_servico_id,
           ativo_desde = CASE WHEN p_ativo AND NOT c.ativo THEN now() ELSE c.ativo_desde END
     WHERE tenant_id = v_tenant;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_fidelidade_salvar(boolean, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fidelidade_salvar(boolean, integer, uuid) TO authenticated;

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