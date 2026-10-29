-- Manufatura (Fase 1, móveis e marcenaria): lista de materiais, ordem de produção sob medida ou de linha padrão, reserva e baixa de insumos,
-- entrada do produto acabado (só na linha padrão) e custo da ordem. Piloto fechado: o módulo só abre por liberação explícita da equipe
-- (empresa_modulos_liberados), sem CNAE nem "Módulos sem CNPJ". Escrita só por funções (papel + trava do salão + módulo liberado).
-- Especificação: docs/especificacao-modulo-manufatura.md.
-- Pode ser rodado de novo sem erro (tabelas, funções, políticas e gatilhos são refeitos). Rode antes 20261203000000_manufatura_papel_producao.sql.

-- ============ módulo "manufatura" nas liberações explícitas ============
-- Fica de fora de empresas.modulos_sem_cnpj de propósito: no piloto só a equipe libera.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.empresa_modulos_liberados'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.empresa_modulos_liberados DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.empresa_modulos_liberados ADD CONSTRAINT empresa_modulos_liberados_modulo_check
    CHECK (modulo IN ('assistencia','locacao','restaurante','petshop','clinica','obras','lavarapido','manufatura'));
END $$;

CREATE OR REPLACE FUNCTION public.manufatura_liberada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
  SELECT EXISTS (SELECT 1 FROM public.empresas e
                  WHERE e.tenant_id = public.current_tenant_id()
                    AND EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'manufatura'))
$function$;
REVOKE ALL ON FUNCTION public.manufatura_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufatura_liberada() TO authenticated;

CREATE OR REPLACE FUNCTION public._mf_exige_liberado() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF NOT public.manufatura_liberada() THEN RAISE EXCEPTION 'O módulo Manufatura não está liberado para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._mf_exige_liberado() FROM PUBLIC, anon, authenticated;

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.mf_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  versao integer NOT NULL CHECK (versao > 0),
  rotulo text,
  -- quantidade produzida por receita: os itens são por receita, a ordem usa item ÷ rendimento por unidade
  rendimento numeric(14,4) NOT NULL DEFAULT 1 CHECK (rendimento > 0),
  situacao text NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'ativa', 'obsoleta')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_boms_versao_idx ON public.mf_boms (tenant_id, produto_id, versao);
CREATE UNIQUE INDEX IF NOT EXISTS mf_boms_ativa_idx ON public.mf_boms (tenant_id, produto_id) WHERE situacao = 'ativa';

CREATE TABLE IF NOT EXISTS public.mf_bom_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES public.mf_boms(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.produtos(id),
  -- por receita, na unidade de estoque do insumo (chapa, m², m³, metro, unidade)
  quantidade numeric(14,4) NOT NULL CHECK (quantidade > 0),
  -- perda de corte e de preparo: o consumo real é a quantidade ÷ (1 − perda), como na ficha técnica
  perda_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK (perda_percentual >= 0 AND perda_percentual < 90),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_bom_itens_insumo_idx ON public.mf_bom_itens (bom_id, insumo_id);

CREATE TABLE IF NOT EXISTS public.mf_ordens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  numero bigint NOT NULL,
  descricao text NOT NULL CHECK (length(btrim(descricao)) > 0),
  -- só quando há produto acabado cadastrado (linha padrão); o móvel sob medida não precisa de produto
  produto_id uuid REFERENCES public.produtos(id),
  bom_id uuid REFERENCES public.mf_boms(id),
  quantidade_planejada numeric(14,3) NOT NULL CHECK (quantidade_planejada > 0),
  quantidade_produzida numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade_produzida >= 0),
  quantidade_refugo numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade_refugo >= 0),
  situacao text NOT NULL DEFAULT 'planejada' CHECK (situacao IN ('planejada', 'liberada', 'em_producao', 'concluida', 'cancelada')),
  -- falso na encomenda: o móvel vai para o cliente e não entra no estoque
  entrada_estoque boolean NOT NULL DEFAULT false,
  deposito_insumos_id uuid NOT NULL REFERENCES public.depositos(id),
  deposito_destino_id uuid REFERENCES public.depositos(id),
  pedido_id uuid REFERENCES public.pedidos(id),
  medidas text,
  acabamento text,
  prazo date,
  custo_padrao numeric(14,2) NOT NULL DEFAULT 0,
  custo_real numeric(14,2) NOT NULL DEFAULT 0,
  mao_de_obra numeric(14,2) NOT NULL DEFAULT 0 CHECK (mao_de_obra >= 0),
  criada_por uuid,
  liberada_em timestamptz,
  concluida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mf_ordens_entrada_ck CHECK (NOT entrada_estoque OR (produto_id IS NOT NULL AND deposito_destino_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_ordens_numero_idx ON public.mf_ordens (tenant_id, numero);
CREATE INDEX IF NOT EXISTS mf_ordens_situacao_idx ON public.mf_ordens (tenant_id, situacao);
CREATE INDEX IF NOT EXISTS mf_ordens_pedido_idx ON public.mf_ordens (pedido_id);

-- Itens da ordem: editáveis só enquanto a ordem está planejada; depois da liberação só o consumo muda.
CREATE TABLE IF NOT EXISTS public.mf_ordem_insumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.mf_ordens(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.produtos(id),
  -- por unidade produzida, antes da perda
  quantidade_base numeric(14,6) NOT NULL CHECK (quantidade_base > 0),
  perda_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK (perda_percentual >= 0 AND perda_percentual < 90),
  quantidade_planejada numeric(14,3) NOT NULL CHECK (quantidade_planejada >= 0),
  quantidade_consumida numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade_consumida >= 0),
  -- parte da reserva que ainda está no estoque (libera conforme consome, conclui ou cancela)
  quantidade_reservada numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade_reservada >= 0),
  custo_unitario_padrao numeric(14,4) NOT NULL DEFAULT 0,
  custo_consumido numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_ordem_insumos_idx ON public.mf_ordem_insumos (ordem_id, insumo_id);

CREATE TABLE IF NOT EXISTS public.mf_apontamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.mf_ordens(id) ON DELETE CASCADE,
  quantidade_boa numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade_boa >= 0),
  refugo numeric(14,3) NOT NULL DEFAULT 0 CHECK (refugo >= 0),
  minutos integer CHECK (minutos IS NULL OR minutos >= 0),
  -- repetir o envio (rede ruim, duplo clique) com a mesma chave não consome duas vezes
  chave_idempotente text NOT NULL CHECK (length(btrim(chave_idempotente)) > 0),
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mf_apontamentos_algo_ck CHECK (quantidade_boa + refugo > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_apontamentos_chave_idx ON public.mf_apontamentos (tenant_id, chave_idempotente);
CREATE INDEX IF NOT EXISTS mf_apontamentos_ordem_idx ON public.mf_apontamentos (ordem_id);

-- ============ acesso: leitura por perfil, escrita só pelas funções ============
-- Custo (ordens e itens da ordem) só para administrador e gestor; o encarregado da oficina lê pelas funções sem custo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mf_boms', 'mf_bom_itens', 'mf_ordens', 'mf_ordem_insumos', 'mf_apontamentos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    IF t IN ('mf_ordens', 'mf_ordem_insumos') THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (tenant_id = public.current_tenant_id()
               AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))$p$, t || '_ler', t);
    ELSE
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (tenant_id = public.current_tenant_id()
               AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
                    OR public.has_role(auth.uid(), 'producao')))$p$, t || '_ler', t);
    END IF;
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    IF t IN ('mf_boms', 'mf_ordens') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated', t);
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
    END IF;
  END LOOP;
END $$;

-- ============ apoio (sem acesso direto) ============
-- Custo de referência de um insumo: o custo médio do depósito, ou o custo do cadastro se ainda não houver.
CREATE OR REPLACE FUNCTION public._mf_custo(p_produto uuid, p_deposito uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT CASE WHEN coalesce(e.custo_medio, 0) > 0 THEN e.custo_medio ELSE coalesce(p.custo, 0) END
    FROM public.produtos p
    LEFT JOIN public.estoques e ON e.produto_id = p.id AND e.deposito_id = p_deposito AND e.tenant_id = p.tenant_id
   WHERE p.id = p_produto AND p.tenant_id = public.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION public._mf_custo(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Grava os itens da ordem (apaga e refaz) e recalcula o custo padrão. Cada item: insumo_id, quantidade (por unidade produzida), perda_percentual.
CREATE OR REPLACE FUNCTION public._mf_gravar_itens(p_ordem uuid, p_itens jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
  i jsonb;
  v_insumo uuid; v_base numeric; v_perda numeric; v_plan numeric;
BEGIN
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_ordem AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  DELETE FROM public.mf_ordem_insumos WHERE ordem_id = p_ordem AND tenant_id = v_tenant;
  FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) LOOP
    v_insumo := nullif(i ->> 'insumo_id', '')::uuid;
    v_base := coalesce(nullif(i ->> 'quantidade', '')::numeric, 0);
    v_perda := coalesce(nullif(i ->> 'perda_percentual', '')::numeric, 0);
    IF v_insumo IS NULL THEN RAISE EXCEPTION 'Informe o insumo de cada item'; END IF;
    IF v_base <= 0 THEN RAISE EXCEPTION 'A quantidade de cada item precisa ser maior que zero'; END IF;
    IF v_perda < 0 OR v_perda >= 90 THEN RAISE EXCEPTION 'A perda precisa ficar entre 0 e 90%%'; END IF;
    IF v_insumo = o.produto_id THEN RAISE EXCEPTION 'O produto acabado não pode ser insumo dele mesmo'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_insumo AND tenant_id = v_tenant AND controla_estoque) THEN
      RAISE EXCEPTION 'Insumo não encontrado ou sem controle de estoque';
    END IF;
    IF EXISTS (SELECT 1 FROM public.mf_ordem_insumos WHERE ordem_id = p_ordem AND insumo_id = v_insumo) THEN
      RAISE EXCEPTION 'O mesmo insumo aparece mais de uma vez';
    END IF;
    v_plan := round(v_base * o.quantidade_planejada * 100 / (100 - v_perda), 3);
    INSERT INTO public.mf_ordem_insumos (tenant_id, ordem_id, insumo_id, quantidade_base, perda_percentual, quantidade_planejada, custo_unitario_padrao)
    VALUES (v_tenant, p_ordem, v_insumo, round(v_base, 6), v_perda, v_plan, round(coalesce(public._mf_custo(v_insumo, o.deposito_insumos_id), 0), 4));
  END LOOP;
  UPDATE public.mf_ordens SET custo_padrao = round(coalesce((
      SELECT sum(quantidade_planejada * custo_unitario_padrao) FROM public.mf_ordem_insumos WHERE ordem_id = p_ordem), 0) + mao_de_obra, 2)
   WHERE id = p_ordem;
END $$;
REVOKE ALL ON FUNCTION public._mf_gravar_itens(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ============ lista de materiais ============
-- Cria (sem id) ou edita um rascunho. Itens: insumo_id, quantidade (por receita), perda_percentual.
CREATE OR REPLACE FUNCTION public.mf_bom_salvar(p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_produto uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_rotulo text := nullif(btrim(coalesce(p_dados ->> 'rotulo', '')), '');
  v_rend numeric := coalesce(nullif(p_dados ->> 'rendimento', '')::numeric, 1);
  v_sit text;
  i jsonb; v_insumo uuid; v_qtd numeric; v_perda numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF v_rend <= 0 THEN RAISE EXCEPTION 'O rendimento precisa ser maior que zero'; END IF;
  IF v_id IS NULL THEN
    IF v_produto IS NULL THEN RAISE EXCEPTION 'Informe o produto acabado'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_produto AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('mf_bom:' || v_tenant::text || v_produto::text, 0));
    INSERT INTO public.mf_boms (tenant_id, produto_id, versao, rotulo, rendimento)
    VALUES (v_tenant, v_produto, coalesce((SELECT max(versao) FROM public.mf_boms WHERE tenant_id = v_tenant AND produto_id = v_produto), 0) + 1, v_rotulo, v_rend)
    RETURNING id INTO v_id;
  ELSE
    SELECT situacao, produto_id INTO v_sit, v_produto FROM public.mf_boms WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lista de materiais não encontrada'; END IF;
    IF v_sit <> 'rascunho' THEN RAISE EXCEPTION 'Só o rascunho pode ser editado: crie uma nova versão'; END IF;
    UPDATE public.mf_boms SET rotulo = v_rotulo, rendimento = v_rend WHERE id = v_id;
    DELETE FROM public.mf_bom_itens WHERE bom_id = v_id AND tenant_id = v_tenant;
  END IF;
  FOR i IN SELECT * FROM jsonb_array_elements(coalesce(p_dados -> 'itens', '[]'::jsonb)) LOOP
    v_insumo := nullif(i ->> 'insumo_id', '')::uuid;
    v_qtd := coalesce(nullif(i ->> 'quantidade', '')::numeric, 0);
    v_perda := coalesce(nullif(i ->> 'perda_percentual', '')::numeric, 0);
    IF v_insumo IS NULL THEN RAISE EXCEPTION 'Informe o insumo de cada item'; END IF;
    IF v_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade de cada item precisa ser maior que zero'; END IF;
    IF v_perda < 0 OR v_perda >= 90 THEN RAISE EXCEPTION 'A perda precisa ficar entre 0 e 90%%'; END IF;
    IF v_insumo = v_produto THEN RAISE EXCEPTION 'O produto acabado não pode ser insumo dele mesmo'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_insumo AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Insumo não encontrado'; END IF;
    IF EXISTS (SELECT 1 FROM public.mf_bom_itens WHERE bom_id = v_id AND insumo_id = v_insumo) THEN RAISE EXCEPTION 'O mesmo insumo aparece mais de uma vez'; END IF;
    INSERT INTO public.mf_bom_itens (tenant_id, bom_id, insumo_id, quantidade, perda_percentual) VALUES (v_tenant, v_id, v_insumo, v_qtd, v_perda);
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_bom_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_bom_salvar(jsonb) TO authenticated;

-- Ativa o rascunho e torna obsoleta a versão que estava ativa do mesmo produto.
CREATE OR REPLACE FUNCTION public.mf_bom_ativar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  b public.mf_boms;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO b FROM public.mf_boms WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lista de materiais não encontrada'; END IF;
  IF b.situacao <> 'rascunho' THEN RAISE EXCEPTION 'Só o rascunho pode ser ativado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mf_bom_itens WHERE bom_id = p_id) THEN RAISE EXCEPTION 'Inclua ao menos um item antes de ativar'; END IF;
  UPDATE public.mf_boms SET situacao = 'obsoleta' WHERE tenant_id = v_tenant AND produto_id = b.produto_id AND situacao = 'ativa';
  UPDATE public.mf_boms SET situacao = 'ativa' WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_bom_ativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_bom_ativar(uuid) TO authenticated;

-- ============ ordem de produção ============
-- Cria a ordem (planejada). Com bom_id, os itens vêm da lista (item ÷ rendimento por unidade); com itens, vêm do projeto.
-- Dados: descricao, produto_id?, bom_id?, quantidade_planejada, entrada_estoque?, deposito_insumos_id, deposito_destino_id?,
-- pedido_id?, medidas?, acabamento?, prazo?, mao_de_obra?, itens? (insumo_id, quantidade por unidade, perda_percentual).
CREATE OR REPLACE FUNCTION public.mf_ordem_criar(p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_produto uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_bom uuid := nullif(p_dados ->> 'bom_id', '')::uuid;
  v_qtd numeric := coalesce(nullif(p_dados ->> 'quantidade_planejada', '')::numeric, 0);
  v_entrada boolean := coalesce((p_dados ->> 'entrada_estoque')::boolean, false);
  v_dep_ins uuid := nullif(p_dados ->> 'deposito_insumos_id', '')::uuid;
  v_dep_dest uuid := nullif(p_dados ->> 'deposito_destino_id', '')::uuid;
  v_pedido uuid := nullif(p_dados ->> 'pedido_id', '')::uuid;
  v_mao numeric := coalesce(nullif(p_dados ->> 'mao_de_obra', '')::numeric, 0);
  v_prazo date := nullif(p_dados ->> 'prazo', '')::date;
  v_itens jsonb := p_dados -> 'itens';
  v_id uuid; v_numero bigint; b public.mf_boms;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF v_desc = '' THEN RAISE EXCEPTION 'Descreva a ordem de produção'; END IF;
  IF v_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade planejada precisa ser maior que zero'; END IF;
  IF v_mao < 0 THEN RAISE EXCEPTION 'A mão de obra não pode ser negativa'; END IF;
  IF v_dep_ins IS NULL OR NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = v_dep_ins AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o depósito dos insumos';
  END IF;
  IF v_entrada THEN
    IF v_produto IS NULL THEN RAISE EXCEPTION 'Escolha o produto acabado para dar entrada no estoque'; END IF;
    IF v_dep_dest IS NULL OR NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = v_dep_dest AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Escolha o depósito de destino do produto acabado';
    END IF;
  ELSE
    v_dep_dest := NULL;
  END IF;
  IF v_produto IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_produto AND tenant_id = v_tenant AND (NOT v_entrada OR controla_estoque)) THEN
    RAISE EXCEPTION 'Produto acabado não encontrado ou sem controle de estoque';
  END IF;
  IF v_pedido IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_bom IS NOT NULL THEN
    SELECT * INTO b FROM public.mf_boms WHERE id = v_bom AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lista de materiais não encontrada'; END IF;
    IF b.situacao = 'rascunho' THEN RAISE EXCEPTION 'Ative a lista de materiais antes de usá-la'; END IF;
    IF v_produto IS NOT NULL AND v_produto <> b.produto_id THEN RAISE EXCEPTION 'A lista de materiais é de outro produto'; END IF;
    v_produto := coalesce(v_produto, CASE WHEN v_entrada THEN b.produto_id END);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mf_ordem:' || v_tenant::text, 0));
  SELECT coalesce(max(numero), 0) + 1 INTO v_numero FROM public.mf_ordens WHERE tenant_id = v_tenant;
  INSERT INTO public.mf_ordens (tenant_id, numero, descricao, produto_id, bom_id, quantidade_planejada, entrada_estoque, deposito_insumos_id,
                                deposito_destino_id, pedido_id, medidas, acabamento, prazo, mao_de_obra, criada_por)
  VALUES (v_tenant, v_numero, v_desc, v_produto, v_bom, v_qtd, v_entrada, v_dep_ins, v_dep_dest, v_pedido,
          nullif(btrim(coalesce(p_dados ->> 'medidas', '')), ''), nullif(btrim(coalesce(p_dados ->> 'acabamento', '')), ''), v_prazo, v_mao, auth.uid())
  RETURNING id INTO v_id;

  IF v_itens IS NULL AND v_bom IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('insumo_id', bi.insumo_id, 'quantidade', bi.quantidade / b.rendimento,
                                                  'perda_percentual', bi.perda_percentual)), '[]'::jsonb)
      INTO v_itens FROM public.mf_bom_itens bi WHERE bi.bom_id = v_bom;
  END IF;
  PERFORM public._mf_gravar_itens(v_id, v_itens);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_criar(jsonb) TO authenticated;

-- Ajusta os itens (e a mão de obra) enquanto a ordem está planejada: cada projeto sob medida usa quantidades diferentes.
CREATE OR REPLACE FUNCTION public.mf_ordem_itens_salvar(p_ordem_id uuid, p_itens jsonb, p_mao_de_obra numeric DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao <> 'planejada' THEN RAISE EXCEPTION 'Os itens só podem ser alterados antes da liberação'; END IF;
  IF p_mao_de_obra IS NOT NULL THEN
    IF p_mao_de_obra < 0 THEN RAISE EXCEPTION 'A mão de obra não pode ser negativa'; END IF;
    UPDATE public.mf_ordens SET mao_de_obra = p_mao_de_obra WHERE id = p_ordem_id;
  END IF;
  PERFORM public._mf_gravar_itens(p_ordem_id, p_itens);
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_itens_salvar(uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_itens_salvar(uuid, jsonb, numeric) TO authenticated;

-- Libera a ordem: confere a disponibilidade e reserva os insumos. Congela os itens.
CREATE OR REPLACE FUNCTION public.mf_ordem_liberar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
  r record;
  v_neg boolean; v_qtd numeric; v_res numeric; v_nome text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao <> 'planejada' THEN RAISE EXCEPTION 'Só a ordem planejada pode ser liberada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mf_ordem_insumos WHERE ordem_id = p_id) THEN RAISE EXCEPTION 'Inclua ao menos um insumo antes de liberar'; END IF;
  SELECT permite_negativo INTO v_neg FROM public.depositos WHERE id = o.deposito_insumos_id AND tenant_id = v_tenant;

  -- recalcula o custo padrão com o custo de hoje e reserva em ordem fixa (evita impasse entre ordens)
  FOR r IN SELECT oi.* FROM public.mf_ordem_insumos oi WHERE oi.ordem_id = p_id ORDER BY oi.insumo_id LOOP
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade, reservado INTO v_qtd, v_res FROM public.estoques
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant FOR UPDATE;
    IF r.quantidade_planejada > v_qtd - v_res AND NOT coalesce(v_neg, false) THEN
      SELECT descricao INTO v_nome FROM public.produtos WHERE id = r.insumo_id;
      RAISE EXCEPTION 'Estoque insuficiente de % para liberar a ordem (disponível: %, necessário: %)', v_nome, v_qtd - v_res, r.quantidade_planejada;
    END IF;
    UPDATE public.estoques SET reservado = reservado + r.quantidade_planejada, updated_at = now()
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant;
    UPDATE public.mf_ordem_insumos
       SET quantidade_reservada = r.quantidade_planejada,
           custo_unitario_padrao = round(coalesce(public._mf_custo(r.insumo_id, o.deposito_insumos_id), 0), 4)
     WHERE id = r.id;
  END LOOP;
  UPDATE public.mf_ordens
     SET situacao = 'liberada', liberada_em = now(),
         custo_padrao = round(coalesce((SELECT sum(quantidade_planejada * custo_unitario_padrao) FROM public.mf_ordem_insumos WHERE ordem_id = p_id), 0) + mao_de_obra, 2)
   WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_liberar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_liberar(uuid) TO authenticated;

-- Aponta a produção: consome os insumos (proporcional ao produzido e ao refugo), libera a reserva e, na linha padrão, dá entrada do acabado.
-- Idempotente: repetir a chave devolve o apontamento já gravado, sem consumir de novo.
CREATE OR REPLACE FUNCTION public.mf_ordem_apontar(p_ordem_id uuid, p_boa numeric, p_refugo numeric, p_minutos integer, p_chave text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_chave text := btrim(coalesce(p_chave, ''));
  v_boa numeric := coalesce(p_boa, 0);
  v_ref numeric := coalesce(p_refugo, 0);
  o public.mf_ordens;
  v_ap uuid; v_ap_ordem uuid;
  r record;
  v_neg boolean; v_qtd numeric; v_res numeric; v_custo_est numeric; v_custo_prod numeric; v_custo numeric;
  v_alvo numeric; v_consumo numeric; v_da_reserva numeric; v_extra numeric; v_unidade text; v_nome text;
  v_custo_total numeric := 0; v_novo_saldo numeric; v_saldo_ant numeric; v_cu numeric; v_qtd_dest numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  IF v_chave = '' THEN RAISE EXCEPTION 'Informe a chave do apontamento'; END IF;
  IF v_boa < 0 OR v_ref < 0 OR v_boa + v_ref <= 0 THEN RAISE EXCEPTION 'Informe a quantidade produzida ou o refugo'; END IF;
  IF p_minutos IS NOT NULL AND p_minutos < 0 THEN RAISE EXCEPTION 'Os minutos não podem ser negativos'; END IF;

  -- trava a ordem antes de olhar a chave: duas chamadas iguais ao mesmo tempo ficam em fila
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  SELECT id, ordem_id INTO v_ap, v_ap_ordem FROM public.mf_apontamentos WHERE tenant_id = v_tenant AND chave_idempotente = v_chave;
  IF FOUND THEN
    IF v_ap_ordem <> p_ordem_id THEN RAISE EXCEPTION 'Esta chave já foi usada em outra ordem'; END IF;
    RETURN v_ap;
  END IF;
  IF o.situacao NOT IN ('liberada', 'em_producao') THEN RAISE EXCEPTION 'Só a ordem liberada ou em produção recebe apontamento'; END IF;
  SELECT permite_negativo INTO v_neg FROM public.depositos WHERE id = o.deposito_insumos_id AND tenant_id = v_tenant;

  INSERT INTO public.mf_apontamentos (tenant_id, ordem_id, quantidade_boa, refugo, minutos, chave_idempotente, usuario_id)
  VALUES (v_tenant, p_ordem_id, v_boa, v_ref, p_minutos, v_chave, auth.uid()) RETURNING id INTO v_ap;

  FOR r IN SELECT oi.* FROM public.mf_ordem_insumos oi WHERE oi.ordem_id = p_ordem_id ORDER BY oi.insumo_id LOOP
    -- consumo acumulado esperado menos o já consumido: o arredondamento não acumula erro entre apontamentos
    v_alvo := round(r.quantidade_base * 100 / (100 - r.perda_percentual) * (o.quantidade_produzida + v_boa + o.quantidade_refugo + v_ref), 3);
    v_consumo := v_alvo - r.quantidade_consumida;
    CONTINUE WHEN v_consumo <= 0;

    SELECT p.unidade, p.descricao, p.custo INTO v_unidade, v_nome, v_custo_prod FROM public.produtos p WHERE p.id = r.insumo_id AND p.tenant_id = v_tenant;
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade, reservado, custo_medio INTO v_qtd, v_res, v_custo_est FROM public.estoques
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant FOR UPDATE;
    v_custo := CASE WHEN coalesce(v_custo_est, 0) > 0 THEN v_custo_est ELSE coalesce(v_custo_prod, 0) END;

    v_da_reserva := least(v_consumo, r.quantidade_reservada);
    v_extra := v_consumo - v_da_reserva;
    -- o que passa da reserva da própria ordem precisa estar livre (sem reserva de outras ordens ou pedidos)
    IF v_extra > v_qtd - v_res AND NOT coalesce(v_neg, false) THEN
      RAISE EXCEPTION 'Estoque insuficiente de % no depósito dos insumos (disponível: %, necessário: %)', v_nome, v_qtd - v_res + v_da_reserva, v_consumo;
    END IF;
    UPDATE public.estoques SET quantidade = quantidade - v_consumo, reservado = greatest(reservado - v_da_reserva, 0), updated_at = now()
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant;
    INSERT INTO public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
                                              documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 'saida', v_consumo, v_qtd, v_qtd - v_consumo, v_unidade,
            'OP-' || o.numero, 'Consumo de insumo na ordem de produção', auth.uid(), round(v_custo, 4), round(v_consumo * v_custo, 2));
    UPDATE public.mf_ordem_insumos
       SET quantidade_consumida = quantidade_consumida + v_consumo,
           quantidade_reservada = quantidade_reservada - v_da_reserva,
           custo_consumido = custo_consumido + round(v_consumo * v_custo, 2)
     WHERE id = r.id;
    v_custo_total := v_custo_total + round(v_consumo * v_custo, 2);
  END LOOP;

  -- linha padrão: o acabado entra no estoque; o custo desta rodada (insumos) vai para as peças boas
  IF o.entrada_estoque AND v_boa > 0 THEN
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, o.produto_id, o.deposito_destino_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade INTO v_saldo_ant FROM public.estoques
     WHERE produto_id = o.produto_id AND deposito_id = o.deposito_destino_id AND tenant_id = v_tenant FOR UPDATE;
    v_novo_saldo := v_saldo_ant + v_boa;
    UPDATE public.estoques SET quantidade = v_novo_saldo, updated_at = now()
     WHERE produto_id = o.produto_id AND deposito_id = o.deposito_destino_id AND tenant_id = v_tenant;
    v_cu := round(v_custo_total / v_boa, 4);
    SELECT unidade INTO v_unidade FROM public.produtos WHERE id = o.produto_id AND tenant_id = v_tenant;
    INSERT INTO public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
                                              documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, o.produto_id, o.deposito_destino_id, 'entrada', v_boa, v_saldo_ant, v_novo_saldo, v_unidade,
            'OP-' || o.numero, 'Entrada do produto acabado pela ordem de produção', auth.uid(), v_cu, round(v_boa * v_cu, 2));
    PERFORM public.atualizar_custo_medio(o.produto_id, o.deposito_destino_id, v_boa, v_cu);
  END IF;

  UPDATE public.mf_ordens
     SET quantidade_produzida = quantidade_produzida + v_boa, quantidade_refugo = quantidade_refugo + v_ref,
         custo_real = round(custo_real + v_custo_total, 2),
         situacao = 'em_producao'
   WHERE id = p_ordem_id;
  RETURN v_ap;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_apontar(uuid, numeric, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_apontar(uuid, numeric, numeric, integer, text) TO authenticated;

-- Solta a reserva que sobrou de uma ordem (conclusão ou cancelamento).
CREATE OR REPLACE FUNCTION public._mf_soltar_reserva(p_ordem uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens; r record;
BEGIN
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_ordem AND tenant_id = v_tenant;
  FOR r IN SELECT * FROM public.mf_ordem_insumos WHERE ordem_id = p_ordem AND quantidade_reservada > 0 ORDER BY insumo_id LOOP
    UPDATE public.estoques SET reservado = greatest(reservado - r.quantidade_reservada, 0), updated_at = now()
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant;
    UPDATE public.mf_ordem_insumos SET quantidade_reservada = 0 WHERE id = r.id;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._mf_soltar_reserva(uuid) FROM PUBLIC, anon, authenticated;

-- Conclui a ordem em produção: solta a reserva que sobrou e fecha o custo real (insumos consumidos + mão de obra).
CREATE OR REPLACE FUNCTION public.mf_ordem_concluir(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao <> 'em_producao' THEN RAISE EXCEPTION 'Só a ordem em produção pode ser concluída'; END IF;
  PERFORM public._mf_soltar_reserva(p_id);
  UPDATE public.mf_ordens
     SET situacao = 'concluida', concluida_em = now(),
         custo_real = round(coalesce((SELECT sum(custo_consumido) FROM public.mf_ordem_insumos WHERE ordem_id = p_id), 0) + mao_de_obra, 2)
   WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_concluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_concluir(uuid) TO authenticated;

-- Cancela a ordem que ainda não consumiu nada (planejada ou liberada). Em produção, o consumo já saiu do estoque: conclua.
CREATE OR REPLACE FUNCTION public.mf_ordem_cancelar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao NOT IN ('planejada', 'liberada') THEN
    RAISE EXCEPTION 'Só a ordem planejada ou liberada pode ser cancelada (ordem em produção: conclua)';
  END IF;
  PERFORM public._mf_soltar_reserva(p_id);
  UPDATE public.mf_ordens SET situacao = 'cancelada' WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_cancelar(uuid) TO authenticated;

-- ============ leitura do encarregado da oficina (sem custo) ============
CREATE OR REPLACE FUNCTION public.mf_ordens_producao()
RETURNS TABLE (id uuid, numero bigint, descricao text, produto text, quantidade_planejada numeric, quantidade_produzida numeric,
               quantidade_refugo numeric, situacao text, prazo date, medidas text, acabamento text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  RETURN QUERY
  SELECT o.id, o.numero, o.descricao, p.descricao, o.quantidade_planejada, o.quantidade_produzida, o.quantidade_refugo,
         o.situacao, o.prazo, o.medidas, o.acabamento
    FROM public.mf_ordens o LEFT JOIN public.produtos p ON p.id = o.produto_id
   WHERE o.tenant_id = public.current_tenant_id() AND o.situacao IN ('liberada', 'em_producao')
   ORDER BY o.prazo NULLS LAST, o.numero;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordens_producao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordens_producao() TO authenticated;

CREATE OR REPLACE FUNCTION public.mf_ordem_insumos_producao(p_ordem_id uuid)
RETURNS TABLE (insumo text, unidade text, quantidade_planejada numeric, quantidade_consumida numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  RETURN QUERY
  SELECT p.descricao, p.unidade, oi.quantidade_planejada, oi.quantidade_consumida
    FROM public.mf_ordem_insumos oi JOIN public.produtos p ON p.id = oi.insumo_id
   WHERE oi.ordem_id = p_ordem_id AND oi.tenant_id = public.current_tenant_id()
   ORDER BY p.descricao;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_insumos_producao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_insumos_producao(uuid) TO authenticated;
