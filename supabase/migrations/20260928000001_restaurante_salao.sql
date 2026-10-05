-- Restaurante (Rodada 6, etapa R1): cardápio, mesas, comandas e fechamento de conta.
--
-- Modelo:
--   cardápio  = categorias > itens > grupos de opções (obrigatório / máximo) > opções (com acréscimo)
--   salão     = mesas e comandas (uma comanda aberta por mesa; comanda avulsa para balcão)
--   comanda   = itens com situação (pendente > enviado > preparando > pronto > entregue / cancelado)
--   fechamento = serviço e couvert, desconto (só gestão), pagamentos divididos, lançamento no caixa
--
-- Segurança: cardápio e mesas são cadastrados por administrador e gestor; comandas, itens e
-- pagamentos só mudam pelas RPCs abaixo (SECURITY DEFINER), que conferem empresa e perfil.
-- Não há baixa de estoque nem nota fiscal aqui: virão nas etapas de ficha técnica e NFC-e.

-- ===== Cardápio =====
CREATE TABLE public.cardapio_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cardapio_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  categoria_id uuid REFERENCES public.cardapio_categorias (id) ON DELETE SET NULL,
  -- ligação com o cadastro de produtos: usada depois para ficha técnica, estoque e fiscal
  produto_id uuid REFERENCES public.produtos (id) ON DELETE SET NULL,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  descricao text,
  preco numeric(14,2) NOT NULL DEFAULT 0 CHECK (preco >= 0),
  -- onde o item é preparado: cozinha, bar ou nenhum (pronto para servir, ex.: lata)
  estacao text NOT NULL DEFAULT 'cozinha' CHECK (estacao IN ('cozinha', 'bar', 'nenhuma')),
  tempo_preparo_min integer CHECK (tempo_preparo_min IS NULL OR tempo_preparo_min >= 0),
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cardapio_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.cardapio_itens (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  obrigatorio boolean NOT NULL DEFAULT false,
  max_escolhas integer NOT NULL DEFAULT 1 CHECK (max_escolhas >= 1)
);

CREATE TABLE public.cardapio_opcoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  grupo_id uuid NOT NULL REFERENCES public.cardapio_grupos (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  preco_adicional numeric(14,2) NOT NULL DEFAULT 0 CHECK (preco_adicional >= 0),
  ativo boolean NOT NULL DEFAULT true
);

-- ===== Salão =====
CREATE TABLE public.mesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  filial_id uuid REFERENCES public.filiais (id) ON DELETE SET NULL,
  numero text NOT NULL CHECK (btrim(numero) <> ''),
  capacidade integer CHECK (capacidade IS NULL OR capacidade > 0),
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mesas_numero_uk
  ON public.mesas (tenant_id, coalesce(filial_id, '00000000-0000-0000-0000-000000000000'::uuid), numero);

CREATE TABLE public.comandas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  filial_id uuid REFERENCES public.filiais (id) ON DELETE SET NULL,
  numero bigint NOT NULL,
  mesa_id uuid REFERENCES public.mesas (id) ON DELETE SET NULL,
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'fechada', 'cancelada')),
  garcom_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  cliente_nome text,
  pessoas integer CHECK (pessoas IS NULL OR pessoas > 0),
  taxa_servico_percentual numeric(5,2) NOT NULL DEFAULT 10 CHECK (taxa_servico_percentual BETWEEN 0 AND 100),
  couvert_por_pessoa numeric(14,2) NOT NULL DEFAULT 0 CHECK (couvert_por_pessoa >= 0),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  couvert numeric(14,2) NOT NULL DEFAULT 0,
  taxa_servico numeric(14,2) NOT NULL DEFAULT 0,
  desconto numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0,
  observacao text,
  caixa_id uuid REFERENCES public.caixas (id) ON DELETE SET NULL,
  aberta_em timestamptz NOT NULL DEFAULT now(),
  fechada_em timestamptz,
  fechada_por uuid,
  motivo_cancelamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);
-- uma comanda aberta por mesa
CREATE UNIQUE INDEX comandas_mesa_aberta_uk ON public.comandas (mesa_id)
  WHERE situacao = 'aberta' AND mesa_id IS NOT NULL;
CREATE INDEX comandas_tenant_situacao_idx ON public.comandas (tenant_id, situacao, aberta_em DESC);

CREATE TABLE public.comanda_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  comanda_id uuid NOT NULL REFERENCES public.comandas (id) ON DELETE CASCADE,
  cardapio_item_id uuid NOT NULL REFERENCES public.cardapio_itens (id) ON DELETE RESTRICT,
  -- cópia do que foi vendido, para o histórico não mudar se o cardápio mudar
  nome text NOT NULL,
  estacao text NOT NULL,
  opcoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantidade numeric(10,3) NOT NULL CHECK (quantidade > 0),
  preco_unitario numeric(14,2) NOT NULL CHECK (preco_unitario >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  observacao text,
  situacao text NOT NULL DEFAULT 'pendente'
    CHECK (situacao IN ('pendente', 'enviado', 'preparando', 'pronto', 'entregue', 'cancelado')),
  lancado_por uuid,
  enviado_em timestamptz,
  pronto_em timestamptz,
  entregue_em timestamptz,
  cancelado_em timestamptz,
  cancelado_por uuid,
  motivo_cancelamento text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comanda_itens_comanda_idx ON public.comanda_itens (comanda_id);
CREATE INDEX comanda_itens_fila_idx ON public.comanda_itens (tenant_id, situacao, enviado_em)
  WHERE situacao IN ('enviado', 'preparando', 'pronto');

CREATE TABLE public.comanda_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  comanda_id uuid NOT NULL REFERENCES public.comandas (id) ON DELETE CASCADE,
  forma public.forma_pagamento NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  pagante text,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comanda_pagamentos_comanda_idx ON public.comanda_pagamentos (comanda_id);

CREATE TRIGGER trg_cardapio_itens_touch BEFORE UPDATE ON public.cardapio_itens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_comandas_touch BEFORE UPDATE ON public.comandas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
-- alteração de preço do cardápio fica registrada em `auditoria`
CREATE TRIGGER trg_auditar_cardapio_itens AFTER UPDATE ON public.cardapio_itens
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('preco');

-- ===== Permissões =====
-- Quem opera o salão: gestão, garçom, cozinha e caixa.
CREATE OR REPLACE FUNCTION public.restaurante_operador()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
      OR public.has_role(auth.uid(), 'garcom') OR public.has_role(auth.uid(), 'cozinha')
      OR public.has_role(auth.uid(), 'caixa')
$$;

CREATE OR REPLACE FUNCTION public.restaurante_gestao()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
$$;

REVOKE ALL ON FUNCTION public.restaurante_operador() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_gestao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_operador() TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_gestao() TO authenticated;

-- ===== RLS =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cardapio_categorias', 'cardapio_itens', 'cardapio_grupos', 'cardapio_opcoes',
                           'mesas', 'comandas', 'comanda_itens', 'comanda_pagamentos']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- cardápio e mesas: leitura pela empresa, cadastro pela gestão
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cardapio_categorias', 'cardapio_itens', 'cardapio_grupos', 'cardapio_opcoes', 'mesas']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format($f$CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
      WITH CHECK (tenant_id = public.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_delete" ON public.%1$I FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
  END LOOP;
END $$;

-- comandas e itens: só leitura direta (a escrita é pelas RPCs). O Supabase concede escrita por padrão
-- a quem cria tabelas em `public`; revogar deixa a recusa explícita, além da RLS.
REVOKE INSERT, UPDATE, DELETE ON public.comandas, public.comanda_itens, public.comanda_pagamentos FROM authenticated;
GRANT SELECT ON public.comandas, public.comanda_itens TO authenticated;
CREATE POLICY comandas_select ON public.comandas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());
CREATE POLICY comanda_itens_select ON public.comanda_itens FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());

-- pagamentos: a cozinha não vê valores recebidos
GRANT SELECT ON public.comanda_pagamentos TO authenticated;
CREATE POLICY comanda_pagamentos_select ON public.comanda_pagamentos FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.restaurante_gestao() OR public.has_role(auth.uid(), 'caixa')
         OR public.has_role(auth.uid(), 'financeiro'))
  );

-- tempo real para a tela da cozinha e do salão (só onde a publicação existe, como no Supabase)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comandas, public.comanda_itens;
  END IF;
END $$;

-- ===== Funções internas =====
-- Confere perfil e devolve a empresa do usuário.
CREATE OR REPLACE FUNCTION public.restaurante_contexto(p_perfis public.app_role[])
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_papel public.app_role;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem empresa vinculada';
  END IF;
  FOREACH v_papel IN ARRAY p_perfis LOOP
    IF public.has_role(auth.uid(), v_papel) THEN RETURN v_tenant; END IF;
  END LOOP;
  RAISE EXCEPTION 'Seu perfil não tem permissão para esta operação';
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_contexto(public.app_role[]) FROM PUBLIC, anon, authenticated;

-- ===== Comanda: abrir =====
CREATE OR REPLACE FUNCTION public.restaurante_abrir_comanda(
  p_mesa_id uuid DEFAULT NULL,
  p_pessoas integer DEFAULT NULL,
  p_cliente_nome text DEFAULT NULL,
  p_taxa_servico numeric DEFAULT 10,
  p_couvert numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_filial uuid;
  v_numero bigint;
  v_id uuid;
BEGIN
  IF p_mesa_id IS NOT NULL THEN
    SELECT filial_id INTO v_filial FROM public.mesas
     WHERE id = p_mesa_id AND tenant_id = v_tenant AND ativa;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mesa não encontrada ou inativa'; END IF;
    IF EXISTS (SELECT 1 FROM public.comandas WHERE mesa_id = p_mesa_id AND situacao = 'aberta') THEN
      RAISE EXCEPTION 'Esta mesa já tem uma comanda aberta';
    END IF;
  ELSE
    SELECT filial_id INTO v_filial FROM public.profiles WHERE id = auth.uid();
  END IF;
  IF p_pessoas IS NOT NULL AND p_pessoas <= 0 THEN RAISE EXCEPTION 'Informe a quantidade de pessoas'; END IF;
  IF p_taxa_servico < 0 OR p_taxa_servico > 100 THEN RAISE EXCEPTION 'Taxa de serviço inválida'; END IF;
  IF p_couvert < 0 THEN RAISE EXCEPTION 'Couvert inválido'; END IF;

  -- numeração sequencial por empresa, sem repetir número em aberturas simultâneas
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));
  SELECT coalesce(max(numero), 0) + 1 INTO v_numero FROM public.comandas WHERE tenant_id = v_tenant;

  INSERT INTO public.comandas (tenant_id, filial_id, numero, mesa_id, garcom_id, cliente_nome, pessoas,
                               taxa_servico_percentual, couvert_por_pessoa)
  VALUES (v_tenant, v_filial, v_numero, p_mesa_id, auth.uid(), nullif(btrim(p_cliente_nome), ''), p_pessoas,
          p_taxa_servico, p_couvert)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ===== Comanda: lançar item =====
CREATE OR REPLACE FUNCTION public.restaurante_lancar_item(
  p_comanda_id uuid,
  p_cardapio_item_id uuid,
  p_quantidade numeric DEFAULT 1,
  p_opcoes uuid[] DEFAULT '{}',
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_item public.cardapio_itens;
  v_unitario numeric(14,2);
  v_opcoes jsonb;
  v_grupo record;
  v_escolhidas integer;
  v_id uuid;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero'; END IF;

  PERFORM 1 FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'aberta' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  SELECT * INTO v_item FROM public.cardapio_itens
   WHERE id = p_cardapio_item_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do cardápio não encontrado ou inativo'; END IF;

  p_opcoes := coalesce(p_opcoes, '{}');
  -- toda opção escolhida precisa ser ativa e de um grupo deste item
  IF EXISTS (
    SELECT 1 FROM unnest(p_opcoes) AS o(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.cardapio_opcoes op
         JOIN public.cardapio_grupos g ON g.id = op.grupo_id
        WHERE op.id = o.id AND op.ativo AND g.item_id = v_item.id AND op.tenant_id = v_tenant)
  ) THEN
    RAISE EXCEPTION 'Opção inválida para este item';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_opcoes) AS x) <> coalesce(array_length(p_opcoes, 1), 0) THEN
    RAISE EXCEPTION 'Opção repetida';
  END IF;

  -- grupos obrigatórios e limite de escolhas
  FOR v_grupo IN SELECT id, nome, obrigatorio, max_escolhas FROM public.cardapio_grupos WHERE item_id = v_item.id LOOP
    SELECT count(*) INTO v_escolhidas
      FROM public.cardapio_opcoes op WHERE op.grupo_id = v_grupo.id AND op.id = ANY (p_opcoes);
    IF v_grupo.obrigatorio AND v_escolhidas = 0 THEN
      RAISE EXCEPTION 'Escolha uma opção em "%"', v_grupo.nome;
    END IF;
    IF v_escolhidas > v_grupo.max_escolhas THEN
      RAISE EXCEPTION 'Em "%" é possível escolher no máximo %', v_grupo.nome, v_grupo.max_escolhas;
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', op.nome, 'preco_adicional', op.preco_adicional)
                            ORDER BY op.nome), '[]'::jsonb),
         v_item.preco + coalesce(sum(op.preco_adicional), 0)
    INTO v_opcoes, v_unitario
    FROM public.cardapio_opcoes op WHERE op.id = ANY (p_opcoes);

  INSERT INTO public.comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, opcoes, quantidade,
                                    preco_unitario, total, observacao, lancado_por)
  VALUES (v_tenant, p_comanda_id, v_item.id, v_item.nome, v_item.estacao, v_opcoes, p_quantidade,
          v_unitario, round(p_quantidade * v_unitario, 2), nullif(btrim(p_observacao), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ===== Comanda: enviar à cozinha =====
-- Itens "sem estação" (prontos para servir) já saem como entregues.
CREATE OR REPLACE FUNCTION public.restaurante_enviar_cozinha(p_comanda_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_qtd integer;
BEGIN
  PERFORM 1 FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'aberta' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  UPDATE public.comanda_itens
     SET situacao = CASE WHEN estacao = 'nenhuma' THEN 'entregue' ELSE 'enviado' END,
         enviado_em = now(),
         entregue_em = CASE WHEN estacao = 'nenhuma' THEN now() ELSE NULL END
   WHERE comanda_id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'pendente';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$$;

-- ===== Item: andamento (cozinha e salão) =====
CREATE OR REPLACE FUNCTION public.restaurante_atualizar_item(p_item_id uuid, p_situacao text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'cozinha', 'caixa']::public.app_role[]);
  v_atual text;
BEGIN
  SELECT i.situacao INTO v_atual
    FROM public.comanda_itens i JOIN public.comandas c ON c.id = i.comanda_id
   WHERE i.id = p_item_id AND i.tenant_id = v_tenant AND c.situacao = 'aberta'
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado ou comanda já encerrada'; END IF;

  IF NOT ((v_atual = 'enviado' AND p_situacao IN ('preparando', 'pronto'))
       OR (v_atual = 'preparando' AND p_situacao = 'pronto')
       OR (v_atual = 'pronto' AND p_situacao = 'entregue')) THEN
    RAISE EXCEPTION 'Não é possível passar o item de "%" para "%"', v_atual, p_situacao;
  END IF;

  -- preparar é com a cozinha (e gestão); entregar à mesa é com o salão
  IF p_situacao IN ('preparando', 'pronto') AND NOT (public.restaurante_gestao() OR public.has_role(auth.uid(), 'cozinha')) THEN
    RAISE EXCEPTION 'Somente a cozinha atualiza o preparo';
  END IF;

  UPDATE public.comanda_itens
     SET situacao = p_situacao,
         pronto_em = CASE WHEN p_situacao = 'pronto' THEN now() ELSE pronto_em END,
         entregue_em = CASE WHEN p_situacao = 'entregue' THEN now() ELSE entregue_em END
   WHERE id = p_item_id;
END;
$$;

-- ===== Item: cancelar =====
-- Antes de ir para a cozinha, o próprio garçom cancela; depois disso, só a gestão e com motivo.
CREATE OR REPLACE FUNCTION public.restaurante_cancelar_item(p_item_id uuid, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_atual text;
BEGIN
  SELECT i.situacao INTO v_atual
    FROM public.comanda_itens i JOIN public.comandas c ON c.id = i.comanda_id
   WHERE i.id = p_item_id AND i.tenant_id = v_tenant AND c.situacao = 'aberta'
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado ou comanda já encerrada'; END IF;
  IF v_atual = 'cancelado' THEN RAISE EXCEPTION 'Item já cancelado'; END IF;

  IF v_atual <> 'pendente' THEN
    IF NOT public.restaurante_gestao() THEN
      RAISE EXCEPTION 'Item já enviado à cozinha: o cancelamento é feito pela gestão';
    END IF;
    IF coalesce(char_length(btrim(p_motivo)), 0) < 3 THEN
      RAISE EXCEPTION 'Informe o motivo do cancelamento';
    END IF;
  END IF;

  UPDATE public.comanda_itens
     SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
         motivo_cancelamento = nullif(btrim(p_motivo), '')
   WHERE id = p_item_id;
END;
$$;

-- ===== Comanda: transferir de mesa =====
CREATE OR REPLACE FUNCTION public.restaurante_transferir_mesa(p_comanda_id uuid, p_mesa_destino uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_filial uuid;
BEGIN
  PERFORM 1 FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'aberta' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  SELECT filial_id INTO v_filial FROM public.mesas WHERE id = p_mesa_destino AND tenant_id = v_tenant AND ativa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mesa de destino não encontrada ou inativa'; END IF;
  IF EXISTS (SELECT 1 FROM public.comandas WHERE mesa_id = p_mesa_destino AND situacao = 'aberta') THEN
    RAISE EXCEPTION 'A mesa de destino já tem uma comanda aberta';
  END IF;

  UPDATE public.comandas SET mesa_id = p_mesa_destino, filial_id = coalesce(v_filial, filial_id) WHERE id = p_comanda_id;
END;
$$;

-- ===== Comanda: fechar =====
-- p_pagamentos: [{"forma": "pix", "valor": 50.00, "pagante": "João"}, ...]. A soma precisa fechar o total.
-- Cada pagamento é lançado no caixa informado. Desconto só pela gestão.
CREATE OR REPLACE FUNCTION public.restaurante_fechar_comanda(
  p_comanda_id uuid,
  p_pagamentos jsonb DEFAULT '[]'::jsonb,
  p_caixa_id uuid DEFAULT NULL,
  p_desconto numeric DEFAULT 0,
  p_cobrar_servico boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_cmd public.comandas;
  v_subtotal numeric(14,2);
  v_couvert numeric(14,2);
  v_servico numeric(14,2);
  v_bruto numeric(14,2);
  v_total numeric(14,2);
  v_pago numeric(14,2) := 0;
  v_pag jsonb;
  v_forma public.forma_pagamento;
  v_valor numeric(14,2);
BEGIN
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.situacao <> 'aberta' THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao = 'pendente') THEN
    RAISE EXCEPTION 'Há itens ainda não enviados à cozinha: envie ou cancele antes de fechar';
  END IF;

  p_desconto := coalesce(p_desconto, 0);
  IF p_desconto < 0 THEN RAISE EXCEPTION 'Desconto inválido'; END IF;
  IF p_desconto > 0 AND NOT public.restaurante_gestao() THEN
    RAISE EXCEPTION 'Desconto só pode ser dado pela gestão';
  END IF;

  SELECT coalesce(sum(total), 0) INTO v_subtotal
    FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado';
  v_couvert := round(coalesce(v_cmd.pessoas, 0) * v_cmd.couvert_por_pessoa, 2);
  v_servico := CASE WHEN p_cobrar_servico THEN round(v_subtotal * v_cmd.taxa_servico_percentual / 100, 2) ELSE 0 END;
  v_bruto := v_subtotal + v_couvert + v_servico;
  IF p_desconto > v_bruto THEN RAISE EXCEPTION 'O desconto não pode passar do total da conta'; END IF;
  v_total := v_bruto - p_desconto;

  IF jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Pagamentos em formato inválido';
  END IF;

  FOR v_pag IN SELECT * FROM jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) LOOP
    BEGIN
      v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((v_pag ->> 'valor')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Pagamento inválido: %', v_pag;
    END;
    IF v_forma = 'crediario' THEN RAISE EXCEPTION 'Crediário não é aceito na comanda'; END IF;
    IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero em cada pagamento'; END IF;
    v_pago := v_pago + v_valor;
  END LOOP;

  IF v_pago <> v_total THEN
    RAISE EXCEPTION 'Os pagamentos (%) não fecham o total da conta (%)', v_pago, v_total;
  END IF;

  IF v_total > 0 THEN
    IF p_caixa_id IS NULL THEN RAISE EXCEPTION 'Informe o caixa aberto para receber a conta'; END IF;
    PERFORM 1 FROM public.caixas WHERE id = p_caixa_id AND tenant_id = v_tenant AND situacao = 'aberto';
    IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado ou já fechado'; END IF;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((v_pag ->> 'valor')::numeric, 2);
      INSERT INTO public.comanda_pagamentos (tenant_id, comanda_id, forma, valor, pagante, usuario_id)
      VALUES (v_tenant, p_comanda_id, v_forma, v_valor, nullif(btrim(v_pag ->> 'pagante'), ''), auth.uid());
      PERFORM public.caixa_lancar(p_caixa_id, 'venda'::public.caixa_mov_tipo, v_valor,
                                  'Comanda ' || v_cmd.numero, v_forma, NULL, NULL);
    END LOOP;
  END IF;

  UPDATE public.comandas
     SET situacao = 'fechada', subtotal = v_subtotal, couvert = v_couvert, taxa_servico = v_servico,
         desconto = p_desconto, total = v_total, caixa_id = p_caixa_id,
         fechada_em = now(), fechada_por = auth.uid()
   WHERE id = p_comanda_id;

  RETURN jsonb_build_object('subtotal', v_subtotal, 'couvert', v_couvert, 'taxa_servico', v_servico,
                            'desconto', p_desconto, 'total', v_total);
END;
$$;

-- ===== Comanda: cancelar (gestão) =====
CREATE OR REPLACE FUNCTION public.restaurante_cancelar_comanda(p_comanda_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor']::public.app_role[]);
BEGIN
  IF coalesce(char_length(btrim(p_motivo)), 0) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  PERFORM 1 FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'aberta' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  UPDATE public.comanda_itens
     SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo)
   WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado';
  UPDATE public.comandas
     SET situacao = 'cancelada', motivo_cancelamento = btrim(p_motivo), fechada_em = now(), fechada_por = auth.uid()
   WHERE id = p_comanda_id;
END;
$$;

-- ===== Execução: somente usuários logados =====
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'restaurante_abrir_comanda(uuid, integer, text, numeric, numeric)',
    'restaurante_lancar_item(uuid, uuid, numeric, uuid[], text)',
    'restaurante_enviar_cozinha(uuid)',
    'restaurante_atualizar_item(uuid, text)',
    'restaurante_cancelar_item(uuid, text)',
    'restaurante_transferir_mesa(uuid, uuid)',
    'restaurante_fechar_comanda(uuid, jsonb, uuid, numeric, boolean)',
    'restaurante_cancelar_comanda(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
