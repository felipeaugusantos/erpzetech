-- Restaurante: praças de produção cadastráveis, mesa bloqueada e reserva de mesa.
--
-- Praças: além de cozinha e bar (fixas), a gestão cadastra churrascaria, lanches, pizzaria etc. O item do cardápio
-- guarda o código da praça em `estacao` (e a comanda copia, como antes), então a fila da cozinha e o envio de pedidos
-- seguem funcionando sem mudar as RPCs. 'nenhuma' continua sendo "pronto para servir" (não passa pela produção).
--
-- Mesa bloqueada: não abre comanda nem recebe transferência (trava por gatilho, vale para qualquer caminho de escrita).
-- Só se bloqueia mesa sem comanda aberta, para a conta nunca ficar inacessível.
--
-- Reserva: data/hora, nome, telefone e pessoas. Uma reserva ativa vale como "reservada" no mapa de mesas a partir de
-- 30 min antes do horário até 2 h depois; ao abrir a comanda na mesa a reserva vira "atendida". Escrita só por função.

-- ===== Praças de produção =====
CREATE TABLE IF NOT EXISTS public.restaurante_pracas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 40),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurante_pracas_codigo_uk ON public.restaurante_pracas (tenant_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS restaurante_pracas_nome_uk ON public.restaurante_pracas (tenant_id, lower(btrim(nome)));

-- o código nasce do nome, não muda depois e não pode repetir os fixos
CREATE OR REPLACE FUNCTION public.restaurante_praca_antes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_codigo text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.codigo := OLD.codigo;
    RETURN NEW;
  END IF;
  v_codigo := regexp_replace(
    translate(lower(btrim(NEW.nome)),
              chr(225) || chr(224) || chr(226) || chr(227) || chr(228) || chr(233) || chr(232) || chr(234) || chr(235) || chr(237) || chr(236) || chr(238) || chr(239) || chr(243) || chr(242) || chr(244) || chr(245) || chr(246) || chr(250) || chr(249) || chr(251) || chr(252) || chr(231) || chr(241),
              'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '_', 'g');
  v_codigo := btrim(v_codigo, '_');
  IF char_length(v_codigo) < 2 THEN
    RAISE EXCEPTION 'Dê à praça um nome com pelo menos 2 letras ou números';
  END IF;
  IF v_codigo IN ('cozinha', 'bar', 'nenhuma') THEN
    RAISE EXCEPTION 'Cozinha e Bar já existem; use outro nome para a praça';
  END IF;
  NEW.codigo := left(v_codigo, 40);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_restaurante_praca_antes ON public.restaurante_pracas;
CREATE TRIGGER trg_restaurante_praca_antes BEFORE INSERT OR UPDATE ON public.restaurante_pracas
  FOR EACH ROW EXECUTE FUNCTION public.restaurante_praca_antes();

-- praça em uso por item do cardápio não é excluída (desative em vez disso)
CREATE OR REPLACE FUNCTION public.restaurante_praca_excluir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cardapio_itens WHERE tenant_id = OLD.tenant_id AND estacao = OLD.codigo) THEN
    RAISE EXCEPTION 'A praça % está em uso por itens do cardápio; desative-a em vez de excluir', OLD.nome;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_restaurante_praca_excluir ON public.restaurante_pracas;
CREATE TRIGGER trg_restaurante_praca_excluir BEFORE DELETE ON public.restaurante_pracas
  FOR EACH ROW EXECUTE FUNCTION public.restaurante_praca_excluir();

ALTER TABLE public.restaurante_pracas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurante_pracas FROM PUBLIC, anon;
GRANT ALL ON public.restaurante_pracas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurante_pracas TO authenticated;
-- a cozinha e o salão leem as praças para filtrar e mostrar o nome; só a gestão cadastra
DROP POLICY IF EXISTS restaurante_pracas_select ON public.restaurante_pracas;
CREATE POLICY restaurante_pracas_select ON public.restaurante_pracas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());
DROP POLICY IF EXISTS restaurante_pracas_insert ON public.restaurante_pracas;
CREATE POLICY restaurante_pracas_insert ON public.restaurante_pracas FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());
DROP POLICY IF EXISTS restaurante_pracas_update ON public.restaurante_pracas;
CREATE POLICY restaurante_pracas_update ON public.restaurante_pracas FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS restaurante_pracas_delete ON public.restaurante_pracas;
CREATE POLICY restaurante_pracas_delete ON public.restaurante_pracas FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());

-- o item aceita cozinha, bar, nenhuma ou uma praça ativa cadastrada na própria empresa
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_estacao_check;
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_estacao_formato_ck;
ALTER TABLE public.cardapio_itens ADD CONSTRAINT cardapio_itens_estacao_formato_ck
  CHECK (estacao ~ '^[a-z0-9_]{2,40}$');

CREATE OR REPLACE FUNCTION public.restaurante_item_praca_valida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estacao IN ('cozinha', 'bar', 'nenhuma') THEN RETURN NEW; END IF;
  -- no UPDATE, manter a praça de antes (mesmo se depois desativada) não é recusado
  IF TG_OP = 'UPDATE' AND NEW.estacao IS NOT DISTINCT FROM OLD.estacao THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurante_pracas
                  WHERE tenant_id = NEW.tenant_id AND codigo = NEW.estacao AND ativo) THEN
    RAISE EXCEPTION 'Praça de produção não encontrada ou inativa';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cardapio_itens_praca ON public.cardapio_itens;
CREATE TRIGGER trg_cardapio_itens_praca BEFORE INSERT OR UPDATE OF estacao ON public.cardapio_itens
  FOR EACH ROW EXECUTE FUNCTION public.restaurante_item_praca_valida();

-- ===== Mesa bloqueada =====
ALTER TABLE public.mesas
  ADD COLUMN IF NOT EXISTS bloqueada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueio_motivo text,
  ADD COLUMN IF NOT EXISTS bloqueada_em timestamptz;

-- mesa bloqueada não abre comanda nem recebe transferência; abrir comanda numa mesa reservada atende a reserva
CREATE OR REPLACE FUNCTION public.restaurante_comanda_mesa_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mesa_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.mesa_id IS NOT DISTINCT FROM OLD.mesa_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.mesas WHERE id = NEW.mesa_id AND tenant_id = NEW.tenant_id AND bloqueada) THEN
    RAISE EXCEPTION 'Mesa bloqueada: desbloqueie antes de usar';
  END IF;
  UPDATE public.mesa_reservas SET situacao = 'atendida'
   WHERE mesa_id = NEW.mesa_id AND tenant_id = NEW.tenant_id AND situacao = 'ativa'
     AND reservada_para BETWEEN now() - interval '2 hours' AND now() + interval '30 minutes';
  RETURN NEW;
END;
$$;

-- ===== Reservas =====
CREATE TABLE IF NOT EXISTS public.mesa_reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  mesa_id uuid NOT NULL,
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 80),
  telefone text CHECK (telefone IS NULL OR char_length(telefone) <= 30),
  pessoas integer CHECK (pessoas IS NULL OR (pessoas > 0 AND pessoas <= 500)),
  reservada_para timestamptz NOT NULL,
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 300),
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'atendida', 'cancelada')),
  criada_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_reservas_mesa_fk FOREIGN KEY (mesa_id, tenant_id)
    REFERENCES public.mesas (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS mesa_reservas_idx ON public.mesa_reservas (tenant_id, mesa_id, reservada_para) WHERE situacao = 'ativa';

ALTER TABLE public.mesa_reservas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_reservas FROM PUBLIC, anon;
GRANT ALL ON public.mesa_reservas TO service_role;
GRANT SELECT ON public.mesa_reservas TO authenticated;
DROP POLICY IF EXISTS mesa_reservas_select ON public.mesa_reservas;
CREATE POLICY mesa_reservas_select ON public.mesa_reservas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());

-- o gatilho de comanda precisa da tabela de reservas, por isso é criado depois dela
DROP TRIGGER IF EXISTS trg_comandas_mesa_trava ON public.comandas;
CREATE TRIGGER trg_comandas_mesa_trava BEFORE INSERT OR UPDATE OF mesa_id ON public.comandas
  FOR EACH ROW EXECUTE FUNCTION public.restaurante_comanda_mesa_trava();

-- ===== Funções =====
CREATE OR REPLACE FUNCTION public.restaurante_bloquear_mesa(
  p_mesa_id uuid,
  p_bloquear boolean,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_mesa public.mesas%ROWTYPE;
BEGIN
  SELECT * INTO v_mesa FROM public.mesas WHERE id = p_mesa_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mesa não encontrada'; END IF;

  IF p_bloquear THEN
    IF EXISTS (SELECT 1 FROM public.comandas WHERE mesa_id = p_mesa_id AND tenant_id = v_tenant AND situacao = 'aberta') THEN
      RAISE EXCEPTION 'A mesa tem comanda aberta; feche ou transfira a conta antes de bloquear';
    END IF;
    UPDATE public.mesas
       SET bloqueada = true, bloqueio_motivo = nullif(left(btrim(coalesce(p_motivo, '')), 200), ''), bloqueada_em = now()
     WHERE id = p_mesa_id;
  ELSE
    UPDATE public.mesas SET bloqueada = false, bloqueio_motivo = NULL, bloqueada_em = NULL WHERE id = p_mesa_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restaurante_reservar_mesa(
  p_mesa_id uuid,
  p_nome text,
  p_para timestamptz,
  p_telefone text DEFAULT NULL,
  p_pessoas integer DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_mesa public.mesas%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_nome IS NULL OR btrim(p_nome) = '' THEN RAISE EXCEPTION 'Informe o nome de quem reservou'; END IF;
  IF p_para IS NULL OR p_para < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Informe uma data e hora que ainda não passou';
  END IF;
  IF p_para > now() + interval '1 year' THEN RAISE EXCEPTION 'Reserva distante demais'; END IF;

  SELECT * INTO v_mesa FROM public.mesas WHERE id = p_mesa_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mesa não encontrada'; END IF;
  IF NOT v_mesa.ativa THEN RAISE EXCEPTION 'Mesa desativada'; END IF;
  IF v_mesa.bloqueada THEN RAISE EXCEPTION 'Mesa bloqueada: desbloqueie antes de reservar'; END IF;

  -- duas reservas da mesma mesa com menos de 2 h de diferença se atropelam
  IF EXISTS (SELECT 1 FROM public.mesa_reservas
              WHERE mesa_id = p_mesa_id AND tenant_id = v_tenant AND situacao = 'ativa'
                AND abs(extract(epoch FROM (reservada_para - p_para))) < 7200) THEN
    RAISE EXCEPTION 'Já existe reserva desta mesa em horário próximo (menos de 2 horas)';
  END IF;

  INSERT INTO public.mesa_reservas (tenant_id, mesa_id, nome, telefone, pessoas, reservada_para, observacao)
  VALUES (v_tenant, p_mesa_id, btrim(p_nome), nullif(btrim(coalesce(p_telefone, '')), ''), p_pessoas, p_para,
          nullif(btrim(coalesce(p_observacao, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restaurante_cancelar_reserva(p_reserva_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
BEGIN
  UPDATE public.mesa_reservas SET situacao = 'cancelada'
   WHERE id = p_reserva_id AND tenant_id = v_tenant AND situacao = 'ativa';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada ou já encerrada'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_bloquear_mesa(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_reservar_mesa(uuid, text, timestamptz, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_cancelar_reserva(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_bloquear_mesa(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_reservar_mesa(uuid, text, timestamptz, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_cancelar_reserva(uuid) TO authenticated;
