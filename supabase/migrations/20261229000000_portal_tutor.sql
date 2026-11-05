-- Portal do tutor: o tutor entra com conta própria, vinculada ao cadastro dele por um CONVITE gerado pela recepção, e consulta só o que a
-- clínica liberou: exames fechados e receitas marcados "liberar ao tutor" e as próximas vacinas dos animais do cadastro dele.
-- Decisões aprovadas: convite gerado pela recepção ligado ao cadastro do tutor, revogável; o veterinário libera exames e receitas.
-- Regras que não se negociam:
--   * a identidade do tutor vem SEMPRE da sessão (auth.uid()); nenhum filtro vem do navegador;
--   * o tutor só enxerga animais do cadastro a que tem vínculo ATIVO; revogar o vínculo vale na hora, na próxima leitura;
--   * nada é enviado: o convite é um código mostrado uma vez para a recepção entregar; só o HASH do código fica no banco;
--   * tudo por função, sem acesso direto às tabelas; recepção e gestão não leem conteúdo clínico, só gerenciam acessos;
--   * a liberação vale só para o cadastro (tutor) para o qual foi feita: se o animal mudar de tutor, o novo precisa de nova liberação;
--   * não vai prontuário, nota interna, observação, motivo de cancelamento nem dado de outro tutor ou de outra empresa.

-- ============ convites ============
CREATE TABLE IF NOT EXISTS public.portal_convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  codigo_hash text NOT NULL UNIQUE,
  criado_por uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  usado_por uuid,
  revogado_em timestamptz,
  revogado_por uuid,
  CHECK ((usado_em IS NULL) = (usado_por IS NULL)),
  CHECK ((revogado_em IS NULL) = (revogado_por IS NULL))
);
CREATE INDEX IF NOT EXISTS portal_convites_idx ON public.portal_convites (tenant_id, cliente_id, created_at DESC);

-- ============ vínculos (o acesso do tutor) ============
CREATE TABLE IF NOT EXISTS public.portal_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  convite_id uuid REFERENCES public.portal_convites(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revogado_em timestamptz,
  revogado_por uuid,
  revogado_motivo text CHECK (revogado_motivo IS NULL OR length(btrim(revogado_motivo)) BETWEEN 3 AND 300),
  CHECK ((revogado_em IS NULL) = (revogado_por IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_vinculos_ativo_idx ON public.portal_vinculos (cliente_id, user_id) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS portal_vinculos_user_idx ON public.portal_vinculos (user_id) WHERE revogado_em IS NULL;

-- ============ liberações (o que o veterinário deixou o tutor ver) ============
CREATE TABLE IF NOT EXISTS public.portal_liberacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('exame', 'documento')),
  ref_id uuid NOT NULL,
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  liberado_por uuid NOT NULL REFERENCES public.pet_profissionais(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retirado_em timestamptz,
  retirado_por uuid REFERENCES public.pet_profissionais(id),
  CHECK ((retirado_em IS NULL) = (retirado_por IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_liberacoes_ativa_idx ON public.portal_liberacoes (tipo, ref_id) WHERE retirado_em IS NULL;
CREATE INDEX IF NOT EXISTS portal_liberacoes_pet_idx ON public.portal_liberacoes (tenant_id, pet_id);

-- ============ consultas do tutor e tentativas de código ============
CREATE TABLE IF NOT EXISTS public.portal_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  tipo text NOT NULL CHECK (tipo IN ('exame', 'documento')),
  ref_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS portal_acessos_idx ON public.portal_acessos (tenant_id, tipo, ref_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.portal_tentativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS portal_tentativas_idx ON public.portal_tentativas (user_id, created_at DESC);

-- Fatos não se apagam. Só mudam as colunas de encerramento (uso, revogação, retirada), uma vez cada; o resto é imutável.
-- Sem argumentos: tabela só de inclusão (nenhuma coluna muda).
CREATE OR REPLACE FUNCTION public._portal_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- sem argumentos o PostgreSQL entrega TG_ARGV nulo (não vazio): trata como "nenhuma coluna pode mudar"
  v_perm text[] := coalesce(TG_ARGV, ARRAY[]::text[]);
  c text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Registro do portal não se apaga'; END IF;
  IF (to_jsonb(NEW) - v_perm) IS DISTINCT FROM (to_jsonb(OLD) - v_perm) THEN
    RAISE EXCEPTION 'Registro do portal não se altera';
  END IF;
  FOREACH c IN ARRAY v_perm LOOP
    IF (to_jsonb(OLD) -> c) <> 'null'::jsonb AND (to_jsonb(NEW) -> c) IS DISTINCT FROM (to_jsonb(OLD) -> c) THEN
      RAISE EXCEPTION 'Registro do portal não se altera';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_convites', 'portal_vinculos', 'portal_liberacoes', 'portal_acessos', 'portal_tentativas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_portal_guarda ON public.portal_convites;
CREATE TRIGGER trg_portal_guarda BEFORE UPDATE OR DELETE ON public.portal_convites
  FOR EACH ROW EXECUTE FUNCTION public._portal_guarda('usado_em', 'usado_por', 'revogado_em', 'revogado_por');
DROP TRIGGER IF EXISTS trg_portal_guarda ON public.portal_vinculos;
CREATE TRIGGER trg_portal_guarda BEFORE UPDATE OR DELETE ON public.portal_vinculos
  FOR EACH ROW EXECUTE FUNCTION public._portal_guarda('revogado_em', 'revogado_por', 'revogado_motivo');
DROP TRIGGER IF EXISTS trg_portal_guarda ON public.portal_liberacoes;
CREATE TRIGGER trg_portal_guarda BEFORE UPDATE OR DELETE ON public.portal_liberacoes
  FOR EACH ROW EXECUTE FUNCTION public._portal_guarda('retirado_em', 'retirado_por');
DROP TRIGGER IF EXISTS trg_portal_guarda ON public.portal_acessos;
CREATE TRIGGER trg_portal_guarda BEFORE UPDATE OR DELETE ON public.portal_acessos
  FOR EACH ROW EXECUTE FUNCTION public._portal_guarda();
DROP TRIGGER IF EXISTS trg_portal_guarda ON public.portal_tentativas;
CREATE TRIGGER trg_portal_guarda BEFORE UPDATE OR DELETE ON public.portal_tentativas
  FOR EACH ROW EXECUTE FUNCTION public._portal_guarda();

-- ============ apoio ============
-- Hash do código: maiúsculas, só letras e números ("abcd-ef01…" e "ABCDEF01…" são o mesmo código).
CREATE OR REPLACE FUNCTION public._portal_codigo_hash(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT encode(sha256(convert_to(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), 'UTF8')), 'hex') $$;
REVOKE ALL ON FUNCTION public._portal_codigo_hash(text) FROM PUBLIC, anon, authenticated;

-- Quem pode gerenciar acessos do portal: recepção e gestão (como os lembretes da clínica), com a clínica liberada.
CREATE OR REPLACE FUNCTION public._portal_exige_recepcao()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._portal_exige_recepcao() FROM PUBLIC, anon, authenticated;

-- O animal é do tutor desta sessão? Devolve o cadastro (tenant e cliente) só se há vínculo ATIVO e o animal está no mesmo cadastro.
CREATE OR REPLACE FUNCTION public._portal_pet_do_tutor(p_pet_id uuid)
RETURNS TABLE (tenant_id uuid, cliente_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.tenant_id, p.cliente_id
    FROM public.pets p
    JOIN public.portal_vinculos v ON v.cliente_id = p.cliente_id AND v.tenant_id = p.tenant_id
   WHERE p.id = p_pet_id AND p.ativo AND v.user_id = auth.uid() AND v.revogado_em IS NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._portal_pet_do_tutor(uuid) FROM PUBLIC, anon, authenticated;

-- ============ recepção: convites e vínculos ============
-- Gera um convite para o tutor (cadastro de cliente). O código vale 7 dias, uso único, e é devolvido AQUI, uma vez: no banco fica só o hash.
-- Até 5 convites pendentes por tutor. Nada é enviado: a recepção entrega o código.
CREATE OR REPLACE FUNCTION public.clinica_portal_convite_criar(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_codigo text;
  v_id uuid;
  v_exp timestamptz := now() + interval '7 days';
BEGIN
  PERFORM public._portal_exige_recepcao();
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Tutor não encontrado';
  END IF;
  IF (SELECT count(*) FROM public.portal_convites
       WHERE cliente_id = p_cliente_id AND tenant_id = v_tenant AND usado_em IS NULL AND revogado_em IS NULL AND expira_em > now()) >= 5 THEN
    RAISE EXCEPTION 'Este tutor já tem 5 convites pendentes: revogue algum antes de gerar outro';
  END IF;
  v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  INSERT INTO public.portal_convites (tenant_id, cliente_id, codigo_hash, expira_em)
  VALUES (v_tenant, p_cliente_id, public._portal_codigo_hash(v_codigo), v_exp) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'expira_em', v_exp,
    'codigo', substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4) || '-' || substr(v_codigo, 9, 4) || '-' || substr(v_codigo, 13, 4));
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_convite_criar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_convite_criar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_portal_convite_revogar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._portal_exige_recepcao();
  UPDATE public.portal_convites SET revogado_em = now(), revogado_por = auth.uid()
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND usado_em IS NULL AND revogado_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Só um convite pendente pode ser revogado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_convite_revogar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_convite_revogar(uuid) TO authenticated;

-- Convites e vínculos da empresa (opcionalmente de um tutor). O e-mail do tutor aparece mascarado; o conteúdo clínico nunca.
CREATE OR REPLACE FUNCTION public.clinica_portal_acessos(p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public._portal_exige_recepcao();
  RETURN jsonb_build_object(
    'convites', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'cliente_id', c.cliente_id, 'cliente', cl.nome, 'created_at', c.created_at, 'expira_em', c.expira_em,
               'estado', CASE WHEN c.revogado_em IS NOT NULL THEN 'revogado' WHEN c.usado_em IS NOT NULL THEN 'usado'
                              WHEN c.expira_em <= now() THEN 'vencido' ELSE 'pendente' END
             ) ORDER BY c.created_at DESC)
        FROM (SELECT * FROM public.portal_convites
               WHERE tenant_id = v_tenant AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
               ORDER BY created_at DESC LIMIT 50) c
        JOIN public.clientes cl ON cl.id = c.cliente_id
    ), '[]'::jsonb),
    'vinculos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'cliente_id', v.cliente_id, 'cliente', cl.nome, 'created_at', v.created_at,
               'email', (SELECT left(u.email, 1) || '***@' || split_part(u.email, '@', 2) FROM auth.users u WHERE u.id = v.user_id),
               'ativo', v.revogado_em IS NULL, 'revogado_em', v.revogado_em,
               'ultima_consulta', (SELECT max(a.created_at) FROM public.portal_acessos a WHERE a.user_id = v.user_id AND a.cliente_id = v.cliente_id)
             ) ORDER BY v.created_at DESC)
        FROM (SELECT * FROM public.portal_vinculos
               WHERE tenant_id = v_tenant AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id)
               ORDER BY created_at DESC LIMIT 50) v
        JOIN public.clientes cl ON cl.id = v.cliente_id
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_acessos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_acessos(uuid) TO authenticated;

-- Revoga o acesso do tutor: vale na próxima leitura dele. Motivo obrigatório (3 a 300 caracteres).
CREATE OR REPLACE FUNCTION public.clinica_portal_vinculo_revogar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  PERFORM public._portal_exige_recepcao();
  IF length(v_motivo) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Informe o motivo da revogação (3 a 300 caracteres)'; END IF;
  UPDATE public.portal_vinculos SET revogado_em = now(), revogado_por = auth.uid(), revogado_motivo = v_motivo
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND revogado_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acesso não encontrado ou já revogado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_vinculo_revogar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_vinculo_revogar(uuid, text) TO authenticated;

-- ============ veterinário: o que o tutor pode ver ============
-- Exames fechados e receitas do animal, com o estado da liberação e a última consulta do tutor. Só títulos e datas (o conteúdo é do prontuário).
CREATE OR REPLACE FUNCTION public.clinica_portal_itens_do_pet(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_cli uuid;
BEGIN
  PERFORM public._clinica_vet();
  SELECT cliente_id INTO v_cli FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF v_cli IS NULL THEN RAISE EXCEPTION 'Animal não encontrado'; END IF;
  RETURN jsonb_build_object(
    'tutor_com_acesso', EXISTS (SELECT 1 FROM public.portal_vinculos v WHERE v.cliente_id = v_cli AND v.tenant_id = v_tenant AND v.revogado_em IS NULL),
    'exames', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'nome', e.nome, 'data_coleta', e.data_coleta,
               'liberado', l.id IS NOT NULL, 'liberado_em', l.created_at,
               'ultima_consulta', (SELECT max(a.created_at) FROM public.portal_acessos a WHERE a.tipo = 'exame' AND a.ref_id = e.id)
             ) ORDER BY e.data_coleta DESC, e.id)
        FROM public.pet_exames e
        LEFT JOIN public.portal_liberacoes l ON l.tipo = 'exame' AND l.ref_id = e.id AND l.retirado_em IS NULL
       WHERE e.pet_id = p_pet_id AND e.tenant_id = v_tenant AND e.situacao = 'fechado'
    ), '[]'::jsonb),
    'receitas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'titulo', d.titulo, 'numero', d.numero, 'ano', d.ano, 'emitido_em', d.emitido_em, 'situacao', d.situacao,
               'liberado', l.id IS NOT NULL, 'liberado_em', l.created_at,
               'ultima_consulta', (SELECT max(a.created_at) FROM public.portal_acessos a WHERE a.tipo = 'documento' AND a.ref_id = d.id)
             ) ORDER BY d.emitido_em DESC, d.id)
        FROM public.pet_documentos d
        LEFT JOIN public.portal_liberacoes l ON l.tipo = 'documento' AND l.ref_id = d.id AND l.retirado_em IS NULL
       WHERE d.pet_id = p_pet_id AND d.tenant_id = v_tenant AND d.tipo = 'receita'
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_itens_do_pet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_itens_do_pet(uuid) TO authenticated;

-- Libera um item ao tutor. Exame só fechado; receita só emitida (não cancelada). Repetir devolve a liberação que já existe.
CREATE OR REPLACE FUNCTION public.clinica_portal_liberar(p_tipo text, p_ref_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_vet uuid := public._clinica_vet();
  v_pet uuid;
  v_cli uuid;
  v_id uuid;
BEGIN
  IF p_tipo = 'exame' THEN
    SELECT e.pet_id INTO v_pet FROM public.pet_exames e WHERE e.id = p_ref_id AND e.tenant_id = v_tenant AND e.situacao = 'fechado';
    IF v_pet IS NULL THEN RAISE EXCEPTION 'Só um exame fechado pode ser liberado ao tutor'; END IF;
  ELSIF p_tipo = 'documento' THEN
    SELECT d.pet_id INTO v_pet FROM public.pet_documentos d
     WHERE d.id = p_ref_id AND d.tenant_id = v_tenant AND d.tipo = 'receita' AND d.situacao = 'emitido';
    IF v_pet IS NULL THEN RAISE EXCEPTION 'Só uma receita emitida (não cancelada) pode ser liberada ao tutor'; END IF;
  ELSE
    RAISE EXCEPTION 'Tipo inválido';
  END IF;
  SELECT cliente_id INTO v_cli FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant;
  IF p_tipo = 'documento' AND NOT EXISTS (SELECT 1 FROM public.pet_documentos d WHERE d.id = p_ref_id AND d.cliente_id = v_cli) THEN
    RAISE EXCEPTION 'A receita foi emitida para outro tutor: não pode ser liberada neste cadastro';
  END IF;
  SELECT id INTO v_id FROM public.portal_liberacoes WHERE tipo = p_tipo AND ref_id = p_ref_id AND retirado_em IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.portal_liberacoes (tenant_id, tipo, ref_id, pet_id, cliente_id, liberado_por)
  VALUES (v_tenant, p_tipo, p_ref_id, v_pet, v_cli, v_vet) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_liberar(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_liberar(text, uuid) TO authenticated;

-- Retira o item do portal (o tutor deixa de vê-lo na próxima leitura). O registro de que foi liberado fica.
CREATE OR REPLACE FUNCTION public.clinica_portal_retirar(p_tipo text, p_ref_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_vet uuid := public._clinica_vet();
BEGIN
  UPDATE public.portal_liberacoes SET retirado_em = now(), retirado_por = v_vet
   WHERE tipo = p_tipo AND ref_id = p_ref_id AND tenant_id = public.current_tenant_id() AND retirado_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este item não está liberado no portal'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.clinica_portal_retirar(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_portal_retirar(text, uuid) TO authenticated;

-- ============ tutor ============
-- Vincula a conta do tutor ao cadastro com o código do convite. Erros de código NÃO são exceção (a tentativa precisa ficar registrada):
-- volta {ok:false, erro}. A mensagem é a mesma para código errado, vencido, usado ou revogado (não revela qual). Até 10 erros por hora.
CREATE OR REPLACE FUNCTION public.portal_resgatar_convite(p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
  c public.portal_convites;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para continuar'; END IF;
  IF (SELECT count(*) FROM public.portal_tentativas WHERE user_id = v_uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Muitas tentativas com código errado. Tente de novo em uma hora ou peça um novo convite à clínica.');
  END IF;
  v_hash := public._portal_codigo_hash(p_codigo);
  SELECT * INTO c FROM public.portal_convites WHERE codigo_hash = v_hash FOR UPDATE;
  IF c.id IS NULL OR c.usado_em IS NOT NULL OR c.revogado_em IS NOT NULL OR c.expira_em <= now() THEN
    INSERT INTO public.portal_tentativas (user_id) VALUES (v_uid);
    RETURN jsonb_build_object('ok', false, 'erro', 'Código inválido ou vencido. Confira com a clínica ou peça um novo convite.');
  END IF;
  INSERT INTO public.portal_vinculos (tenant_id, cliente_id, user_id, convite_id) VALUES (c.tenant_id, c.cliente_id, v_uid, c.id)
  ON CONFLICT (cliente_id, user_id) WHERE revogado_em IS NULL DO NOTHING;
  UPDATE public.portal_convites SET usado_em = now(), usado_por = v_uid WHERE id = c.id;
  RETURN jsonb_build_object('ok', true,
    'clinica', (SELECT coalesce(nullif(e.nome_fantasia, ''), e.razao_social) FROM public.empresas e WHERE e.tenant_id = c.tenant_id ORDER BY e.created_at LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.portal_resgatar_convite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_resgatar_convite(text) TO authenticated;

-- Os animais do tutor desta sessão, com as próximas vacinas (data da próxima dose já registrada pela clínica) e quantos itens foram liberados.
CREATE OR REPLACE FUNCTION public.portal_meus_pets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para continuar'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'vinculo_id', v.id,
             'clinica', (SELECT coalesce(nullif(e.nome_fantasia, ''), e.razao_social) FROM public.empresas e WHERE e.tenant_id = v.tenant_id ORDER BY e.created_at LIMIT 1),
             'tutor', (SELECT c.nome FROM public.clientes c WHERE c.id = v.cliente_id),
             'pets', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', p.id, 'nome', p.nome, 'especie', p.especie, 'raca', p.raca, 'nascimento', p.nascimento,
                        'vacinas', coalesce((
                          SELECT jsonb_agg(jsonb_build_object('nome', x.nome, 'tipo', x.tipo, 'proxima_dose_em', x.proxima_dose_em,
                                                              'atrasada', x.proxima_dose_em < v_hoje) ORDER BY x.proxima_dose_em, x.nome)
                            FROM (SELECT DISTINCT ON (vc.catalogo_id) vc.nome, vc.tipo, vc.proxima_dose_em
                                    FROM public.pet_vacinacoes vc JOIN public.pet_vacinas_catalogo k ON k.id = vc.catalogo_id AND k.ativo
                                   WHERE vc.pet_id = p.id AND vc.tenant_id = v.tenant_id AND vc.situacao = 'ativa'
                                   ORDER BY vc.catalogo_id, vc.aplicada_em DESC, vc.created_at DESC) x
                           WHERE x.proxima_dose_em IS NOT NULL AND x.proxima_dose_em >= v_hoje - 365
                        ), '[]'::jsonb),
                        'exames', (SELECT count(*) FROM public.portal_liberacoes l WHERE l.pet_id = p.id AND l.cliente_id = v.cliente_id AND l.tipo = 'exame' AND l.retirado_em IS NULL),
                        'receitas', (SELECT count(*) FROM public.portal_liberacoes l WHERE l.pet_id = p.id AND l.cliente_id = v.cliente_id AND l.tipo = 'documento' AND l.retirado_em IS NULL)
                      ) ORDER BY p.nome)
                 FROM public.pets p WHERE p.cliente_id = v.cliente_id AND p.tenant_id = v.tenant_id AND p.ativo
             ), '[]'::jsonb)
           ) ORDER BY v.created_at)
      FROM public.portal_vinculos v
     WHERE v.user_id = v_uid AND v.revogado_em IS NULL
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.portal_meus_pets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_meus_pets() TO authenticated;

-- Exames e receitas liberados de UM animal do tutor. Animal que não é do tutor: "não encontrado" (igual a um animal que não existe).
CREATE OR REPLACE FUNCTION public.portal_pet_itens(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  a record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para continuar'; END IF;
  SELECT * INTO a FROM public._portal_pet_do_tutor(p_pet_id);
  IF a.cliente_id IS NULL THEN RAISE EXCEPTION 'Animal não encontrado'; END IF;
  RETURN jsonb_build_object(
    'pet', (SELECT jsonb_build_object('id', p.id, 'nome', p.nome, 'especie', p.especie) FROM public.pets p WHERE p.id = p_pet_id),
    'exames', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'data_coleta', e.data_coleta,
                                          'estado', CASE WHEN e.situacao = 'fechado' THEN 'disponivel' ELSE 'indisponivel' END) ORDER BY e.data_coleta DESC, e.id)
        FROM public.portal_liberacoes l JOIN public.pet_exames e ON e.id = l.ref_id
       WHERE l.tipo = 'exame' AND l.pet_id = p_pet_id AND l.cliente_id = a.cliente_id AND l.retirado_em IS NULL AND e.tenant_id = a.tenant_id
    ), '[]'::jsonb),
    'receitas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'titulo', d.titulo, 'numero', d.numero, 'ano', d.ano, 'emitido_em', d.emitido_em,
                                          'estado', CASE WHEN d.situacao = 'emitido' THEN 'disponivel' ELSE 'cancelado' END,
                                          'veterinario', pv.nome) ORDER BY d.emitido_em DESC, d.id)
        FROM public.portal_liberacoes l
        JOIN public.pet_documentos d ON d.id = l.ref_id
        JOIN public.pet_profissionais pv ON pv.id = d.veterinario_id
       WHERE l.tipo = 'documento' AND l.pet_id = p_pet_id AND l.cliente_id = a.cliente_id AND l.retirado_em IS NULL AND d.tenant_id = a.tenant_id
         AND d.cliente_id = a.cliente_id AND d.tipo = 'receita'
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.portal_pet_itens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_pet_itens(uuid) TO authenticated;

-- Um exame liberado. Estados claros: nao_liberado, indisponivel (exame não fechado) ou disponivel (com o resultado). Cada consulta com resultado é registrada.
-- Vai valor, unidade e a referência que a clínica cadastrou; NÃO vai observação, nota interna nem faixa "alto/baixo" calculada.
CREATE OR REPLACE FUNCTION public.portal_exame_obter(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  e public.pet_exames%ROWTYPE;
  a record;
  v_pet jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para continuar'; END IF;
  SELECT * INTO e FROM public.pet_exames WHERE id = p_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  SELECT * INTO a FROM public._portal_pet_do_tutor(e.pet_id);
  IF a.cliente_id IS NULL OR a.tenant_id <> e.tenant_id THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  SELECT jsonb_build_object('id', p.id, 'nome', p.nome, 'especie', p.especie) INTO v_pet FROM public.pets p WHERE p.id = e.pet_id;
  IF NOT EXISTS (SELECT 1 FROM public.portal_liberacoes l WHERE l.tipo = 'exame' AND l.ref_id = e.id AND l.cliente_id = a.cliente_id AND l.retirado_em IS NULL) THEN
    RETURN jsonb_build_object('estado', 'nao_liberado', 'pet', v_pet, 'nome', e.nome);
  END IF;
  IF e.situacao <> 'fechado' THEN
    RETURN jsonb_build_object('estado', 'indisponivel', 'pet', v_pet, 'nome', e.nome);
  END IF;
  INSERT INTO public.portal_acessos (tenant_id, user_id, cliente_id, pet_id, tipo, ref_id) VALUES (a.tenant_id, v_uid, a.cliente_id, e.pet_id, 'exame', e.id);
  RETURN jsonb_build_object(
    'estado', 'disponivel', 'pet', v_pet, 'id', e.id, 'nome', e.nome, 'tipo', e.tipo, 'data_coleta', e.data_coleta, 'material', e.material,
    'laboratorio', e.laboratorio, 'fechado_em', e.fechado_em,
    'clinica', (SELECT coalesce(nullif(em.nome_fantasia, ''), em.razao_social) FROM public.empresas em WHERE em.tenant_id = e.tenant_id ORDER BY em.created_at LIMIT 1),
    'veterinario', (SELECT jsonb_build_object('nome', pv.nome, 'crmv', e.crmv, 'crmv_uf', e.crmv_uf) FROM public.pet_profissionais pv WHERE pv.id = e.veterinario_id),
    'anexos', (SELECT count(*) FROM public.pet_exame_anexos x WHERE x.exame_id = e.id AND x.situacao = 'ativo'),
    'resultados', coalesce((
      SELECT jsonb_agg(jsonb_build_object('grupo', r.grupo, 'nome', r.nome, 'unidade', r.unidade, 'forma', r.forma, 'casas', r.casas,
                                          'valor_num', r.valor_num, 'valor_texto', r.valor_texto, 'faixa_min', r.faixa_min, 'faixa_max', r.faixa_max) ORDER BY r.ordem)
        FROM public.pet_exame_resultados r WHERE r.exame_id = e.id AND (r.valor_num IS NOT NULL OR r.valor_texto IS NOT NULL)
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.portal_exame_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_exame_obter(uuid) TO authenticated;

-- Uma receita liberada. Cancelada: só o aviso (sem conteúdo e sem o motivo, que é interno). Cada consulta com conteúdo é registrada.
CREATE OR REPLACE FUNCTION public.portal_receita_obter(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  d public.pet_documentos%ROWTYPE;
  a record;
  v_pet jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para continuar'; END IF;
  SELECT * INTO d FROM public.pet_documentos WHERE id = p_id AND tipo = 'receita';
  IF d.id IS NULL THEN RAISE EXCEPTION 'Receita não encontrada'; END IF;
  SELECT * INTO a FROM public._portal_pet_do_tutor(d.pet_id);
  IF a.cliente_id IS NULL OR a.tenant_id <> d.tenant_id OR d.cliente_id <> a.cliente_id THEN RAISE EXCEPTION 'Receita não encontrada'; END IF;
  SELECT jsonb_build_object('id', p.id, 'nome', p.nome, 'especie', p.especie) INTO v_pet FROM public.pets p WHERE p.id = d.pet_id;
  IF NOT EXISTS (SELECT 1 FROM public.portal_liberacoes l WHERE l.tipo = 'documento' AND l.ref_id = d.id AND l.cliente_id = a.cliente_id AND l.retirado_em IS NULL) THEN
    RETURN jsonb_build_object('estado', 'nao_liberado', 'pet', v_pet, 'titulo', d.titulo);
  END IF;
  IF d.situacao <> 'emitido' THEN
    RETURN jsonb_build_object('estado', 'cancelado', 'pet', v_pet, 'titulo', d.titulo, 'numero', d.numero, 'ano', d.ano,
                              'emitido_em', d.emitido_em, 'cancelado_em', d.cancelado_em);
  END IF;
  INSERT INTO public.portal_acessos (tenant_id, user_id, cliente_id, pet_id, tipo, ref_id) VALUES (a.tenant_id, v_uid, a.cliente_id, d.pet_id, 'documento', d.id);
  RETURN jsonb_build_object(
    'estado', 'disponivel', 'pet', v_pet, 'id', d.id, 'titulo', d.titulo, 'numero', d.numero, 'ano', d.ano, 'emitido_em', d.emitido_em,
    'itens', d.itens, 'orientacoes', d.corpo,
    'clinica', (SELECT coalesce(nullif(em.nome_fantasia, ''), em.razao_social) FROM public.empresas em WHERE em.tenant_id = d.tenant_id ORDER BY em.created_at LIMIT 1),
    'veterinario', jsonb_build_object('nome', coalesce(d.snapshot -> 'veterinario' ->> 'nome', (SELECT pv.nome FROM public.pet_profissionais pv WHERE pv.id = d.veterinario_id)),
                                      'crmv', d.crmv, 'crmv_uf', d.crmv_uf));
END $$;
REVOKE ALL ON FUNCTION public.portal_receita_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_receita_obter(uuid) TO authenticated;
