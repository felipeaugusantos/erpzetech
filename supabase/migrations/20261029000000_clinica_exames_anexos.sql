-- Clínica (Fase 4, PR 4): anexos do exame e do atendimento — imagem (ultrassom, raio-x), laudo em arquivo e exame laboratorial (JPEG, PNG ou PDF, até 15 MB).
-- Armazenamento privado (nada de endereço público): o arquivo só abre por um link temporário, que o cliente só consegue gerar logo depois de
-- registrar a abertura (quem, quando, qual anexo) por uma função que confere perfil Veterinário e clínica liberada.
-- O envio também passa por função: ela reserva o caminho (anexo "pendente") e só esse caminho aceita upload; a confirmação confere o arquivo.
-- Anexo é imutável: não se troca nem se apaga; enviado por engano vira "cancelado, com motivo", que sai da lista normal e continua no registro.
-- Nenhuma tabela tem acesso direto e as políticas do armazenamento não permitem alterar nem apagar objeto.

-- ============ bucket privado ============
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clinica-anexos', 'clinica-anexos', false, 15728640, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 15728640, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

-- ============ tabela ============
CREATE TABLE IF NOT EXISTS public.pet_exame_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  exame_id uuid REFERENCES public.pet_exames(id),
  atendimento_id uuid REFERENCES public.pet_atendimentos_clinicos(id),
  categoria text NOT NULL CHECK (categoria IN ('imagem', 'laudo', 'laboratorial')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 200),
  nome_arquivo text NOT NULL CHECK (length(btrim(nome_arquivo)) BETWEEN 1 AND 120),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'application/pdf')),
  tamanho bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 15728640),
  caminho text NOT NULL UNIQUE,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'ativo', 'cancelado')),
  enviado_por uuid NOT NULL DEFAULT auth.uid(),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz,
  cancelado_em timestamptz,
  cancelado_motivo text,
  cancelado_por uuid,
  CHECK ((exame_id IS NOT NULL) <> (atendimento_id IS NOT NULL)),
  CHECK ((situacao = 'pendente') = (confirmado_em IS NULL)),
  CHECK ((situacao = 'cancelado') = (cancelado_em IS NOT NULL AND length(btrim(coalesce(cancelado_motivo, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS pet_exame_anexos_exame_idx ON public.pet_exame_anexos (exame_id) WHERE exame_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pet_exame_anexos_atend_idx ON public.pet_exame_anexos (atendimento_id) WHERE atendimento_id IS NOT NULL;

-- Auditoria da abertura de cada anexo (a política de leitura do armazenamento depende dela).
ALTER TABLE public.clinica_acessos ADD COLUMN IF NOT EXISTS anexo_id uuid REFERENCES public.pet_exame_anexos(id);
ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao', 'exame', 'anexo'));
CREATE INDEX IF NOT EXISTS clinica_acessos_anexo_idx ON public.clinica_acessos (anexo_id, profile_id, created_at DESC) WHERE anexo_id IS NOT NULL;

-- O anexo só muda para ser confirmado (pendente → ativo) ou cancelado com motivo (ativo → cancelado); nunca se apaga.
CREATE OR REPLACE FUNCTION public._clinica_anexo_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O anexo não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'cancelado' THEN RAISE EXCEPTION 'Anexo cancelado não muda'; END IF;
  IF NOT ((OLD.situacao = 'pendente' AND NEW.situacao = 'ativo') OR (OLD.situacao = 'ativo' AND NEW.situacao = 'cancelado')) THEN
    RAISE EXCEPTION 'Os dados do anexo não mudam';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'confirmado_em' - 'cancelado_em' - 'cancelado_motivo' - 'cancelado_por')
     IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'confirmado_em' - 'cancelado_em' - 'cancelado_motivo' - 'cancelado_por') THEN
    RAISE EXCEPTION 'Os dados do anexo não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_anexo_guarda ON public.pet_exame_anexos;
CREATE TRIGGER trg_clinica_anexo_guarda BEFORE UPDATE OR DELETE ON public.pet_exame_anexos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_anexo_guarda();

ALTER TABLE public.pet_exame_anexos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_exame_anexos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pet_exame_anexos TO service_role;
CREATE POLICY salao_restrito ON public.pet_exame_anexos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- ============ políticas do armazenamento ============
-- Envio: só para um caminho reservado por clinica_anexo_preparar (anexo pendente, do próprio veterinário, na última hora).
CREATE OR REPLACE FUNCTION public._clinica_anexo_pode_enviar(p_caminho text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'veterinario') AND public.clinica_liberada()
     AND EXISTS (SELECT 1 FROM public.pet_exame_anexos a
                  WHERE a.caminho = p_caminho AND a.situacao = 'pendente' AND a.enviado_por = auth.uid()
                    AND a.tenant_id = public.current_tenant_id() AND a.created_at > now() - interval '1 hour')
$$;
REVOKE ALL ON FUNCTION public._clinica_anexo_pode_enviar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._clinica_anexo_pode_enviar(text) TO authenticated;

-- Leitura (gerar o link temporário): só logo depois de clinica_anexo_abrir, que registra quem abriu.
CREATE OR REPLACE FUNCTION public._clinica_anexo_pode_ler(p_caminho text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'veterinario') AND public.clinica_liberada()
     AND EXISTS (SELECT 1 FROM public.clinica_acessos ac JOIN public.pet_exame_anexos a ON a.id = ac.anexo_id
                  WHERE ac.acao = 'anexo' AND ac.profile_id = auth.uid() AND ac.tenant_id = public.current_tenant_id()
                    AND a.caminho = p_caminho AND a.tenant_id = ac.tenant_id AND a.situacao IN ('ativo', 'cancelado')
                    AND ac.created_at > now() - interval '2 minutes')
$$;
REVOKE ALL ON FUNCTION public._clinica_anexo_pode_ler(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._clinica_anexo_pode_ler(text) TO authenticated;

DROP POLICY IF EXISTS clinica_anexos_enviar ON storage.objects;
DROP POLICY IF EXISTS clinica_anexos_ler ON storage.objects;
CREATE POLICY clinica_anexos_enviar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clinica-anexos' AND public._clinica_anexo_pode_enviar(name));
CREATE POLICY clinica_anexos_ler ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'clinica-anexos' AND public._clinica_anexo_pode_ler(name));
-- sem política de alterar ou apagar: o arquivo enviado não se troca nem se remove

-- ============ preparar o envio ============
-- p_dados: exame_id ou atendimento_id (um dos dois), categoria, descricao, nome_arquivo, mime, tamanho. Devolve o caminho a usar no upload.
CREATE OR REPLACE FUNCTION public.clinica_anexo_preparar(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_exame uuid := nullif(btrim(coalesce(p_dados ->> 'exame_id', '')), '')::uuid;
  v_atend uuid := nullif(btrim(coalesce(p_dados ->> 'atendimento_id', '')), '')::uuid;
  v_cat text := coalesce(p_dados ->> 'categoria', '');
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_nome text := btrim(coalesce(p_dados ->> 'nome_arquivo', ''));
  v_mime text := coalesce(p_dados ->> 'mime', '');
  v_tam bigint;
  v_pet uuid;
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_caminho text;
  v_crmv text; v_uf text;
  v_n integer;
BEGIN
  BEGIN
    v_tam := (p_dados ->> 'tamanho')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Tamanho do arquivo inválido';
  END;
  IF (v_exame IS NULL) = (v_atend IS NULL) THEN RAISE EXCEPTION 'Informe o exame ou o atendimento (só um dos dois)'; END IF;
  IF v_cat NOT IN ('imagem', 'laudo', 'laboratorial') THEN RAISE EXCEPTION 'Escolha o tipo do anexo: imagem, laudo ou exame laboratorial'; END IF;
  IF v_desc = '' THEN RAISE EXCEPTION 'Descreva o anexo (por exemplo, "Ultrassom abdominal")'; END IF;
  IF length(v_desc) > 200 THEN RAISE EXCEPTION 'A descrição aceita até 200 caracteres'; END IF;
  IF v_nome = '' OR length(v_nome) > 120 THEN RAISE EXCEPTION 'Nome do arquivo inválido (até 120 caracteres)'; END IF;
  v_ext := CASE v_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'application/pdf' THEN 'pdf' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Formato não aceito: envie JPEG, PNG ou PDF'; END IF;
  IF v_tam IS NULL OR v_tam < 1 THEN RAISE EXCEPTION 'Arquivo vazio'; END IF;
  IF v_tam > 15728640 THEN RAISE EXCEPTION 'O arquivo passa de 15 MB'; END IF;

  IF v_exame IS NOT NULL THEN
    SELECT pet_id INTO v_pet FROM public.pet_exames WHERE id = v_exame AND tenant_id = v_tenant AND situacao <> 'cancelado' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado ou cancelado'; END IF;
  ELSE
    SELECT pet_id INTO v_pet FROM public.pet_atendimentos_clinicos WHERE id = v_atend AND tenant_id = v_tenant FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  END IF;

  -- no máximo 20 anexos por exame ou atendimento (os pendentes de mais de uma hora não contam: o envio não aconteceu)
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_anexo:' || coalesce(v_exame, v_atend)::text, 0));
  SELECT count(*) INTO v_n FROM public.pet_exame_anexos a
   WHERE a.exame_id IS NOT DISTINCT FROM v_exame AND a.atendimento_id IS NOT DISTINCT FROM v_atend
     AND (a.situacao <> 'pendente' OR a.created_at > now() - interval '1 hour');
  IF v_n >= 20 THEN RAISE EXCEPTION 'Limite de 20 anexos por exame ou atendimento'; END IF;

  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
  v_caminho := v_tenant::text || '/' || v_pet::text || '/' || v_id::text || '.' || v_ext;
  INSERT INTO public.pet_exame_anexos (id, tenant_id, pet_id, exame_id, atendimento_id, categoria, descricao, nome_arquivo, mime, tamanho, caminho,
                                       veterinario_id, crmv, crmv_uf)
  VALUES (v_id, v_tenant, v_pet, v_exame, v_atend, v_cat, v_desc, v_nome, v_mime, v_tam, v_caminho, v_vet, v_crmv, v_uf);
  RETURN jsonb_build_object('id', v_id, 'caminho', v_caminho, 'mime', v_mime, 'tamanho', v_tam);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_preparar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_preparar(jsonb) TO authenticated;

-- ============ confirmar o envio ============
-- Confere que o arquivo está no armazenamento com o tamanho e o formato informados; só então o anexo passa a valer.
CREATE OR REPLACE FUNCTION public.clinica_anexo_confirmar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_exame_anexos%ROWTYPE;
  v_meta jsonb;
BEGIN
  SELECT * INTO a FROM public.pet_exame_anexos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR a.enviado_por <> auth.uid() OR a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  IF a.situacao <> 'pendente' THEN RAISE EXCEPTION 'Este anexo já foi confirmado'; END IF;
  SELECT metadata INTO v_meta FROM storage.objects WHERE bucket_id = 'clinica-anexos' AND name = a.caminho;
  IF NOT FOUND THEN RAISE EXCEPTION 'O arquivo ainda não foi enviado: tente de novo'; END IF;
  IF coalesce(v_meta ->> 'size', '') <> a.tamanho::text OR coalesce(v_meta ->> 'mimetype', '') <> a.mime THEN
    RAISE EXCEPTION 'O arquivo enviado não confere com o informado: envie de novo';
  END IF;
  UPDATE public.pet_exame_anexos SET situacao = 'ativo', confirmado_em = now() WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_confirmar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_confirmar(uuid) TO authenticated;

-- ============ lista (sem o caminho do arquivo) ============
CREATE OR REPLACE FUNCTION public.clinica_anexos(p_exame_id uuid DEFAULT NULL, p_atendimento_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_pet uuid;
BEGIN
  PERFORM public._clinica_vet();
  IF (p_exame_id IS NULL) = (p_atendimento_id IS NULL) THEN RAISE EXCEPTION 'Informe o exame ou o atendimento (só um dos dois)'; END IF;
  IF p_exame_id IS NOT NULL THEN
    SELECT pet_id INTO v_pet FROM public.pet_exames WHERE id = p_exame_id AND tenant_id = v_tenant;
  ELSE
    SELECT pet_id INTO v_pet FROM public.pet_atendimentos_clinicos WHERE id = p_atendimento_id AND tenant_id = v_tenant;
  END IF;
  IF v_pet IS NULL THEN RAISE EXCEPTION 'Exame ou atendimento não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, v_pet, p_atendimento_id, 'anexo');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'categoria', a.categoria, 'descricao', a.descricao, 'nome_arquivo', a.nome_arquivo, 'mime', a.mime, 'tamanho', a.tamanho,
             'situacao', a.situacao, 'created_at', a.created_at, 'veterinario', v.nome, 'crmv', a.crmv, 'crmv_uf', a.crmv_uf,
             'cancelado_em', a.cancelado_em, 'cancelado_motivo', a.cancelado_motivo) ORDER BY a.created_at)
      FROM public.pet_exame_anexos a JOIN public.pet_profissionais v ON v.id = a.veterinario_id
     WHERE a.tenant_id = v_tenant AND a.situacao <> 'pendente'
       AND a.exame_id IS NOT DISTINCT FROM p_exame_id AND a.atendimento_id IS NOT DISTINCT FROM p_atendimento_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexos(uuid, uuid) TO authenticated;

-- ============ abrir: registra quem abriu e libera, por 2 minutos, a geração do link temporário ============
CREATE OR REPLACE FUNCTION public.clinica_anexo_abrir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.pet_exame_anexos%ROWTYPE;
BEGIN
  PERFORM public._clinica_vet();
  SELECT * INTO a FROM public.pet_exame_anexos WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao IN ('ativo', 'cancelado');
  IF NOT FOUND THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao, anexo_id) VALUES (a.tenant_id, a.pet_id, a.atendimento_id, 'anexo', a.id);
  RETURN jsonb_build_object('caminho', a.caminho, 'mime', a.mime, 'nome_arquivo', a.nome_arquivo);
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_abrir(uuid) TO authenticated;

-- ============ cancelar (só quem enviou; o arquivo e o registro continuam) ============
CREATE OR REPLACE FUNCTION public.clinica_anexo_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  a public.pet_exame_anexos%ROWTYPE;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  IF length(v_motivo) > 500 THEN RAISE EXCEPTION 'O motivo aceita até 500 caracteres'; END IF;
  SELECT * INTO a FROM public.pet_exame_anexos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anexo não encontrado'; END IF;
  IF a.veterinario_id <> v_vet OR a.enviado_por <> auth.uid() THEN RAISE EXCEPTION 'Só o veterinário que enviou o anexo o cancela'; END IF;
  IF a.situacao <> 'ativo' THEN RAISE EXCEPTION 'Este anexo não está ativo'; END IF;
  UPDATE public.pet_exame_anexos SET situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = v_motivo, cancelado_por = auth.uid() WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_anexo_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_anexo_cancelar(uuid, text) TO authenticated;
