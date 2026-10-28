-- Lava rápido (Fase 3, etapa 1): checklist de avarias na entrada do veículo.
-- A recepção registra as avarias que já existem (local, tipo e descrição) ou confirma que não há nenhuma, antes de lavar.
-- Depois de concluído o checklist não se apaga nem se troca. Uma avaria nova achada depois ainda pode ser acrescentada.
-- Cada empresa escolhe se o checklist é obrigatório para começar a lavagem (padrão: não, para não travar quem já usa o pátio).

ALTER TABLE public.lr_ordens ADD COLUMN IF NOT EXISTS checklist_em timestamptz;
ALTER TABLE public.lr_ordens ADD COLUMN IF NOT EXISTS checklist_por uuid;
ALTER TABLE public.lr_ordens ADD COLUMN IF NOT EXISTS checklist_sem_avarias boolean;

CREATE TABLE IF NOT EXISTS public.lr_config (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  checklist_obrigatorio boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lr_avarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.lr_ordens(id),
  lugar text NOT NULL CHECK (length(btrim(lugar)) BETWEEN 2 AND 60),
  tipo text NOT NULL CHECK (tipo IN ('risco', 'amassado', 'trinca', 'mancha', 'falta_peca', 'outro')),
  descricao text CHECK (descricao IS NULL OR length(descricao) <= 300),
  registrada_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lr_avarias_ordem_idx ON public.lr_avarias (ordem_id);

DO $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_config', 'lr_avarias'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $fn$;

CREATE OR REPLACE FUNCTION public.lr_config_salvar(p_checklist_obrigatorio boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  INSERT INTO public.lr_config (tenant_id, checklist_obrigatorio) VALUES (public.current_tenant_id(), coalesce(p_checklist_obrigatorio, false))
  ON CONFLICT (tenant_id) DO UPDATE SET checklist_obrigatorio = EXCLUDED.checklist_obrigatorio;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_config_salvar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_config_salvar(boolean) TO authenticated;

-- Registrar uma avaria: ordem ainda não entregue nem cancelada. Se o checklist já tinha sido concluído como "sem avarias", deixa de ser.
CREATE OR REPLACE FUNCTION public.lr_avaria_registrar(p_ordem_id uuid, p_local text, p_tipo text, p_descricao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.situacao IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'A ordem já está encerrada'; END IF;
  IF length(btrim(coalesce(p_local, ''))) < 2 OR length(btrim(p_local)) > 60 THEN RAISE EXCEPTION 'Informe o local da avaria'; END IF;
  IF p_tipo NOT IN ('risco', 'amassado', 'trinca', 'mancha', 'falta_peca', 'outro') THEN RAISE EXCEPTION 'Tipo de avaria inválido'; END IF;
  IF length(coalesce(p_descricao, '')) > 300 THEN RAISE EXCEPTION 'A descrição passa de 300 caracteres'; END IF;
  INSERT INTO public.lr_avarias (tenant_id, ordem_id, lugar, tipo, descricao)
  VALUES (v_tenant, o.id, btrim(p_local), p_tipo, nullif(btrim(coalesce(p_descricao, '')), ''))
  RETURNING id INTO v_id;
  IF o.checklist_em IS NOT NULL AND o.checklist_sem_avarias THEN
    UPDATE public.lr_ordens SET checklist_sem_avarias = false WHERE id = o.id;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_avaria_registrar(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_avaria_registrar(uuid, text, text, text) TO authenticated;

-- Corrigir um engano: só enquanto o checklist não foi concluído.
CREATE OR REPLACE FUNCTION public.lr_avaria_remover(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT od.* INTO o FROM public.lr_ordens od JOIN public.lr_avarias a ON a.ordem_id = od.id
   WHERE a.id = p_id AND a.tenant_id = v_tenant FOR UPDATE OF od;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avaria não encontrada'; END IF;
  IF o.checklist_em IS NOT NULL THEN RAISE EXCEPTION 'O checklist já foi concluído: a avaria registrada não se apaga'; END IF;
  DELETE FROM public.lr_avarias WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_avaria_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_avaria_remover(uuid) TO authenticated;

-- Concluir: "sem avarias" exige a lista vazia, e com avarias exige ao menos uma.
CREATE OR REPLACE FUNCTION public.lr_checklist_concluir(p_ordem_id uuid, p_sem_avarias boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.situacao IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'A ordem já está encerrada'; END IF;
  IF o.checklist_em IS NOT NULL THEN RAISE EXCEPTION 'O checklist desta ordem já foi concluído'; END IF;
  SELECT count(*)::int INTO v_n FROM public.lr_avarias WHERE ordem_id = o.id;
  IF p_sem_avarias AND v_n > 0 THEN RAISE EXCEPTION 'Há avarias registradas: conclua o checklist com elas'; END IF;
  IF NOT p_sem_avarias AND v_n = 0 THEN RAISE EXCEPTION 'Registre ao menos uma avaria ou conclua como sem avarias'; END IF;
  UPDATE public.lr_ordens SET checklist_em = now(), checklist_por = auth.uid(), checklist_sem_avarias = p_sem_avarias WHERE id = o.id;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_checklist_concluir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_checklist_concluir(uuid, boolean) TO authenticated;

-- Quadro do pátio: igual ao anterior (com a devolução da lavagem do plano ao cancelar), mais a exigência do checklist quando a empresa pede.
CREATE OR REPLACE FUNCTION public.lr_ordem_situacao(p_id uuid, p_para text, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  o public.lr_ordens%ROWTYPE;
  v_ok boolean;
  v_obrigatorio boolean;
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
  IF p_para = 'lavando' AND o.checklist_em IS NULL THEN
    SELECT c.checklist_obrigatorio INTO v_obrigatorio FROM public.lr_config c WHERE c.tenant_id = o.tenant_id;
    IF coalesce(v_obrigatorio, false) THEN RAISE EXCEPTION 'Conclua o checklist de avarias antes de começar a lavagem'; END IF;
  END IF;

  UPDATE public.lr_ordens
     SET situacao = p_para,
         pronto_em = CASE WHEN p_para = 'pronto' THEN now() ELSE NULL END,
         motivo_cancelamento = CASE WHEN p_para = 'cancelada' THEN nullif(btrim(p_motivo), '') ELSE NULL END
   WHERE id = o.id;
  IF p_para = 'cancelada' THEN
    UPDATE public.lr_assinatura_usos SET desfeito = true WHERE item_id IN (SELECT id FROM public.lr_ordem_itens WHERE ordem_id = o.id);
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_ordem_situacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_situacao(uuid, text, text) TO authenticated;
