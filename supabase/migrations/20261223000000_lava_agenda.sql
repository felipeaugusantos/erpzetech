-- Lava rápido: agenda. Só a recepção agenda (administrador, gestor, vendedor e caixa). Tudo novo, com prefixo lr_, sem mexer no pátio.
-- Tabelas: lr_agendamentos (cabeçalho), lr_agendamento_itens (serviços previstos), lr_agenda_config (regra de conflito por empresa)
-- e lr_agenda_ocupacoes (o calendário por lavador e por box, onde o banco recusa dois agendamentos que se cruzam).
-- Escrita só por funções, que tiram o tenant do servidor, conferem papel, módulo liberado e a empresa de cada referência.
-- O conflito é conferido sob trava do lavador e do box (advisory lock) e, no fundo, pela restrição de exclusão do calendário.
-- Intervalo aberto no fim: um agendamento pode começar quando o outro termina. Cancelado e faltou liberam o horário.
-- Pode ser rodado de novo sem erro (tabelas, funções, políticas e gatilhos são refeitos).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END $$;

-- ============ regra de conflito por empresa ============
-- Sem linha vale o padrão: conflito por lavador, conflito por box e exigir ao menos um dos dois.
CREATE TABLE IF NOT EXISTS public.lr_agenda_config (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  conflito_lavador boolean NOT NULL DEFAULT true,
  conflito_box boolean NOT NULL DEFAULT true,
  exigir_recurso boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ agendamentos ============
CREATE TABLE IF NOT EXISTS public.lr_agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.lr_veiculos(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  lavador_id uuid REFERENCES public.lr_lavadores(id),
  box text CHECK (box IS NULL OR length(btrim(box)) BETWEEN 1 AND 40),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  situacao text NOT NULL DEFAULT 'agendado' CHECK (situacao IN ('agendado', 'confirmado', 'concluido', 'cancelado', 'faltou')),
  observacoes text,
  motivo text,
  chegada_em timestamptz,
  ordem_id uuid REFERENCES public.lr_ordens(id),
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS lr_agendamentos_dia_idx ON public.lr_agendamentos (tenant_id, inicio);
CREATE INDEX IF NOT EXISTS lr_agendamentos_lavador_idx ON public.lr_agendamentos (lavador_id, inicio) WHERE situacao NOT IN ('cancelado', 'faltou');
CREATE INDEX IF NOT EXISTS lr_agendamentos_veiculo_idx ON public.lr_agendamentos (veiculo_id, inicio DESC);
-- uma ordem do pátio nasce de um agendamento só
CREATE UNIQUE INDEX IF NOT EXISTS lr_agendamentos_ordem_idx ON public.lr_agendamentos (ordem_id) WHERE ordem_id IS NOT NULL;

-- Serviços previstos. Preço e duração vêm do cadastro do serviço na hora de agendar.
-- preco_estimado vazio quer dizer que o serviço não tem preço cadastrado (nada é inventado).
CREATE TABLE IF NOT EXISTS public.lr_agendamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  agendamento_id uuid NOT NULL REFERENCES public.lr_agendamentos(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.lr_servicos(id),
  preco_estimado numeric(14,2) CHECK (preco_estimado IS NULL OR preco_estimado >= 0),
  duracao_min integer NOT NULL CHECK (duracao_min > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agendamento_id, servico_id)
);

-- O calendário: um lavador (ou um box) não tem dois horários que se cruzam. O banco recusa, mesmo com duas pessoas agendando ao mesmo tempo.
CREATE TABLE IF NOT EXISTS public.lr_agenda_ocupacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  agendamento_id uuid NOT NULL REFERENCES public.lr_agendamentos(id) ON DELETE CASCADE,
  recurso text NOT NULL CHECK (recurso IN ('lavador', 'box')),
  chave text NOT NULL CHECK (length(chave) > 0),
  periodo tstzrange NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lr_agenda_ocupacoes_periodo_ck CHECK (NOT isempty(periodo) AND NOT lower_inf(periodo) AND NOT upper_inf(periodo)),
  CONSTRAINT lr_agenda_ocupacoes_unica UNIQUE (agendamento_id, recurso),
  CONSTRAINT lr_agenda_ocupacoes_sem_cruzar EXCLUDE USING gist (tenant_id WITH =, recurso WITH =, chave WITH =, periodo WITH &&)
);

-- ============ acesso: leitura da empresa, escrita só pelas funções ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_agenda_config', 'lr_agendamentos', 'lr_agendamento_itens', 'lr_agenda_ocupacoes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_lr_agenda_config_updated ON public.lr_agenda_config;
CREATE TRIGGER trg_lr_agenda_config_updated BEFORE UPDATE ON public.lr_agenda_config FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_lr_agendamentos_updated ON public.lr_agendamentos;
CREATE TRIGGER trg_lr_agendamentos_updated BEFORE UPDATE ON public.lr_agendamentos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ apoio (internas: ninguém de fora chama) ============
-- Regra de conflito da empresa, com o padrão quando ela não configurou.
CREATE OR REPLACE FUNCTION public._lr_agenda_cfg(p_tenant uuid)
RETURNS TABLE(conflito_lavador boolean, conflito_box boolean, exigir_recurso boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT coalesce(c.conflito_lavador, true), coalesce(c.conflito_box, true), coalesce(c.exigir_recurso, true)
    FROM (SELECT 1) x LEFT JOIN public.lr_agenda_config c ON c.tenant_id = p_tenant
$fn$;
REVOKE ALL ON FUNCTION public._lr_agenda_cfg(uuid) FROM PUBLIC, anon, authenticated;

-- Preço previsto do serviço para o tipo do veículo: o do tipo, senão o geral, senão o preço do cadastro do serviço (se for maior que zero).
-- Vazio quando não há preço cadastrado: a tela mostra a pendência e a chegada recusa, em vez de cobrar zero.
CREATE OR REPLACE FUNCTION public._lr_agenda_preco(p_servico_id uuid, p_tipo text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT coalesce(
    (SELECT p.preco FROM public.lr_servico_precos p WHERE p.servico_id = p_servico_id AND p.tipo = p_tipo),
    (SELECT p.preco FROM public.lr_servico_precos p WHERE p.servico_id = p_servico_id AND p.tipo IS NULL),
    (SELECT nullif(pr.preco_venda, 0) FROM public.lr_servicos s JOIN public.produtos pr ON pr.id = s.produto_id WHERE s.id = p_servico_id))
$fn$;
REVOKE ALL ON FUNCTION public._lr_agenda_preco(uuid, text) FROM PUBLIC, anon, authenticated;

-- Trava o lavador e o box antes de conferir a sobreposição (mesmo mecanismo da agenda do pet shop), sempre na mesma ordem.
CREATE OR REPLACE FUNCTION public._lr_agenda_travar(p_tenant uuid, p_lavador uuid, p_box text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE k text;
BEGIN
  FOR k IN
    SELECT x FROM unnest(ARRAY[
      CASE WHEN p_lavador IS NOT NULL THEN 'lr_agenda:' || p_tenant::text || ':lavador:' || p_lavador::text END,
      CASE WHEN nullif(btrim(coalesce(p_box, '')), '') IS NOT NULL THEN 'lr_agenda:' || p_tenant::text || ':box:' || lower(btrim(p_box)) END
    ]) AS x WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(k, 0));
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public._lr_agenda_travar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Já existe agendamento (que não seja cancelado ou falta) cruzando este horário? Devolve 'lavador', 'box' ou vazio.
-- Só olha o que a empresa configurou (conflito por lavador e por box). Intervalo aberto no fim.
CREATE OR REPLACE FUNCTION public._lr_agenda_conflito(p_tenant uuid, p_lavador uuid, p_box text, p_ini timestamptz, p_fim timestamptz, p_ignorar uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  cfg record;
  v_box text := nullif(lower(btrim(coalesce(p_box, ''))), '');
BEGIN
  SELECT * INTO cfg FROM public._lr_agenda_cfg(p_tenant);
  IF cfg.conflito_lavador AND p_lavador IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.lr_agendamentos a
        WHERE a.tenant_id = p_tenant AND a.lavador_id = p_lavador AND a.situacao NOT IN ('cancelado', 'faltou')
          AND a.id IS DISTINCT FROM p_ignorar AND a.inicio < p_fim AND a.fim > p_ini) THEN
    RETURN 'lavador';
  END IF;
  IF cfg.conflito_box AND v_box IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.lr_agendamentos a
        WHERE a.tenant_id = p_tenant AND lower(btrim(a.box)) = v_box AND a.situacao NOT IN ('cancelado', 'faltou')
          AND a.id IS DISTINCT FROM p_ignorar AND a.inicio < p_fim AND a.fim > p_ini) THEN
    RETURN 'box';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public._lr_agenda_conflito(uuid, uuid, text, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- Refaz as linhas do calendário do agendamento: lavador e box, conforme a regra da empresa. Cancelado e falta não ocupam.
CREATE OR REPLACE FUNCTION public._lr_agenda_ocupar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  a public.lr_agendamentos%ROWTYPE;
  cfg record;
BEGIN
  SELECT * INTO a FROM public.lr_agendamentos WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM public.lr_agenda_ocupacoes WHERE agendamento_id = a.id;
  IF a.situacao IN ('cancelado', 'faltou') THEN RETURN; END IF;
  SELECT * INTO cfg FROM public._lr_agenda_cfg(a.tenant_id);
  IF cfg.conflito_lavador AND a.lavador_id IS NOT NULL THEN
    INSERT INTO public.lr_agenda_ocupacoes (tenant_id, agendamento_id, recurso, chave, periodo)
    VALUES (a.tenant_id, a.id, 'lavador', a.lavador_id::text, tstzrange(a.inicio, a.fim, '[)'));
  END IF;
  IF cfg.conflito_box AND nullif(btrim(coalesce(a.box, '')), '') IS NOT NULL THEN
    INSERT INTO public.lr_agenda_ocupacoes (tenant_id, agendamento_id, recurso, chave, periodo)
    VALUES (a.tenant_id, a.id, 'box', lower(btrim(a.box)), tstzrange(a.inicio, a.fim, '[)'));
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public._lr_agenda_ocupar(uuid) FROM PUBLIC, anon, authenticated;

-- ============ regra da empresa ============
CREATE OR REPLACE FUNCTION public.lr_agenda_config_salvar(p_conflito_lavador boolean, p_conflito_box boolean, p_exigir_recurso boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  INSERT INTO public.lr_agenda_config (tenant_id, conflito_lavador, conflito_box, exigir_recurso)
  VALUES (public.current_tenant_id(), coalesce(p_conflito_lavador, true), coalesce(p_conflito_box, true), coalesce(p_exigir_recurso, true))
  ON CONFLICT (tenant_id) DO UPDATE
     SET conflito_lavador = EXCLUDED.conflito_lavador, conflito_box = EXCLUDED.conflito_box, exigir_recurso = EXCLUDED.exigir_recurso;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_agenda_config_salvar(boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_agenda_config_salvar(boolean, boolean, boolean) TO authenticated;

-- ============ agendar ============
-- p_dados: {veiculo_id, cliente_id?, lavador_id?, box?, inicio, fim?, servicos: [servico_id], observacoes?}
-- Sem fim, vale o início mais a soma das durações cadastradas dos serviços. O cliente, se vier, precisa ser o dono do veículo.
CREATE OR REPLACE FUNCTION public.lr_agendar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_veic public.lr_veiculos%ROWTYPE;
  v_cli uuid := nullif(p_dados ->> 'cliente_id', '')::uuid;
  v_lav uuid := nullif(p_dados ->> 'lavador_id', '')::uuid;
  v_lav_nome text;
  v_box text := nullif(btrim(coalesce(p_dados ->> 'box', '')), '');
  v_ini timestamptz := nullif(p_dados ->> 'inicio', '')::timestamptz;
  v_fim timestamptz := nullif(p_dados ->> 'fim', '')::timestamptz;
  v_ids uuid[];
  v_dur integer;
  v_exigir boolean;
  v_conf text;
  v_id uuid;
  r record;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe o dia e a hora do início'; END IF;
  IF length(coalesce(p_dados ->> 'observacoes', '')) > 500 THEN RAISE EXCEPTION 'As observações aceitam até 500 caracteres'; END IF;

  SELECT * INTO v_veic FROM public.lr_veiculos WHERE id = nullif(p_dados ->> 'veiculo_id', '')::uuid AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  IF NOT v_veic.ativo THEN RAISE EXCEPTION 'Este veículo está inativo'; END IF;
  IF v_cli IS NULL THEN
    v_cli := v_veic.cliente_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cli AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  ELSIF v_cli <> v_veic.cliente_id THEN
    RAISE EXCEPTION 'Este veículo não pertence ao cliente informado';
  END IF;
  IF v_lav IS NOT NULL THEN
    SELECT l.nome INTO v_lav_nome FROM public.lr_lavadores l WHERE l.id = v_lav AND l.tenant_id = v_tenant AND l.ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lavador não encontrado ou inativo'; END IF;
  END IF;
  SELECT c.exigir_recurso INTO v_exigir FROM public._lr_agenda_cfg(v_tenant) c;
  IF v_exigir AND v_lav IS NULL AND v_box IS NULL THEN RAISE EXCEPTION 'Informe o lavador ou o box do agendamento'; END IF;

  IF jsonb_typeof(p_dados -> 'servicos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'servicos') = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um serviço';
  END IF;
  SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_dados -> 'servicos') x;
  IF (SELECT count(*) FROM public.lr_servicos s WHERE s.id = ANY (v_ids) AND s.tenant_id = v_tenant AND s.ativo) <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'Serviço não encontrado ou inativo';
  END IF;
  SELECT sum(s.duracao_min)::int INTO v_dur FROM public.lr_servicos s WHERE s.id = ANY (v_ids) AND s.tenant_id = v_tenant;
  IF v_fim IS NULL THEN v_fim := v_ini + make_interval(mins => v_dur); END IF;
  IF v_fim <= v_ini THEN RAISE EXCEPTION 'O fim precisa ser depois do início'; END IF;
  IF v_fim > v_ini + interval '1 day' THEN RAISE EXCEPTION 'O agendamento não pode passar de 24 horas'; END IF;

  PERFORM public._lr_agenda_travar(v_tenant, v_lav, v_box);
  v_conf := public._lr_agenda_conflito(v_tenant, v_lav, v_box, v_ini, v_fim, NULL);
  IF v_conf = 'lavador' THEN RAISE EXCEPTION '% já tem agendamento neste horário', v_lav_nome; END IF;
  IF v_conf = 'box' THEN RAISE EXCEPTION 'O box % já está ocupado neste horário', v_box; END IF;

  INSERT INTO public.lr_agendamentos (tenant_id, veiculo_id, cliente_id, lavador_id, box, inicio, fim, observacoes)
  VALUES (v_tenant, v_veic.id, v_cli, v_lav, v_box, v_ini, v_fim, nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''))
  RETURNING id INTO v_id;
  FOR r IN SELECT s.id, s.duracao_min FROM public.lr_servicos s WHERE s.id = ANY (v_ids) AND s.tenant_id = v_tenant LOOP
    INSERT INTO public.lr_agendamento_itens (tenant_id, agendamento_id, servico_id, preco_estimado, duracao_min)
    VALUES (v_tenant, v_id, r.id, public._lr_agenda_preco(r.id, v_veic.tipo), r.duracao_min);
  END LOOP;
  PERFORM public._lr_agenda_ocupar(v_id);
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_agendar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_agendar(jsonb) TO authenticated;

-- ============ confirmar, cancelar e faltar ============
-- agendado vai para confirmado, cancelado ou faltou. confirmado vai para cancelado ou faltou. Concluído só pela chegada.
-- Cancelar pede o motivo. Cancelado e falta liberam o horário do lavador e do box. Confirmar não mexe no calendário.
CREATE OR REPLACE FUNCTION public.lr_agenda_situacao(p_id uuid, p_para text, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  a public.lr_agendamentos%ROWTYPE;
  v_ok boolean;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO a FROM public.lr_agendamentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  v_ok := CASE a.situacao
    WHEN 'agendado' THEN p_para IN ('confirmado', 'cancelado', 'faltou')
    WHEN 'confirmado' THEN p_para IN ('cancelado', 'faltou')
    ELSE false END;
  IF NOT v_ok THEN RAISE EXCEPTION 'Não é possível passar o agendamento de "%" para "%"', a.situacao, p_para; END IF;
  IF p_para = 'cancelado' AND v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  IF length(coalesce(v_motivo, '')) > 300 THEN RAISE EXCEPTION 'O motivo aceita até 300 caracteres'; END IF;
  UPDATE public.lr_agendamentos SET situacao = p_para, motivo = CASE WHEN p_para = 'confirmado' THEN NULL ELSE v_motivo END WHERE id = a.id;
  -- confirmar não muda horário nem recurso: as ocupações ficam como estão (a regra da empresa vale só para agendar e remarcar)
  IF p_para IN ('cancelado', 'faltou') THEN
    DELETE FROM public.lr_agenda_ocupacoes WHERE agendamento_id = a.id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.lr_agenda_situacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_agenda_situacao(uuid, text, text) TO authenticated;

-- ============ remarcar ============
-- Só agendado e confirmado. Mesma conferência de conflito, ignorando o próprio agendamento. Sem fim, mantém a duração.
-- Remarcado volta a "agendado": a confirmação era para o horário antigo.
CREATE OR REPLACE FUNCTION public.lr_agenda_remarcar(p_id uuid, p_inicio timestamptz, p_fim timestamptz, p_lavador_id uuid, p_box text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.lr_agendamentos%ROWTYPE;
  v_lav_nome text;
  v_box text := nullif(btrim(coalesce(p_box, '')), '');
  v_fim timestamptz := p_fim;
  v_exigir boolean;
  v_conf text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  IF p_inicio IS NULL THEN RAISE EXCEPTION 'Informe o dia e a hora do início'; END IF;
  SELECT * INTO a FROM public.lr_agendamentos WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao NOT IN ('agendado', 'confirmado') THEN RAISE EXCEPTION 'Só dá para remarcar agendamento agendado ou confirmado'; END IF;
  IF p_lavador_id IS NOT NULL THEN
    SELECT l.nome INTO v_lav_nome FROM public.lr_lavadores l WHERE l.id = p_lavador_id AND l.tenant_id = v_tenant AND l.ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lavador não encontrado ou inativo'; END IF;
  END IF;
  SELECT c.exigir_recurso INTO v_exigir FROM public._lr_agenda_cfg(v_tenant) c;
  IF v_exigir AND p_lavador_id IS NULL AND v_box IS NULL THEN RAISE EXCEPTION 'Informe o lavador ou o box do agendamento'; END IF;
  IF v_fim IS NULL THEN v_fim := p_inicio + (a.fim - a.inicio); END IF;
  IF v_fim <= p_inicio THEN RAISE EXCEPTION 'O fim precisa ser depois do início'; END IF;
  IF v_fim > p_inicio + interval '1 day' THEN RAISE EXCEPTION 'O agendamento não pode passar de 24 horas'; END IF;

  PERFORM public._lr_agenda_travar(v_tenant, p_lavador_id, v_box);
  v_conf := public._lr_agenda_conflito(v_tenant, p_lavador_id, v_box, p_inicio, v_fim, a.id);
  IF v_conf = 'lavador' THEN RAISE EXCEPTION '% já tem agendamento neste horário', v_lav_nome; END IF;
  IF v_conf = 'box' THEN RAISE EXCEPTION 'O box % já está ocupado neste horário', v_box; END IF;

  UPDATE public.lr_agendamentos
     SET inicio = p_inicio, fim = v_fim, lavador_id = p_lavador_id, box = v_box, situacao = 'agendado', motivo = NULL
   WHERE id = a.id;
  PERFORM public._lr_agenda_ocupar(a.id);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_agenda_remarcar(uuid, timestamptz, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_agenda_remarcar(uuid, timestamptz, timestamptz, uuid, text) TO authenticated;

-- ============ registrar chegada ============
-- Cria a ordem no pátio, em "aguardando", e grava o ordem_id na mesma transação. Idempotente: com o registro do agendamento
-- travado, a segunda chamada (clique repetido ou duas pessoas ao mesmo tempo) encontra o ordem_id e devolve a ordem que já existe.
-- Só agendado e confirmado geram ordem. Cancelado e falta nunca geram.
-- O checklist de entrada não é tocado: a ordem nasce sem checklist e o pátio exige, como sempre, antes de lavar.
-- Os serviços previstos entram na ordem como itens comuns (sem plano nem brinde). Cobrança e baixa de insumos acontecem
-- só em Entregar e cobrar, pelo fluxo de sempre. Preço: o do cadastro de hoje, sem inventar (serviço sem preço recusa a chegada).
CREATE OR REPLACE FUNCTION public.lr_agenda_chegada(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.lr_agendamentos%ROWTYPE;
  v_veic public.lr_veiculos%ROWTYPE;
  v_lav uuid;
  v_ordem uuid;
  v_preco numeric;
  r record;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO a FROM public.lr_agendamentos WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.ordem_id IS NOT NULL THEN
    RETURN jsonb_build_object('ordem_id', a.ordem_id, 'repetido', true);
  END IF;
  IF a.situacao NOT IN ('agendado', 'confirmado') THEN
    RAISE EXCEPTION 'Não dá para registrar a chegada de um agendamento "%"', a.situacao;
  END IF;

  SELECT * INTO v_veic FROM public.lr_veiculos WHERE id = a.veiculo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  IF NOT v_veic.ativo THEN RAISE EXCEPTION 'Este veículo está inativo'; END IF;
  -- a mesma trava de cliente de lr_ordem_criar: a chegada e a criação de ordem do pátio não correm juntas
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_cobertura:' || v_veic.cliente_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.lr_ordens o WHERE o.veiculo_id = v_veic.id AND o.situacao IN ('aguardando', 'lavando', 'secando', 'pronto')) THEN
    RAISE EXCEPTION 'Este veículo já tem uma ordem aberta no pátio';
  END IF;
  -- o lavador do agendamento segue na ordem se ainda estiver ativo (senão a recepção escolhe no pátio)
  SELECT l.id INTO v_lav FROM public.lr_lavadores l WHERE l.id = a.lavador_id AND l.tenant_id = v_tenant AND l.ativo;

  INSERT INTO public.lr_ordens (tenant_id, veiculo_id, cliente_id, lavador_id, box, observacoes)
  VALUES (v_tenant, v_veic.id, v_veic.cliente_id, v_lav, a.box, a.observacoes)
  RETURNING id INTO v_ordem;
  FOR r IN SELECT i.servico_id, s.nome, s.ativo
             FROM public.lr_agendamento_itens i JOIN public.lr_servicos s ON s.id = i.servico_id AND s.tenant_id = v_tenant
            WHERE i.agendamento_id = a.id LOOP
    IF NOT r.ativo THEN RAISE EXCEPTION 'O serviço "%" está inativo', r.nome; END IF;
    v_preco := public._lr_agenda_preco(r.servico_id, v_veic.tipo);
    IF v_preco IS NULL THEN RAISE EXCEPTION 'O serviço "%" não tem preço cadastrado', r.nome; END IF;
    INSERT INTO public.lr_ordem_itens (tenant_id, ordem_id, servico_id, preco_aplicado) VALUES (v_tenant, v_ordem, r.servico_id, v_preco);
  END LOOP;
  UPDATE public.lr_agendamentos SET ordem_id = v_ordem, situacao = 'concluido', chegada_em = now() WHERE id = a.id;
  RETURN jsonb_build_object('ordem_id', v_ordem, 'repetido', false);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_agenda_chegada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_agenda_chegada(uuid) TO authenticated;
