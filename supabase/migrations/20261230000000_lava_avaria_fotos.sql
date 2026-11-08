-- Lava rápido: foto ligada a cada avaria do checklist de entrada (até 3 por avaria).
-- Usa o mesmo circuito das fotos de antes e depois (reserva, envio, confirmação, cancelamento com motivo, link temporário);
-- a foto da avaria é sempre "antes" e não entra no limite de 12 nem na contagem do cartão do pátio.
-- avaria_id não tem chave estrangeira de propósito: a foto não se apaga nem se altera, então a avaria só sai (antes de o
-- checklist ser concluído) quando não tem foto ativa; a foto cancelada fica no registro.

ALTER TABLE public.lr_fotos ADD COLUMN IF NOT EXISTS avaria_id uuid;
ALTER TABLE public.lr_fotos DROP CONSTRAINT IF EXISTS lr_fotos_avaria_momento_chk;
ALTER TABLE public.lr_fotos ADD CONSTRAINT lr_fotos_avaria_momento_chk CHECK (avaria_id IS NULL OR momento = 'antes');
CREATE INDEX IF NOT EXISTS lr_fotos_avaria_idx ON public.lr_fotos (avaria_id) WHERE avaria_id IS NOT NULL;

-- ============ reservar o envio (agora com a avaria opcional) ============
DROP FUNCTION IF EXISTS public.lr_foto_preparar(uuid, text, text, text, bigint);
CREATE OR REPLACE FUNCTION public.lr_foto_preparar(p_ordem_id uuid, p_momento text, p_nome_arquivo text, p_mime text, p_tamanho bigint, p_avaria_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  v_nome text := btrim(coalesce(p_nome_arquivo, ''));
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_caminho text;
  v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF p_momento NOT IN ('antes', 'depois') THEN RAISE EXCEPTION 'Informe se a foto é de antes ou de depois'; END IF;
  IF p_avaria_id IS NOT NULL AND p_momento <> 'antes' THEN RAISE EXCEPTION 'A foto de uma avaria é da entrada do veículo (antes)'; END IF;
  v_ext := CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Formato não aceito: envie JPEG, PNG ou WebP'; END IF;
  IF p_tamanho IS NULL OR p_tamanho < 1 OR p_tamanho > 8388608 THEN RAISE EXCEPTION 'A foto precisa ter até 8 MB'; END IF;
  IF length(v_nome) < 1 OR length(v_nome) > 120 THEN RAISE EXCEPTION 'Nome do arquivo inválido (até 120 caracteres)'; END IF;
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.situacao = 'cancelada' THEN RAISE EXCEPTION 'A ordem foi cancelada'; END IF;

  IF p_avaria_id IS NULL THEN
    SELECT count(*)::int INTO v_n FROM public.lr_fotos
     WHERE ordem_id = o.id AND momento = p_momento AND avaria_id IS NULL
       AND (situacao = 'ativa' OR (situacao = 'pendente' AND created_at > now() - interval '1 hour'));
    IF v_n >= 12 THEN RAISE EXCEPTION 'Esta ordem já tem 12 fotos de %', p_momento; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.lr_avarias a WHERE a.id = p_avaria_id AND a.ordem_id = o.id AND a.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Avaria não encontrada nesta ordem';
    END IF;
    SELECT count(*)::int INTO v_n FROM public.lr_fotos
     WHERE avaria_id = p_avaria_id
       AND (situacao = 'ativa' OR (situacao = 'pendente' AND created_at > now() - interval '1 hour'));
    IF v_n >= 3 THEN RAISE EXCEPTION 'Esta avaria já tem 3 fotos'; END IF;
  END IF;

  v_caminho := v_tenant::text || '/' || o.id::text || '/' || v_id::text || '.' || v_ext;
  INSERT INTO public.lr_fotos (id, tenant_id, ordem_id, momento, nome_arquivo, mime, tamanho, caminho, avaria_id)
  VALUES (v_id, v_tenant, o.id, p_momento, v_nome, p_mime, p_tamanho, v_caminho, p_avaria_id);
  RETURN jsonb_build_object('id', v_id, 'caminho', v_caminho);
END $$;
REVOKE ALL ON FUNCTION public.lr_foto_preparar(uuid, text, text, text, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_foto_preparar(uuid, text, text, text, bigint, uuid) TO authenticated;

-- ============ confirmar: a avaria ainda precisa existir ============
CREATE OR REPLACE FUNCTION public.lr_foto_confirmar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f public.lr_fotos%ROWTYPE;
  v_meta jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO f FROM public.lr_fotos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR f.enviada_por <> auth.uid() THEN RAISE EXCEPTION 'Foto não encontrada'; END IF;
  IF f.situacao <> 'pendente' THEN RAISE EXCEPTION 'Esta foto já foi confirmada'; END IF;
  IF f.avaria_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lr_avarias a WHERE a.id = f.avaria_id AND a.tenant_id = f.tenant_id) THEN
    RAISE EXCEPTION 'A avaria desta foto foi removida';
  END IF;
  SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'lava-fotos' AND name = f.caminho;
  IF NOT FOUND THEN RAISE EXCEPTION 'O arquivo ainda não foi enviado: tente de novo'; END IF;
  IF coalesce(v_meta ->> 'size', '') <> f.tamanho::text OR coalesce(v_meta ->> 'mimetype', '') <> f.mime THEN
    RAISE EXCEPTION 'O arquivo enviado não confere com o informado: envie de novo';
  END IF;
  UPDATE public.lr_fotos SET situacao = 'ativa', confirmada_em = now() WHERE id = f.id;
END $$;
REVOKE ALL ON FUNCTION public.lr_foto_confirmar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_foto_confirmar(uuid) TO authenticated;

-- ============ lista da ordem: agora traz a avaria de cada foto ============
CREATE OR REPLACE FUNCTION public.lr_fotos_da_ordem(p_ordem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF NOT EXISTS (SELECT 1 FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'momento', f.momento, 'nome_arquivo', f.nome_arquivo, 'mime', f.mime, 'tamanho', f.tamanho,
                                         'caminho', f.caminho, 'created_at', f.created_at, 'avaria_id', f.avaria_id,
                                         'pode_cancelar', (f.enviada_por = auth.uid() OR public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))
                     ORDER BY f.momento, f.created_at)
      FROM public.lr_fotos f WHERE f.ordem_id = p_ordem_id AND f.tenant_id = v_tenant AND f.situacao = 'ativa'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.lr_fotos_da_ordem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fotos_da_ordem(uuid) TO authenticated;

-- ============ contagem do cartão do pátio: só as fotos de antes e depois da lavagem ============
CREATE OR REPLACE FUNCTION public.lr_fotos_contagem(p_ordens uuid[])
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
  RETURN coalesce((
    SELECT jsonb_object_agg(x.ordem_id::text, jsonb_build_object('antes', x.antes, 'depois', x.depois))
      FROM (SELECT f.ordem_id, count(*) FILTER (WHERE f.momento = 'antes')::int AS antes, count(*) FILTER (WHERE f.momento = 'depois')::int AS depois
              FROM public.lr_fotos f
             WHERE f.tenant_id = public.current_tenant_id() AND f.situacao = 'ativa' AND f.avaria_id IS NULL AND f.ordem_id = ANY (p_ordens)
             GROUP BY f.ordem_id) x), '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.lr_fotos_contagem(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fotos_contagem(uuid[]) TO authenticated;

-- ============ remover avaria: não com foto ativa (cancele a foto antes, com motivo) ============
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
  IF EXISTS (SELECT 1 FROM public.lr_fotos f WHERE f.avaria_id = p_id AND f.tenant_id = v_tenant
                AND (f.situacao = 'ativa' OR (f.situacao = 'pendente' AND f.created_at > now() - interval '1 hour'))) THEN
    RAISE EXCEPTION 'A avaria tem foto: cancele a foto antes de remover a avaria';
  END IF;
  DELETE FROM public.lr_avarias WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_avaria_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_avaria_remover(uuid) TO authenticated;
