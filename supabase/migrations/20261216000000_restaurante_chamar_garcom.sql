-- Restaurante: chamar o garcom pelo QR code da mesa.
--
-- A gestao liga o recurso (restaurante_config.chamar_garcom), cadastra os motivos ("Chamar garcom", "Pedir a conta",
-- "Pedir agua"...) e imprime o QR code de cada mesa. O cliente le o QR, escolhe o motivo e o chamado aparece no PDV do
-- restaurante ate alguem marcar como atendido. A pagina do cliente e publica (sem login), por isso:
--   * o QR leva o id (uuid) da mesa, que nao se adivinha;
--   * so existe um chamado aberto por mesa e motivo, e repetir o toque em ate 20 s devolve o mesmo;
--   * ha um limite de chamados abertos por empresa.

ALTER TABLE public.restaurante_config ADD COLUMN IF NOT EXISTS chamar_garcom boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.restaurante_chamados_motivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 40),
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurante_chamados_motivos_id_tenant_uk UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurante_chamados_motivos_nome_uk
  ON public.restaurante_chamados_motivos (tenant_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.restaurante_chamados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  mesa_id uuid NOT NULL,
  motivo_id uuid,
  motivo text NOT NULL CHECK (btrim(motivo) <> '' AND char_length(motivo) <= 40),
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'atendido')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atendido_em timestamptz,
  atendido_por uuid,
  CONSTRAINT restaurante_chamados_mesa_fk FOREIGN KEY (mesa_id, tenant_id)
    REFERENCES public.mesas (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT restaurante_chamados_motivo_fk FOREIGN KEY (motivo_id, tenant_id)
    REFERENCES public.restaurante_chamados_motivos (id, tenant_id) ON DELETE SET NULL (motivo_id),
  CONSTRAINT restaurante_chamados_atendimento_ck CHECK ((situacao = 'aberto') = (atendido_em IS NULL))
);
-- um chamado aberto por mesa e motivo (motivo vazio conta como um só)
CREATE UNIQUE INDEX IF NOT EXISTS restaurante_chamados_aberto_uk
  ON public.restaurante_chamados (mesa_id, motivo) WHERE situacao = 'aberto';
CREATE INDEX IF NOT EXISTS restaurante_chamados_fila_idx
  ON public.restaurante_chamados (tenant_id, situacao, criado_em);

ALTER TABLE public.restaurante_chamados_motivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurante_chamados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurante_chamados_motivos, public.restaurante_chamados FROM PUBLIC, anon;
GRANT ALL ON public.restaurante_chamados_motivos, public.restaurante_chamados TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurante_chamados_motivos TO authenticated;
GRANT SELECT ON public.restaurante_chamados TO authenticated;

DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.restaurante_chamados_motivos', 'restaurante_chamados_motivos_' || p);
  END LOOP;
  DROP POLICY IF EXISTS restaurante_chamados_select ON public.restaurante_chamados;
END $$;
CREATE POLICY restaurante_chamados_motivos_select ON public.restaurante_chamados_motivos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());
CREATE POLICY restaurante_chamados_motivos_insert ON public.restaurante_chamados_motivos FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());
CREATE POLICY restaurante_chamados_motivos_update ON public.restaurante_chamados_motivos FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY restaurante_chamados_motivos_delete ON public.restaurante_chamados_motivos FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());
CREATE POLICY restaurante_chamados_select ON public.restaurante_chamados FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                        AND schemaname = 'public' AND tablename = 'restaurante_chamados') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurante_chamados;
  END IF;
END $$;

-- ===== Publico: o que a pagina da mesa mostra =====
CREATE OR REPLACE FUNCTION public.restaurante_chamar_info(p_slug text, p_mesa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp record;
  v_mesa record;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[A-Za-z0-9-]{3,50}$' OR p_mesa_id IS NULL THEN RETURN NULL; END IF;
  SELECT e.tenant_id, coalesce(nullif(e.nome_fantasia, ''), e.razao_social) AS nome, e.cor_primaria
    INTO v_emp
    FROM public.empresas e
    JOIN public.restaurante_config c ON c.tenant_id = e.tenant_id AND c.chamar_garcom
   WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(p_slug) AND e.ativo
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT numero INTO v_mesa FROM public.mesas WHERE id = p_mesa_id AND tenant_id = v_emp.tenant_id AND ativa;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'empresa', jsonb_build_object('nome', v_emp.nome, 'cor', v_emp.cor_primaria),
    'mesa', v_mesa.numero,
    'motivos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome) ORDER BY m.ordem, m.nome)
                           FROM public.restaurante_chamados_motivos m
                          WHERE m.tenant_id = v_emp.tenant_id AND m.ativo), '[]'::jsonb));
END;
$$;

-- ===== Publico: chamar =====
CREATE OR REPLACE FUNCTION public.restaurante_chamar_garcom(p_slug text, p_mesa_id uuid, p_motivo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_motivo text := 'Chamar garçom';
  v_existente public.restaurante_chamados;
  v_id uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[A-Za-z0-9-]{3,50}$' OR p_mesa_id IS NULL THEN RAISE EXCEPTION 'Chamado indisponível'; END IF;
  SELECT e.tenant_id INTO v_tenant
    FROM public.empresas e
    JOIN public.restaurante_config c ON c.tenant_id = e.tenant_id AND c.chamar_garcom
   WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(p_slug) AND e.ativo
   LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Chamado indisponível'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mesas WHERE id = p_mesa_id AND tenant_id = v_tenant AND ativa) THEN
    RAISE EXCEPTION 'Chamado indisponível';
  END IF;

  IF p_motivo_id IS NOT NULL THEN
    SELECT nome INTO v_motivo FROM public.restaurante_chamados_motivos
     WHERE id = p_motivo_id AND tenant_id = v_tenant AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Motivo indisponível'; END IF;
  END IF;

  -- ja ha um chamado aberto igual, ou um muito recente da mesma mesa: devolve o mesmo (toque repetido)
  SELECT * INTO v_existente FROM public.restaurante_chamados
   WHERE mesa_id = p_mesa_id AND tenant_id = v_tenant
     AND ((situacao = 'aberto' AND motivo = v_motivo) OR criado_em > now() - interval '20 seconds')
   ORDER BY criado_em DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existente.id, 'repetido', true);
  END IF;

  IF (SELECT count(*) FROM public.restaurante_chamados WHERE tenant_id = v_tenant AND situacao = 'aberto') >= 200 THEN
    RAISE EXCEPTION 'Muitos chamados abertos: chame o garçom pessoalmente';
  END IF;

  INSERT INTO public.restaurante_chamados (tenant_id, mesa_id, motivo_id, motivo)
  VALUES (v_tenant, p_mesa_id, p_motivo_id, v_motivo)
  ON CONFLICT (mesa_id, motivo) WHERE situacao = 'aberto' DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'repetido', v_id IS NULL);
END;
$$;

-- ===== Atender =====
CREATE OR REPLACE FUNCTION public.restaurante_chamado_atender(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
BEGIN
  UPDATE public.restaurante_chamados
     SET situacao = 'atendido', atendido_em = now(), atendido_por = auth.uid()
   WHERE id = p_id AND tenant_id = v_tenant AND situacao = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado ou já atendido'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_chamar_info(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restaurante_chamar_garcom(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restaurante_chamado_atender(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_chamar_info(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restaurante_chamar_garcom(text, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restaurante_chamado_atender(uuid) TO authenticated;
