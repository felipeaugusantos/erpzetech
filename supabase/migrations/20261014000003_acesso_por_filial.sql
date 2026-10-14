-- R13 — Acesso por filial (decisão do dono: o usuário de uma filial opera só a filial dele).
--
-- Regra: administrador e gestor enxergam e operam todas as filiais da empresa; usuário sem filial no perfil também
-- (matriz); quem tem filial no perfil só enxerga e só grava linhas da própria filial. Linha sem filial
-- (cadastro geral) continua visível a todos da empresa.
--
-- Duas camadas, porque as funções do banco rodam como dono e ignoram as políticas de linha:
--   1. política RESTRITIVA nas tabelas que têm filial (e, por herança, nas filhas): vale para leitura e escrita direta;
--   2. gatilho antes de gravar: vale também dentro das funções (venda, caixa, nota, entrega, estoque), porque o
--      usuário da chamada continua sendo auth.uid() dentro delas.

CREATE OR REPLACE FUNCTION public.filial_irrestrita()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NULL
      OR public.has_role(auth.uid(), 'administrador')
      OR public.has_role(auth.uid(), 'gestor')
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.filial_id IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.pode_filial(p_filial_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_filial_id IS NULL
      OR public.filial_irrestrita()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.filial_id = p_filial_id)
$$;

REVOKE ALL ON FUNCTION public.filial_irrestrita() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pode_filial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filial_irrestrita() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_filial(uuid) TO authenticated;

-- ===== 1. Políticas restritivas =====
DO $$
DECLARE
  t text;
BEGIN
  -- tabelas que têm a coluna filial_id
  FOREACH t IN ARRAY ARRAY['pedidos', 'caixas', 'depositos', 'contas_receber', 'contas_pagar', 'nfe', 'orcamentos',
                           'compras', 'devolucoes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format($f$CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.pode_filial(filial_id))$f$, t);
  END LOOP;

  -- tabelas filhas: herdam a filial do pedido, do caixa ou do depósito (a consulta já passa pela política do pai)
  FOREACH t IN ARRAY ARRAY['pedido_itens', 'pedido_historico', 'entregas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format($f$CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.filial_irrestrita() OR pedido_id IN (SELECT id FROM public.pedidos))$f$, t);
  END LOOP;
  DROP POLICY IF EXISTS filial_restrita ON public.entrega_itens;
  CREATE POLICY filial_restrita ON public.entrega_itens AS RESTRICTIVE FOR ALL TO authenticated
    USING (public.filial_irrestrita() OR entrega_id IN (SELECT id FROM public.entregas));
  DROP POLICY IF EXISTS filial_restrita ON public.caixa_movimentos;
  CREATE POLICY filial_restrita ON public.caixa_movimentos AS RESTRICTIVE FOR ALL TO authenticated
    USING (public.filial_irrestrita() OR caixa_id IN (SELECT id FROM public.caixas));
  FOREACH t IN ARRAY ARRAY['estoques', 'estoque_movimentacoes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format($f$CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.filial_irrestrita() OR deposito_id IN (SELECT id FROM public.depositos))$f$, t);
  END LOOP;
END $$;

-- ===== 2. Gatilho para as gravações feitas dentro das funções do banco =====
CREATE OR REPLACE FUNCTION public.filial_protege()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_novo uuid;
  v_velho uuid;
BEGIN
  IF public.filial_irrestrita() THEN
    RETURN NEW;
  END IF;
  CASE TG_ARGV[0]
    WHEN 'filial' THEN
      v_novo := (to_jsonb(NEW) ->> 'filial_id')::uuid;
      IF TG_OP = 'UPDATE' THEN v_velho := (to_jsonb(OLD) ->> 'filial_id')::uuid; END IF;
    WHEN 'deposito' THEN
      SELECT d.filial_id INTO v_novo FROM public.depositos d WHERE d.id = (to_jsonb(NEW) ->> 'deposito_id')::uuid;
    WHEN 'pedido' THEN
      SELECT p.filial_id INTO v_novo FROM public.pedidos p WHERE p.id = (to_jsonb(NEW) ->> 'pedido_id')::uuid;
    WHEN 'caixa' THEN
      SELECT c.filial_id INTO v_novo FROM public.caixas c WHERE c.id = (to_jsonb(NEW) ->> 'caixa_id')::uuid;
  END CASE;
  IF NOT public.pode_filial(v_novo) OR NOT public.pode_filial(v_velho) THEN
    RAISE EXCEPTION 'Esta operação é de outra filial';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('pedidos', 'filial'), ('caixas', 'filial'), ('depositos', 'filial'), ('contas_receber', 'filial'),
      ('contas_pagar', 'filial'), ('nfe', 'filial'), ('orcamentos', 'filial'), ('compras', 'filial'),
      ('devolucoes', 'filial'),
      ('estoques', 'deposito'), ('estoque_movimentacoes', 'deposito'),
      ('pedido_itens', 'pedido'), ('entregas', 'pedido'), ('caixa_movimentos', 'caixa')
    ) AS x(tabela, modo)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS filial_protege_trg ON public.%I', r.tabela);
    EXECUTE format('CREATE TRIGGER filial_protege_trg BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.filial_protege(%L)', r.tabela, r.modo);
  END LOOP;
END $$;
