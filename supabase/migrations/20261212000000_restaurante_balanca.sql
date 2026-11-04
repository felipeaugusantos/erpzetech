-- Restaurante: balanca (venda por peso), tara e teto do buffet livre.
--
-- * Item vendido por peso: `venda_por_peso` marca que o preco do cardapio e por KG. O item so entra na comanda
--   pela pesagem (funcao restaurante_lancar_pesagem); o lancamento comum e recusado por gatilho.
-- * Tara: cadastro de pratos e vasilhames com o peso em gramas. O item pode ter uma tara padrao; na pesagem o
--   operador escolhe a tara (ou nenhuma) e o sistema cobra so o peso liquido.
-- * Buffet livre: com `buffet_livre_ativo`, cada prato pesado custa no maximo o preco do buffet livre (o menor
--   entre peso x preco do KG e o buffet livre). O teto vale por prato pesado.
-- O calculo e feito aqui no banco (a tela so mostra a previa); a pesagem fica gravada no item da comanda.

-- ===== Taras =====
CREATE TABLE IF NOT EXISTS public.restaurante_taras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 40),
  peso_g integer NOT NULL CHECK (peso_g BETWEEN 1 AND 5000),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurante_taras_id_tenant_uk UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurante_taras_nome_uk ON public.restaurante_taras (tenant_id, lower(btrim(nome)));

ALTER TABLE public.restaurante_taras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurante_taras FROM PUBLIC, anon;
GRANT ALL ON public.restaurante_taras TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurante_taras TO authenticated;
DROP POLICY IF EXISTS restaurante_taras_select ON public.restaurante_taras;
CREATE POLICY restaurante_taras_select ON public.restaurante_taras FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());
DROP POLICY IF EXISTS restaurante_taras_insert ON public.restaurante_taras;
CREATE POLICY restaurante_taras_insert ON public.restaurante_taras FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());
DROP POLICY IF EXISTS restaurante_taras_update ON public.restaurante_taras;
CREATE POLICY restaurante_taras_update ON public.restaurante_taras FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS restaurante_taras_delete ON public.restaurante_taras;
CREATE POLICY restaurante_taras_delete ON public.restaurante_taras FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());

-- ===== Item por peso e pesagem gravada no item da comanda =====
ALTER TABLE public.cardapio_itens
  ADD COLUMN IF NOT EXISTS venda_por_peso boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tara_id uuid;
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_tara_fk;
ALTER TABLE public.cardapio_itens ADD CONSTRAINT cardapio_itens_tara_fk
  FOREIGN KEY (tara_id, tenant_id) REFERENCES public.restaurante_taras (id, tenant_id) ON DELETE SET NULL (tara_id);
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_tara_so_por_peso_ck;
ALTER TABLE public.cardapio_itens ADD CONSTRAINT cardapio_itens_tara_so_por_peso_ck
  CHECK (venda_por_peso OR tara_id IS NULL);

ALTER TABLE public.comanda_itens
  ADD COLUMN IF NOT EXISTS peso_bruto_g integer CHECK (peso_bruto_g IS NULL OR peso_bruto_g > 0),
  ADD COLUMN IF NOT EXISTS tara_g integer CHECK (tara_g IS NULL OR tara_g >= 0),
  ADD COLUMN IF NOT EXISTS peso_liquido_g integer CHECK (peso_liquido_g IS NULL OR peso_liquido_g > 0),
  ADD COLUMN IF NOT EXISTS teto_buffet boolean NOT NULL DEFAULT false;

ALTER TABLE public.restaurante_config
  ADD COLUMN IF NOT EXISTS buffet_livre_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buffet_livre_preco numeric(14,2) CHECK (buffet_livre_preco IS NULL OR buffet_livre_preco > 0);
ALTER TABLE public.restaurante_config DROP CONSTRAINT IF EXISTS restaurante_config_buffet_ck;
ALTER TABLE public.restaurante_config ADD CONSTRAINT restaurante_config_buffet_ck
  CHECK (NOT buffet_livre_ativo OR buffet_livre_preco IS NOT NULL);

-- item por peso so entra na comanda pela pesagem (a funcao liga a marca por transacao)
CREATE OR REPLACE FUNCTION public.restaurante_item_peso_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('restaurante.pesagem', true) IS DISTINCT FROM '1'
     AND EXISTS (SELECT 1 FROM public.cardapio_itens
                  WHERE id = NEW.cardapio_item_id AND tenant_id = NEW.tenant_id AND venda_por_peso) THEN
    RAISE EXCEPTION 'Item vendido por peso: lance pela balança';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_comanda_itens_peso ON public.comanda_itens;
CREATE TRIGGER trg_comanda_itens_peso BEFORE INSERT ON public.comanda_itens
  FOR EACH ROW EXECUTE FUNCTION public.restaurante_item_peso_trava();

-- ===== Configuracao legivel pela operacao (a tabela de config e so da gestao) =====
CREATE OR REPLACE FUNCTION public.restaurante_balanca_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_cfg public.restaurante_config;
BEGIN
  SELECT * INTO v_cfg FROM public.restaurante_config WHERE tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'buffet_livre_ativo', coalesce(v_cfg.buffet_livre_ativo, false),
    'buffet_livre_preco', CASE WHEN coalesce(v_cfg.buffet_livre_ativo, false) THEN v_cfg.buffet_livre_preco END);
END;
$$;

-- ===== Calculo da pesagem (previa e lancamento usam o mesmo) =====
CREATE OR REPLACE FUNCTION public.restaurante_pesagem_calcular(
  p_cardapio_item_id uuid,
  p_peso_bruto_g integer,
  p_tara_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_item public.cardapio_itens;
  v_tara public.restaurante_taras;
  v_cfg public.restaurante_config;
  v_tara_g integer := 0;
  v_tara_nome text;
  v_liquido integer;
  v_sem_teto numeric(14,2);
  v_valor numeric(14,2);
  v_teto boolean := false;
BEGIN
  IF p_peso_bruto_g IS NULL OR p_peso_bruto_g < 1 OR p_peso_bruto_g > 30000 THEN
    RAISE EXCEPTION 'Informe um peso entre 1 g e 30 kg';
  END IF;
  SELECT * INTO v_item FROM public.cardapio_itens WHERE id = p_cardapio_item_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do cardápio não encontrado ou inativo'; END IF;
  IF NOT v_item.venda_por_peso THEN RAISE EXCEPTION 'O item % não é vendido por peso', v_item.nome; END IF;

  IF p_tara_id IS NOT NULL THEN
    SELECT * INTO v_tara FROM public.restaurante_taras WHERE id = p_tara_id AND tenant_id = v_tenant AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tara não encontrada ou inativa'; END IF;
    v_tara_g := v_tara.peso_g;
    v_tara_nome := v_tara.nome;
  END IF;
  v_liquido := p_peso_bruto_g - v_tara_g;
  IF v_liquido < 1 THEN RAISE EXCEPTION 'O peso (% g) não passa da tara (% g)', p_peso_bruto_g, v_tara_g; END IF;

  v_sem_teto := round(v_liquido * v_item.preco / 1000, 2);
  v_valor := v_sem_teto;
  SELECT * INTO v_cfg FROM public.restaurante_config WHERE tenant_id = v_tenant;
  IF FOUND AND v_cfg.buffet_livre_ativo AND v_cfg.buffet_livre_preco IS NOT NULL
     AND v_sem_teto > v_cfg.buffet_livre_preco THEN
    v_valor := v_cfg.buffet_livre_preco;
    v_teto := true;
  END IF;

  RETURN jsonb_build_object(
    'item', v_item.nome, 'preco_kg', v_item.preco,
    'bruto_g', p_peso_bruto_g, 'tara_g', v_tara_g, 'tara_nome', v_tara_nome, 'liquido_g', v_liquido,
    'valor_sem_teto', v_sem_teto, 'valor', v_valor, 'teto_aplicado', v_teto);
END;
$$;

-- ===== Lancar a pesagem na comanda =====
CREATE OR REPLACE FUNCTION public.restaurante_lancar_pesagem(
  p_comanda_id uuid,
  p_cardapio_item_id uuid,
  p_peso_bruto_g integer,
  p_tara_id uuid DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_calc jsonb;
  v_item public.cardapio_itens;
  v_liquido integer;
  v_obs text;
  v_id uuid;
BEGIN
  PERFORM 1 FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'aberta' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  v_calc := public.restaurante_pesagem_calcular(p_cardapio_item_id, p_peso_bruto_g, p_tara_id);
  SELECT * INTO v_item FROM public.cardapio_itens WHERE id = p_cardapio_item_id AND tenant_id = v_tenant;
  v_liquido := (v_calc ->> 'liquido_g')::integer;

  v_obs := 'Pesagem: bruto ' || to_char(p_peso_bruto_g / 1000.0, 'FM990.000')
           || ' kg - tara ' || to_char((v_calc ->> 'tara_g')::integer / 1000.0, 'FM990.000') || ' kg'
           || coalesce(' (' || (v_calc ->> 'tara_nome') || ')', '')
           || ' = ' || to_char(v_liquido / 1000.0, 'FM990.000') || ' kg'
           || CASE WHEN (v_calc ->> 'teto_aplicado')::boolean THEN '; valor limitado ao buffet livre' ELSE '' END
           || coalesce('. ' || nullif(btrim(p_observacao), ''), '');

  PERFORM set_config('restaurante.pesagem', '1', true);
  INSERT INTO public.comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, opcoes, quantidade,
                                    preco_unitario, total, observacao, situacao, lancado_por, enviado_em, entregue_em,
                                    peso_bruto_g, tara_g, peso_liquido_g, teto_buffet)
  VALUES (v_tenant, p_comanda_id, v_item.id, v_item.nome, 'nenhuma', '[]'::jsonb, v_liquido / 1000.0,
          v_item.preco, (v_calc ->> 'valor')::numeric, v_obs, 'entregue', auth.uid(), now(), now(),
          p_peso_bruto_g, (v_calc ->> 'tara_g')::integer, v_liquido, (v_calc ->> 'teto_aplicado')::boolean)
  RETURNING id INTO v_id;
  PERFORM set_config('restaurante.pesagem', '0', true);

  RETURN v_calc || jsonb_build_object('item_id', v_id);
END;
$$;

-- ===== Cardapio publico: item por peso mostra "/kg" =====
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_cardapio_publico(text)'::regprocedure);
  novo text;
BEGIN
  -- ja ajustada (migration rodada antes): nada a fazer
  IF def LIKE '%''por_peso'', i.venda_por_peso%' THEN RETURN; END IF;
  novo := replace(def, $q$'preco', i.preco,$q$, $q$'preco', i.preco, 'por_peso', i.venda_por_peso,$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar restaurante_cardapio_publico ao item por peso'; END IF;
  EXECUTE novo;
END $$;

REVOKE ALL ON FUNCTION public.restaurante_balanca_config() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_pesagem_calcular(uuid, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_lancar_pesagem(uuid, uuid, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_balanca_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_pesagem_calcular(uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_lancar_pesagem(uuid, uuid, integer, uuid, text) TO authenticated;
