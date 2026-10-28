-- Lava rápido (Fase 1): veículos (carro, moto, caminhonete, avião, helicóptero), serviços com preço por tipo de veículo,
-- lavadores com comissão, ordem de lavagem com quadro de pátio e cobrança pela frente de caixa com NFS-e em rascunho.
-- Escrita só por funções (papel + trava do salão + módulo liberado). O serviço é um produto sem controle de estoque.

-- ============ módulo "lavarapido" nas escolhas da empresa ============
ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_modulos_sem_cnpj_validos;
ALTER TABLE public.empresas ADD CONSTRAINT empresas_modulos_sem_cnpj_validos
  CHECK (modulos_sem_cnpj <@ ARRAY['assistencia','locacao','restaurante','petshop','clinica','lavarapido']::text[]);

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.empresa_modulos_liberados'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.empresa_modulos_liberados DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.empresa_modulos_liberados ADD CONSTRAINT empresa_modulos_liberados_modulo_check
    CHECK (modulo IN ('assistencia','locacao','restaurante','petshop','clinica','obras','lavarapido'));
END $$;

-- Mesma regra de src/lib/cnae-regras.ts: liberação explícita, escolha manual sem CNPJ ou CNAE 45.20-0/06.
CREATE OR REPLACE FUNCTION public.lava_rapido_liberado() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (
 EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'lavarapido')
 OR (length(regexp_replace(coalesce(e.cnpj,''), '[^0-9A-Za-z]','','g')) < 14 AND 'lavarapido' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '4520006%')))
$function$;
REVOKE ALL ON FUNCTION public.lava_rapido_liberado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lava_rapido_liberado() TO authenticated;

CREATE OR REPLACE FUNCTION public._lr_exige_liberado() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF NOT public.lava_rapido_liberado() THEN RAISE EXCEPTION 'O módulo Lava rápido não está liberado para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._lr_exige_liberado() FROM PUBLIC, anon, authenticated;

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.lr_veiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  tipo text NOT NULL DEFAULT 'carro' CHECK (tipo IN ('carro', 'moto', 'caminhonete', 'aviao', 'helicoptero')),
  -- placa (carro, moto, caminhonete) ou prefixo/matrícula (avião, helicóptero), só letras e números em maiúsculas
  identificacao text NOT NULL CHECK (identificacao ~ '^[A-Z0-9]{4,7}$'),
  descricao text,
  cor text,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_veiculos_identificacao_idx ON public.lr_veiculos (tenant_id, identificacao);
CREATE INDEX IF NOT EXISTS lr_veiculos_cliente_idx ON public.lr_veiculos (cliente_id);

CREATE TABLE IF NOT EXISTS public.lr_servicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  categoria text NOT NULL DEFAULT 'lavagem' CHECK (categoria IN ('lavagem', 'polimento', 'higienizacao', 'estetica', 'outro')),
  duracao_min integer NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 5 AND 1440),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_servicos_nome_idx ON public.lr_servicos (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS lr_servicos_produto_idx ON public.lr_servicos (produto_id);

-- Tipo vazio vale para qualquer veículo; o preço do tipo do veículo vence o geral.
CREATE TABLE IF NOT EXISTS public.lr_servico_precos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.lr_servicos(id) ON DELETE CASCADE,
  tipo text CHECK (tipo IN ('carro', 'moto', 'caminhonete', 'aviao', 'helicoptero')),
  preco numeric(14,2) NOT NULL CHECK (preco >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_servico_precos_tipo_idx ON public.lr_servico_precos (servico_id, coalesce(tipo, ''));

CREATE TABLE IF NOT EXISTS public.lr_lavadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  comissao_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK (comissao_percentual BETWEEN 0 AND 100),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_lavadores_tenant_idx ON public.lr_lavadores (tenant_id, ativo, nome);

CREATE TABLE IF NOT EXISTS public.lr_ordens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.lr_veiculos(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  lavador_id uuid REFERENCES public.lr_lavadores(id),
  box text,
  situacao text NOT NULL DEFAULT 'aguardando' CHECK (situacao IN ('aguardando', 'lavando', 'secando', 'pronto', 'entregue', 'cancelada')),
  observacoes text,
  motivo_cancelamento text,
  entrada_em timestamptz NOT NULL DEFAULT now(),
  pronto_em timestamptz,
  entregue_em timestamptz,
  venda_id uuid REFERENCES public.pedidos(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_ordens_tenant_idx ON public.lr_ordens (tenant_id, situacao, entrada_em DESC);
CREATE INDEX IF NOT EXISTS lr_ordens_veiculo_idx ON public.lr_ordens (veiculo_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_ordens_venda_idx ON public.lr_ordens (venda_id) WHERE venda_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lr_ordem_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.lr_ordens(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.lr_servicos(id),
  preco_aplicado numeric(14,2) NOT NULL CHECK (preco_aplicado >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_ordem_itens_ordem_idx ON public.lr_ordem_itens (ordem_id);

CREATE TABLE IF NOT EXISTS public.lr_comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  lavador_id uuid NOT NULL REFERENCES public.lr_lavadores(id),
  ordem_id uuid NOT NULL UNIQUE REFERENCES public.lr_ordens(id),
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id),
  base numeric(14,2) NOT NULL CHECK (base >= 0),
  percentual numeric(5,2) NOT NULL CHECK (percentual BETWEEN 0 AND 100),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  situacao text NOT NULL DEFAULT 'a_aprovar' CHECK (situacao IN ('a_aprovar', 'aprovada', 'paga', 'cancelada')),
  aprovada_em timestamptz,
  aprovada_por uuid,
  pago_em timestamptz,
  pago_por uuid,
  forma_pagamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_comissoes_lavador_idx ON public.lr_comissoes (tenant_id, lavador_id, situacao);

-- ============ acesso: leitura da empresa, escrita só pelas funções ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_veiculos', 'lr_servicos', 'lr_servico_precos', 'lr_lavadores', 'lr_ordens', 'lr_ordem_itens', 'lr_comissoes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF t = 'lr_comissoes' THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (tenant_id = public.current_tenant_id()
               AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                    OR public.has_role(auth.uid(), 'financeiro')))$p$, t || '_ler', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    END IF;
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $$;

-- ============ cadastros ============
-- Veículo: a recepção também cadastra. Identificação: placa (3 letras + 4 números, ou padrão Mercosul) ou prefixo da aeronave.
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
  IF v_cliente IS NULL OR NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o cliente dono do veículo';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lr_veiculos x WHERE x.tenant_id = v_tenant AND x.identificacao = v_ident AND x.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um veículo com esta identificação';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.lr_veiculos (tenant_id, cliente_id, tipo, identificacao, descricao, cor, observacoes, ativo)
    VALUES (v_tenant, v_cliente, v_tipo, v_ident, nullif(btrim(p_dados ->> 'descricao'), ''), nullif(btrim(p_dados ->> 'cor'), ''),
            nullif(btrim(p_dados ->> 'observacoes'), ''), coalesce((p_dados ->> 'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_veiculos SET cliente_id = v_cliente, tipo = v_tipo, identificacao = v_ident,
           descricao = nullif(btrim(p_dados ->> 'descricao'), ''), cor = nullif(btrim(p_dados ->> 'cor'), ''),
           observacoes = nullif(btrim(p_dados ->> 'observacoes'), ''), ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_veiculo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_veiculo_salvar(jsonb) TO authenticated;

-- Serviço: cria (ou atualiza) o produto que entra na frente de caixa, sem controle de estoque.
CREATE OR REPLACE FUNCTION public.lr_servico_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_cat text := coalesce(nullif(p_dados ->> 'categoria', ''), 'lavagem');
  v_dur integer := coalesce(nullif(p_dados ->> 'duracao_min', '')::integer, 30);
  v_base numeric := coalesce(nullif(p_dados ->> 'preco_base', '')::numeric, 0);
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_prod uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do serviço'; END IF;
  IF v_cat NOT IN ('lavagem', 'polimento', 'higienizacao', 'estetica', 'outro') THEN RAISE EXCEPTION 'Categoria inválida'; END IF;
  IF v_dur < 5 OR v_dur > 1440 THEN RAISE EXCEPTION 'A duração precisa ficar entre 5 e 1440 minutos'; END IF;
  IF v_base < 0 THEN RAISE EXCEPTION 'O preço não pode ser negativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_servico:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.lr_servicos s WHERE s.tenant_id = v_tenant AND lower(btrim(s.nome)) = lower(v_nome) AND s.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um serviço com este nome';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque, ativo)
    VALUES (v_tenant, '', v_nome, 'UN', v_base, false, v_ativo)
    RETURNING id INTO v_prod;
    INSERT INTO public.lr_servicos (tenant_id, nome, categoria, duracao_min, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_cat, v_dur, v_prod, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_servicos SET nome = v_nome, categoria = v_cat, duracao_min = v_dur, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant
    RETURNING produto_id INTO v_prod;
    IF v_prod IS NULL THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
    UPDATE public.produtos SET descricao = v_nome, preco_venda = v_base, ativo = v_ativo WHERE id = v_prod AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_servico_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_servico_salvar(jsonb) TO authenticated;

-- Preço por tipo de veículo (tipo vazio = qualquer veículo).
CREATE OR REPLACE FUNCTION public.lr_preco_salvar(p_servico_id uuid, p_tipo text, p_preco numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_tipo text := nullif(btrim(p_tipo), '');
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF p_preco IS NULL OR p_preco < 0 THEN RAISE EXCEPTION 'Informe um preço válido'; END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('carro', 'moto', 'caminhonete', 'aviao', 'helicoptero') THEN RAISE EXCEPTION 'Tipo de veículo inválido'; END IF;
  PERFORM 1 FROM public.lr_servicos WHERE id = p_servico_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_preco:' || p_servico_id::text, 0));

  SELECT id INTO v_id FROM public.lr_servico_precos WHERE servico_id = p_servico_id AND coalesce(tipo, '') = coalesce(v_tipo, '');
  IF v_id IS NULL THEN
    INSERT INTO public.lr_servico_precos (tenant_id, servico_id, tipo, preco) VALUES (v_tenant, p_servico_id, v_tipo, round(p_preco, 2))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_servico_precos SET preco = round(p_preco, 2) WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_preco_salvar(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_preco_salvar(uuid, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_preco_remover(p_preco_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  DELETE FROM public.lr_servico_precos WHERE id = p_preco_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Preço não encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_preco_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_preco_remover(uuid) TO authenticated;

-- Preço que vale para o veículo: o do tipo dele, senão o geral, senão o preço de balcão do serviço.
-- Interna: usada ao abrir a ordem (a mesma regra de src/lib/lava-rapido.ts).
CREATE OR REPLACE FUNCTION public._lr_preco(p_servico_id uuid, p_tipo text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT p.preco FROM public.lr_servico_precos p WHERE p.servico_id = p_servico_id AND p.tipo = p_tipo),
    (SELECT p.preco FROM public.lr_servico_precos p WHERE p.servico_id = p_servico_id AND p.tipo IS NULL),
    (SELECT pr.preco_venda FROM public.lr_servicos s JOIN public.produtos pr ON pr.id = s.produto_id WHERE s.id = p_servico_id),
    0)
$$;
REVOKE ALL ON FUNCTION public._lr_preco(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lr_lavador_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_com numeric := coalesce(nullif(p_dados ->> 'comissao_percentual', '')::numeric, 0);
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do lavador'; END IF;
  IF v_com < 0 OR v_com > 100 THEN RAISE EXCEPTION 'A comissão precisa ficar entre 0 e 100%%'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.lr_lavadores (tenant_id, nome, comissao_percentual, ativo)
    VALUES (v_tenant, v_nome, v_com, coalesce((p_dados ->> 'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_lavadores SET nome = v_nome, comissao_percentual = v_com, ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lavador não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_lavador_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_lavador_salvar(jsonb) TO authenticated;

-- ============ ordem de lavagem ============
-- Abre a ordem com os serviços escolhidos; cada item guarda o preço combinado (o do tipo do veículo na hora da abertura).
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
  s uuid;
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
  IF EXISTS (SELECT 1 FROM public.lr_ordens o WHERE o.veiculo_id = v_veic.id AND o.situacao IN ('aguardando', 'lavando', 'secando', 'pronto')) THEN
    RAISE EXCEPTION 'Este veículo já tem uma ordem aberta';
  END IF;

  INSERT INTO public.lr_ordens (tenant_id, veiculo_id, cliente_id, lavador_id, box, observacoes)
  VALUES (v_tenant, v_veic.id, v_veic.cliente_id, v_lavador, nullif(btrim(p_dados ->> 'box'), ''), nullif(btrim(p_dados ->> 'observacoes'), ''))
  RETURNING id INTO v_id;
  FOREACH s IN ARRAY v_ids LOOP
    INSERT INTO public.lr_ordem_itens (tenant_id, ordem_id, servico_id, preco_aplicado)
    VALUES (v_tenant, v_id, s, public._lr_preco(s, v_veic.tipo));
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_ordem_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_criar(jsonb) TO authenticated;

-- Quadro do pátio: aguardando ↔ lavando ↔ secando → pronto. "entregue" só pela cobrança (lr_ordem_retirar).
CREATE OR REPLACE FUNCTION public.lr_ordem_situacao(p_id uuid, p_para text, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o public.lr_ordens%ROWTYPE;
  v_ok boolean;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  v_ok := CASE o.situacao
    WHEN 'aguardando' THEN p_para IN ('lavando', 'cancelada')
    WHEN 'lavando' THEN p_para IN ('aguardando', 'secando', 'pronto', 'cancelada')
    WHEN 'secando' THEN p_para IN ('lavando', 'pronto', 'cancelada')
    WHEN 'pronto' THEN p_para IN ('secando', 'cancelada')
    ELSE false END;
  IF NOT v_ok THEN RAISE EXCEPTION 'Não dá para mudar a ordem de "%" para "%"', o.situacao, p_para; END IF;
  IF p_para = 'lavando' AND o.lavador_id IS NULL THEN RAISE EXCEPTION 'Escolha o lavador antes de começar a lavagem'; END IF;

  UPDATE public.lr_ordens
     SET situacao = p_para,
         pronto_em = CASE WHEN p_para = 'pronto' THEN now() ELSE NULL END,
         motivo_cancelamento = CASE WHEN p_para = 'cancelada' THEN nullif(btrim(p_motivo), '') ELSE NULL END
   WHERE id = o.id;
END $$;
REVOKE ALL ON FUNCTION public.lr_ordem_situacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_situacao(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_ordem_atribuir(p_id uuid, p_lavador_id uuid, p_box text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF p_lavador_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lr_lavadores l WHERE l.id = p_lavador_id AND l.tenant_id = v_tenant AND l.ativo) THEN
    RAISE EXCEPTION 'Lavador não encontrado ou inativo';
  END IF;
  UPDATE public.lr_ordens SET lavador_id = p_lavador_id, box = nullif(btrim(p_box), '')
   WHERE id = p_id AND tenant_id = v_tenant AND situacao IN ('aguardando', 'lavando', 'secando', 'pronto');
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada ou já encerrada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_ordem_atribuir(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_atribuir(uuid, uuid, text) TO authenticated;

-- ============ cobrança ============
-- NFS-e do serviço, como rascunho (com as pendências de configuração) ou pronta, no molde do pet shop e da locação.
-- Interna: só é chamada por lr_ordem_retirar.
CREATE OR REPLACE FUNCTION public._lr_nfse_rascunho(p_ordem_id uuid, p_pedido_id uuid, p_liquido numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  v_veic public.lr_veiculos%ROWTYPE;
  v_ped record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_bruto numeric;
BEGIN
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant;
  SELECT * INTO v_veic FROM public.lr_veiculos WHERE id = o.veiculo_id;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  SELECT * INTO v_cli FROM public.clientes WHERE id = o.cliente_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas
   WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_fil_cfg FROM public.fiscal_config WHERE tenant_id = v_tenant AND filial_id = v_ped.filial_id LIMIT 1;
  SELECT * INTO v_emp_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND filial_id IS NULL AND (empresa_id = v_emp.id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;
  IF v_fil_cfg IS NULL AND v_emp_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_emp_cfg;
  END IF;
  -- registro não encontrado vira linha de campos nulos: escolhe pela chave, não por coalesce
  IF v_fil_cfg.id IS NOT NULL THEN v_cfg := v_fil_cfg; ELSE v_cfg := v_emp_cfg; END IF;

  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''), coalesce(v_fil.cidade, v_emp.cidade, ''));

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\W', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  END IF;
  IF coalesce(v_emp.cnpj, '') = '' THEN v_pend := array_append(v_pend, 'CNPJ da empresa ausente'); END IF;
  IF coalesce(v_emp.inscricao_municipal, '') = '' THEN
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  END IF;
  IF v_codigo = '' THEN v_pend := array_append(v_pend, 'Código do serviço municipal não configurado'); END IF;
  IF v_iss <= 0 THEN v_pend := array_append(v_pend, 'Alíquota de ISS não configurada'); END IF;
  IF v_cert = '' THEN v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado'); END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    UPDATE public.fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = v_cfg.id;
  END IF;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.lr_ordem_itens WHERE ordem_id = o.id;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, o.cliente_id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    'Prestação de serviço — lavagem, polimento e higienização de veículos', NULL,
    v_bruto, greatest(v_bruto - p_liquido, 0), p_liquido, round(p_liquido * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj, 'inscricao_municipal', v_emp.inscricao_municipal,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero, 'bairro', v_cli.bairro, 'cidade', v_cli.cidade,
      'estado', v_cli.estado, 'cep', v_cli.cep, 'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      ELSE 'NFS-e em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_pedidos (tenant_id, nfe_id, pedido_id) VALUES (v_tenant, v_nfe, p_pedido_id);

  INSERT INTO public.nfe_itens (tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, total, cst_csosn)
  SELECT v_tenant, v_nfe, s.nome || ' — ' || v_veic.identificacao, 'UN', 1, i.preco_aplicado, i.preco_aplicado, '400'
    FROM public.lr_ordem_itens i
    JOIN public.lr_servicos s ON s.id = i.servico_id
   WHERE i.ordem_id = o.id;

  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN v_nfe;
END $$;
REVOKE ALL ON FUNCTION public._lr_nfse_rascunho(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Entregar e cobrar: liga a ordem "pronta" à venda do caixa (por pedido ou pela chave da venda).
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
  v_bruto numeric; v_liquido numeric; v_valor numeric; v_nfe uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.situacao = 'entregue' AND o.venda_id IS NOT NULL AND (o.venda_id = p_pedido_id OR p_pedido_id IS NULL) THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    RETURN jsonb_build_object('pedido_id', o.venda_id,
      'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = o.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1), 'repetido', true);
  END IF;
  IF o.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para entregar e cobrar ordem pronta (situação atual: %)', o.situacao; END IF;

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

  -- a venda precisa ter cada serviço da ordem, pelo valor combinado
  FOR r IN SELECT i.servico_id, i.preco_aplicado, s.produto_id, s.nome
             FROM public.lr_ordem_itens i JOIN public.lr_servicos s ON s.id = i.servico_id
            WHERE i.ordem_id = o.id LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                    AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
      RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
    END IF;
  END LOOP;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.lr_ordem_itens WHERE ordem_id = o.id;
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

-- Venda cancelada no caixa: a ordem volta a "pronta", a comissão não paga é cancelada e o rascunho da NFS-e sai.
CREATE OR REPLACE FUNCTION public.lr_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado'
     AND EXISTS (SELECT 1 FROM public.lr_ordens WHERE venda_id = NEW.id) THEN
    UPDATE public.lr_comissoes SET situacao = 'cancelada' WHERE pedido_id = NEW.id AND situacao IN ('a_aprovar', 'aprovada');
    DELETE FROM public.nfe WHERE pedido_id = NEW.id AND modelo = 'nfse' AND situacao IN ('rascunho', 'pronta');
    UPDATE public.lr_ordens SET situacao = 'pronto', venda_id = NULL, entregue_em = NULL WHERE venda_id = NEW.id AND situacao = 'entregue';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lr_venda_cancelada() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_lr_venda_cancelada AFTER UPDATE OF situacao ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.lr_venda_cancelada();

-- Comissão: a_aprovar → aprovada → paga (o pagamento em si é feito fora; aqui fica o registro de quem e quando).
CREATE OR REPLACE FUNCTION public.lr_comissao_aprovar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  PERFORM public._lr_exige_liberado();
  UPDATE public.lr_comissoes SET situacao = 'aprovada', aprovada_em = now(), aprovada_por = auth.uid()
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'a_aprovar';
  IF NOT FOUND THEN RAISE EXCEPTION 'Comissão não encontrada ou já tratada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_comissao_aprovar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_comissao_aprovar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_comissao_pagar(p_id uuid, p_forma text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  PERFORM public._lr_exige_liberado();
  UPDATE public.lr_comissoes SET situacao = 'paga', pago_em = now(), pago_por = auth.uid(), forma_pagamento = nullif(btrim(p_forma), '')
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'aprovada';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só dá para pagar comissão aprovada'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_comissao_pagar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_comissao_pagar(uuid, text) TO authenticated;
