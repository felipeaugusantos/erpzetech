-- Restaurante: varios cardapios (almoco, jantar, delivery, iFood...), cada um com seus itens, ordem e preco proprios.
--
-- O item continua sendo cadastrado uma vez (cardapio_itens, com o preco base). Cada cardapio lista os itens que
-- vendem nele e pode trocar o preco e a ordem so naquele cardapio. Onde cada cardapio aparece:
--   uso_salao / uso_delivery : seletor de cardapio ao lancar itens na comanda
--   uso_online               : pagina publica /menu/<link>
--   uso_ifood                : cardapio e tabela de preco que o conector do iFood vai publicar
-- O horario (hora_inicio/hora_fim) so escolhe o cardapio sugerido na tela; a venda nao e bloqueada por ele.
-- Preco do cardapio e aplicado no lancamento por restaurante_lancar_item_no_cardapio (o lancamento comum segue
-- cobrando o preco base).

CREATE TABLE IF NOT EXISTS public.cardapios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 40),
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  padrao boolean NOT NULL DEFAULT false,
  uso_salao boolean NOT NULL DEFAULT true,
  uso_delivery boolean NOT NULL DEFAULT true,
  uso_online boolean NOT NULL DEFAULT true,
  uso_ifood boolean NOT NULL DEFAULT false,
  hora_inicio time,
  hora_fim time,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardapios_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT cardapios_horario_ck CHECK ((hora_inicio IS NULL) = (hora_fim IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cardapios_nome_uk ON public.cardapios (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS cardapios_padrao_uk ON public.cardapios (tenant_id) WHERE padrao;

CREATE TABLE IF NOT EXISTS public.cardapio_cardapio_itens (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  cardapio_id uuid NOT NULL,
  item_id uuid NOT NULL,
  preco numeric(14,2) CHECK (preco IS NULL OR (preco >= 0 AND preco <= 100000)),
  ordem integer,
  PRIMARY KEY (cardapio_id, item_id),
  CONSTRAINT cardapio_cardapio_itens_cardapio_fk FOREIGN KEY (cardapio_id, tenant_id)
    REFERENCES public.cardapios (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT cardapio_cardapio_itens_item_fk FOREIGN KEY (item_id, tenant_id)
    REFERENCES public.cardapio_itens (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cardapio_cardapio_itens_item_idx ON public.cardapio_cardapio_itens (item_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cardapios', 'cardapio_cardapio_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
      WITH CHECK (tenant_id = public.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_delete" ON public.%1$I FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
  END LOOP;
END $$;

-- ===== Cardapio padrao: item novo entra nele sozinho =====
CREATE OR REPLACE FUNCTION public.restaurante_item_no_padrao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT NEW.interno THEN
    INSERT INTO public.cardapio_cardapio_itens (tenant_id, cardapio_id, item_id)
    SELECT NEW.tenant_id, c.id, NEW.id FROM public.cardapios c WHERE c.tenant_id = NEW.tenant_id AND c.padrao
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cardapio_itens_padrao ON public.cardapio_itens;
CREATE TRIGGER trg_cardapio_itens_padrao AFTER INSERT ON public.cardapio_itens
  FOR EACH ROW EXECUTE FUNCTION public.restaurante_item_no_padrao();

-- ===== O que ja existe vira o "Cardapio principal"; item com preco do iFood vira o cardapio "iFood" =====
DO $$
DECLARE
  v_t uuid;
  v_principal uuid;
  v_ifood uuid;
BEGIN
  FOR v_t IN SELECT DISTINCT tenant_id FROM public.cardapio_itens WHERE NOT interno
              AND NOT EXISTS (SELECT 1 FROM public.cardapios c WHERE c.tenant_id = cardapio_itens.tenant_id) LOOP
    INSERT INTO public.cardapios (tenant_id, nome, padrao) VALUES (v_t, 'Cardápio principal', true)
    RETURNING id INTO v_principal;
    INSERT INTO public.cardapio_cardapio_itens (tenant_id, cardapio_id, item_id, ordem)
    SELECT i.tenant_id, v_principal, i.id, i.ordem FROM public.cardapio_itens i
     WHERE i.tenant_id = v_t AND NOT i.interno
    ON CONFLICT DO NOTHING;

    IF EXISTS (SELECT 1 FROM public.cardapio_itens WHERE tenant_id = v_t AND preco_ifood IS NOT NULL AND NOT interno) THEN
      INSERT INTO public.cardapios (tenant_id, nome, ordem, uso_salao, uso_delivery, uso_online, uso_ifood)
      VALUES (v_t, 'iFood', 10, false, false, false, true) RETURNING id INTO v_ifood;
      INSERT INTO public.cardapio_cardapio_itens (tenant_id, cardapio_id, item_id, preco, ordem)
      SELECT i.tenant_id, v_ifood, i.id, i.preco_ifood, i.ordem FROM public.cardapio_itens i
       WHERE i.tenant_id = v_t AND i.preco_ifood IS NOT NULL AND NOT i.interno
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ===== Lancar item cobrando o preco do cardapio escolhido =====
CREATE OR REPLACE FUNCTION public.restaurante_lancar_item_no_cardapio(
  p_comanda_id uuid,
  p_cardapio_item_id uuid,
  p_quantidade numeric,
  p_cardapio_id uuid,
  p_opcoes uuid[] DEFAULT '{}',
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_preco numeric(14,2);
  v_id uuid;
BEGIN
  IF p_cardapio_id IS NULL THEN RAISE EXCEPTION 'Escolha o cardápio'; END IF;
  SELECT coalesce(ci.preco, i.preco) INTO v_preco
    FROM public.cardapio_cardapio_itens ci
    JOIN public.cardapios c ON c.id = ci.cardapio_id AND c.tenant_id = ci.tenant_id
    JOIN public.cardapio_itens i ON i.id = ci.item_id AND i.tenant_id = ci.tenant_id
   WHERE ci.cardapio_id = p_cardapio_id AND ci.item_id = p_cardapio_item_id AND ci.tenant_id = v_tenant AND c.ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'O item não está neste cardápio ou o cardápio está inativo'; END IF;

  -- todas as validações (comanda aberta, opções, grupos, item por peso...) são as do lançamento comum
  v_id := public.restaurante_lancar_item(p_comanda_id, p_cardapio_item_id, p_quantidade, p_opcoes, p_observacao);

  UPDATE public.comanda_itens
     SET preco_unitario = v_preco + coalesce((SELECT sum((o ->> 'preco_adicional')::numeric)
                                                FROM jsonb_array_elements(opcoes) o), 0),
         total = round(quantidade * (v_preco + coalesce((SELECT sum((o ->> 'preco_adicional')::numeric)
                                                          FROM jsonb_array_elements(opcoes) o), 0)), 2)
   WHERE id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_lancar_item_no_cardapio(uuid, uuid, numeric, uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_lancar_item_no_cardapio(uuid, uuid, numeric, uuid, uuid[], text) TO authenticated;

-- ===== Cardapio publico: um bloco por cardapio com uso online =====
CREATE OR REPLACE FUNCTION public.restaurante_cardapio_publico(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp record;
  v_cardapios jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[A-Za-z0-9-]{3,50}$' THEN RETURN NULL; END IF;

  SELECT e.tenant_id, coalesce(nullif(e.nome_fantasia, ''), e.razao_social) AS nome, e.cor_primaria, e.logo_path
    INTO v_emp
    FROM public.empresas e
    JOIN public.restaurante_config c ON c.tenant_id = e.tenant_id AND c.cardapio_online
   WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(p_slug) AND e.ativo
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(m.obj ORDER BY m.c_ordem, m.c_nome), '[]'::jsonb) INTO v_cardapios FROM (
    SELECT cd.ordem AS c_ordem, cd.nome AS c_nome,
           jsonb_build_object('nome', cd.nome, 'categorias', (
             SELECT coalesce(jsonb_agg(cat.obj ORDER BY cat.ord, cat.nome), '[]'::jsonb) FROM (
               SELECT g.ord, g.nome, jsonb_build_object('nome', g.nome, 'itens', g.itens) AS obj FROM (
                 SELECT coalesce(c.ordem, 2147483647) AS ord, coalesce(c.nome, 'Outros') AS nome,
                        jsonb_agg(jsonb_build_object(
                          'nome', i.nome,
                          'descricao', i.descricao,
                          'preco', coalesce(ci.preco, i.preco),
                          'por_peso', i.venda_por_peso,
                          'foto_path', i.foto_path,
                          'grupos', coalesce((
                            SELECT jsonb_agg(jsonb_build_object(
                                     'nome', gr.nome, 'obrigatorio', gr.obrigatorio, 'max_escolhas', gr.max_escolhas,
                                     'opcoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', o.nome, 'preco_adicional', o.preco_adicional)
                                                                         ORDER BY o.nome), '[]'::jsonb)
                                                  FROM public.cardapio_opcoes o
                                                 WHERE o.grupo_id = gr.id AND o.tenant_id = v_emp.tenant_id AND o.ativo))
                                   ORDER BY gr.nome)
                              FROM public.cardapio_grupos gr
                             WHERE gr.item_id = i.id AND gr.tenant_id = v_emp.tenant_id), '[]'::jsonb)
                        ) ORDER BY coalesce(ci.ordem, i.ordem), i.nome) AS itens
                   FROM public.cardapio_cardapio_itens ci
                   JOIN public.cardapio_itens i ON i.id = ci.item_id AND i.tenant_id = ci.tenant_id
                   LEFT JOIN public.cardapio_categorias c ON c.id = i.categoria_id AND c.tenant_id = i.tenant_id
                  WHERE ci.cardapio_id = cd.id AND ci.tenant_id = v_emp.tenant_id
                    AND i.ativo AND NOT i.interno AND (i.categoria_id IS NULL OR c.ativo)
                  GROUP BY c.id, c.ordem, c.nome
               ) g
             ) cat)) AS obj
      FROM public.cardapios cd
     WHERE cd.tenant_id = v_emp.tenant_id AND cd.ativo AND cd.uso_online
  ) m
  WHERE jsonb_array_length(m.obj -> 'categorias') > 0;

  RETURN jsonb_build_object(
    'empresa', jsonb_build_object('nome', v_emp.nome, 'cor', v_emp.cor_primaria, 'logo_path', v_emp.logo_path),
    'cardapios', v_cardapios);
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_cardapio_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restaurante_cardapio_publico(text) TO anon, authenticated, service_role;
