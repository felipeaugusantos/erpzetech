-- Lava rápido (Fase 3, etapa 2): fotos de antes e depois da lavagem, para provar o estado do veículo na entrada e na saída.
-- Armazenamento privado (nada de endereço público): o arquivo só abre por link temporário de quem tem perfil do pátio.
-- O envio passa por função: ela reserva o caminho (foto "pendente") e só esse caminho aceita upload, e a confirmação confere o arquivo.
-- A foto não se troca nem se apaga: enviada por engano vira "cancelada, com motivo", que sai da lista e continua no registro.
-- Nenhuma tabela tem acesso direto e as políticas do armazenamento não permitem alterar nem apagar objeto.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lava-fotos', 'lava-fotos', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 8388608, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

CREATE TABLE IF NOT EXISTS public.lr_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.lr_ordens(id),
  momento text NOT NULL CHECK (momento IN ('antes', 'depois')),
  nome_arquivo text NOT NULL CHECK (length(btrim(nome_arquivo)) BETWEEN 1 AND 120),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  tamanho bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 8388608),
  caminho text NOT NULL UNIQUE,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'ativa', 'cancelada')),
  enviada_por uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmada_em timestamptz,
  cancelada_em timestamptz,
  cancelada_motivo text,
  cancelada_por uuid,
  CHECK ((situacao = 'pendente') = (confirmada_em IS NULL)),
  CHECK ((situacao = 'cancelada') = (cancelada_em IS NOT NULL AND length(btrim(coalesce(cancelada_motivo, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS lr_fotos_ordem_idx ON public.lr_fotos (ordem_id, momento, created_at);

-- A foto só muda para ser confirmada (pendente para ativa) ou cancelada com motivo (ativa para cancelada). Nunca se apaga.
CREATE OR REPLACE FUNCTION public._lr_foto_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A foto não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'cancelada' THEN RAISE EXCEPTION 'Foto cancelada não muda'; END IF;
  IF NOT ((OLD.situacao = 'pendente' AND NEW.situacao = 'ativa') OR (OLD.situacao = 'ativa' AND NEW.situacao = 'cancelada')) THEN
    RAISE EXCEPTION 'Os dados da foto não mudam';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'confirmada_em' - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por')
     IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'confirmada_em' - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por') THEN
    RAISE EXCEPTION 'Os dados da foto não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lr_foto_guarda ON public.lr_fotos;
CREATE TRIGGER trg_lr_foto_guarda BEFORE UPDATE OR DELETE ON public.lr_fotos
  FOR EACH ROW EXECUTE FUNCTION public._lr_foto_guarda();

ALTER TABLE public.lr_fotos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lr_fotos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lr_fotos TO service_role;
CREATE POLICY salao_restrito ON public.lr_fotos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- ============ políticas do armazenamento ============
CREATE OR REPLACE FUNCTION public._lr_foto_perfil_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.lava_rapido_liberado()
     AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'vendedor') OR public.has_role(auth.uid(), 'caixa'))
$$;
REVOKE ALL ON FUNCTION public._lr_foto_perfil_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._lr_foto_perfil_ok() TO authenticated;

-- Envio: só para um caminho reservado por lr_foto_preparar (foto pendente, de quem reservou, na última hora).
CREATE OR REPLACE FUNCTION public._lr_foto_pode_enviar(p_caminho text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._lr_foto_perfil_ok()
     AND EXISTS (SELECT 1 FROM public.lr_fotos f
                  WHERE f.caminho = p_caminho AND f.situacao = 'pendente' AND f.enviada_por = auth.uid()
                    AND f.tenant_id = public.current_tenant_id() AND f.created_at > now() - interval '1 hour')
$$;
REVOKE ALL ON FUNCTION public._lr_foto_pode_enviar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._lr_foto_pode_enviar(text) TO authenticated;

-- Leitura (gerar o link temporário): só foto ativa da própria empresa.
CREATE OR REPLACE FUNCTION public._lr_foto_pode_ler(p_caminho text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public._lr_foto_perfil_ok()
     AND EXISTS (SELECT 1 FROM public.lr_fotos f
                  WHERE f.caminho = p_caminho AND f.situacao = 'ativa' AND f.tenant_id = public.current_tenant_id())
$$;
REVOKE ALL ON FUNCTION public._lr_foto_pode_ler(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._lr_foto_pode_ler(text) TO authenticated;

DROP POLICY IF EXISTS lava_fotos_enviar ON storage.objects;
DROP POLICY IF EXISTS lava_fotos_ler ON storage.objects;
CREATE POLICY lava_fotos_enviar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lava-fotos' AND public._lr_foto_pode_enviar(name));
CREATE POLICY lava_fotos_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lava-fotos' AND public._lr_foto_pode_ler(name));
-- sem política de alterar ou apagar: o arquivo enviado não se troca nem se remove

-- ============ preparar o envio ============
-- Devolve o id e o caminho a usar no upload (empresa/ordem/id.extensão). Até 12 fotos por ordem e momento.
CREATE OR REPLACE FUNCTION public.lr_foto_preparar(p_ordem_id uuid, p_momento text, p_nome_arquivo text, p_mime text, p_tamanho bigint)
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
  v_ext := CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Formato não aceito: envie JPEG, PNG ou WebP'; END IF;
  IF p_tamanho IS NULL OR p_tamanho < 1 OR p_tamanho > 8388608 THEN RAISE EXCEPTION 'A foto precisa ter até 8 MB'; END IF;
  IF length(v_nome) < 1 OR length(v_nome) > 120 THEN RAISE EXCEPTION 'Nome do arquivo inválido (até 120 caracteres)'; END IF;
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.situacao = 'cancelada' THEN RAISE EXCEPTION 'A ordem foi cancelada'; END IF;
  SELECT count(*)::int INTO v_n FROM public.lr_fotos
   WHERE ordem_id = o.id AND momento = p_momento AND (situacao = 'ativa' OR (situacao = 'pendente' AND created_at > now() - interval '1 hour'));
  IF v_n >= 12 THEN RAISE EXCEPTION 'Esta ordem já tem 12 fotos de %', p_momento; END IF;

  v_caminho := v_tenant::text || '/' || o.id::text || '/' || v_id::text || '.' || v_ext;
  INSERT INTO public.lr_fotos (id, tenant_id, ordem_id, momento, nome_arquivo, mime, tamanho, caminho)
  VALUES (v_id, v_tenant, o.id, p_momento, v_nome, p_mime, p_tamanho, v_caminho);
  RETURN jsonb_build_object('id', v_id, 'caminho', v_caminho);
END $$;
REVOKE ALL ON FUNCTION public.lr_foto_preparar(uuid, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_foto_preparar(uuid, text, text, text, bigint) TO authenticated;

-- ============ confirmar o envio ============
-- Confere que o arquivo está no armazenamento com o tamanho e o formato informados. Só então a foto passa a valer.
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
  SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'lava-fotos' AND name = f.caminho;
  IF NOT FOUND THEN RAISE EXCEPTION 'O arquivo ainda não foi enviado: tente de novo'; END IF;
  IF coalesce(v_meta ->> 'size', '') <> f.tamanho::text OR coalesce(v_meta ->> 'mimetype', '') <> f.mime THEN
    RAISE EXCEPTION 'O arquivo enviado não confere com o informado: envie de novo';
  END IF;
  UPDATE public.lr_fotos SET situacao = 'ativa', confirmada_em = now() WHERE id = f.id;
END $$;
REVOKE ALL ON FUNCTION public.lr_foto_confirmar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_foto_confirmar(uuid) TO authenticated;

-- ============ lista da ordem (só fotos ativas) ============
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
                                         'caminho', f.caminho, 'created_at', f.created_at,
                                         'pode_cancelar', (f.enviada_por = auth.uid() OR public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))
                     ORDER BY f.momento, f.created_at)
      FROM public.lr_fotos f WHERE f.ordem_id = p_ordem_id AND f.tenant_id = v_tenant AND f.situacao = 'ativa'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.lr_fotos_da_ordem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fotos_da_ordem(uuid) TO authenticated;

-- Quantas fotos ativas cada ordem tem (para o cartão do pátio).
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
             WHERE f.tenant_id = public.current_tenant_id() AND f.situacao = 'ativa' AND f.ordem_id = ANY (p_ordens)
             GROUP BY f.ordem_id) x), '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.lr_fotos_contagem(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_fotos_contagem(uuid[]) TO authenticated;

-- ============ cancelar (nunca apagar) ============
CREATE OR REPLACE FUNCTION public.lr_foto_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE f public.lr_fotos%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO f FROM public.lr_fotos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Foto não encontrada'; END IF;
  IF f.situacao <> 'ativa' THEN RAISE EXCEPTION 'Só dá para cancelar foto ativa'; END IF;
  IF f.enviada_por <> auth.uid() AND NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')) THEN
    RAISE EXCEPTION 'Só quem enviou a foto, o gestor ou o administrador cancela';
  END IF;
  UPDATE public.lr_fotos SET situacao = 'cancelada', cancelada_em = now(), cancelada_motivo = btrim(p_motivo), cancelada_por = auth.uid() WHERE id = f.id;
END $$;
REVOKE ALL ON FUNCTION public.lr_foto_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_foto_cancelar(uuid, text) TO authenticated;
