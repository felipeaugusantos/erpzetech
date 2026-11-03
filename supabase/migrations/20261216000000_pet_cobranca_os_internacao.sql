-- Pet: cobrança no caixa da ordem de serviço do pet e da internação (docs/sngpc.md não envolve; ver roadmap).
-- Mesmo molde do banho e tosa e do lava rápido: o operador faz a venda na frente de caixa de sempre e, depois, a função de vínculo
-- confere que a venda traz cada item pelo valor combinado, liga as duas pontas e entrega/encerra a cobrança.
-- Cuidado próprio: OS e internação já baixaram o estoque dos produtos, e a venda do caixa baixaria de novo. No vínculo, a baixa
-- da OS/internação é devolvida (a venda fica com a única baixa); se a venda for cancelada, a baixa é refeita e a cobrança volta a estar aberta.
-- Esta etapa NÃO emite NFS-e nem calcula comissão: o tratamento fiscal e de comissão de serviço clínico espera o contador (roadmap, PR 5).

-- ============ apoio ============
-- Serviço avulso (item digitado na OS ou na internação, sem produto) precisa de um produto para entrar numa venda do caixa.
CREATE OR REPLACE FUNCTION public._pet_produto_avulso()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.produtos WHERE tenant_id = v_tenant AND codigo_interno = 'PET-AVULSO' LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque, ativo)
    VALUES (v_tenant, 'PET-AVULSO', 'Serviço avulso (pet)', 'UN', 0, false, true)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._pet_produto_avulso() FROM PUBLIC, anon, authenticated;

-- A venda do caixa: do tenant, da filial do operador, do PDV e não cancelada. Devolve o pedido (pelo id ou pela chave de repetição).
CREATE OR REPLACE FUNCTION public._pet_venda_valida(p_pedido_id uuid, p_chave uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_pedido uuid := p_pedido_id;
  v_ped public.pedidos%ROWTYPE;
BEGIN
  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'Esta cobrança é feita na frente de caixa'; END IF;
  RETURN v_pedido;
END $$;
REVOKE ALL ON FUNCTION public._pet_venda_valida(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- O caixa tem uma linha por produto: o mesmo produto com dois valores na mesma ordem/internação não dá para cobrar de uma vez.
CREATE OR REPLACE FUNCTION public._pet_linhas_unicas(p_linhas jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF (SELECT count(DISTINCT e ->> 'produto_id') FROM jsonb_array_elements(p_linhas) e) <> jsonb_array_length(p_linhas) THEN
    RAISE EXCEPTION 'Há o mesmo produto ou serviço lançado com valores diferentes: deixe um valor só para o caixa cobrar';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._pet_linhas_unicas(jsonb) FROM PUBLIC, anon, authenticated;

-- A venda precisa trazer cada item (produto, valor unitário e quantidade) combinado. p_exigidos: [{produto_id, preco, quantidade, descricao}].
CREATE OR REPLACE FUNCTION public._pet_venda_confere(p_pedido_id uuid, p_exigidos jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e jsonb;
  v_tem numeric;
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(p_exigidos) LOOP
    SELECT coalesce(sum(pi.quantidade), 0) INTO v_tem FROM public.pedido_itens pi
     WHERE pi.pedido_id = p_pedido_id AND pi.produto_id = (e ->> 'produto_id')::uuid AND pi.preco_unitario = (e ->> 'preco')::numeric;
    IF v_tem < (e ->> 'quantidade')::numeric THEN
      RAISE EXCEPTION 'A venda não traz "%" (% un.) pelo valor combinado (%)', e ->> 'descricao', e ->> 'quantidade', e ->> 'preco';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._pet_venda_confere(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ============ ordem de serviço do pet ============
ALTER TABLE public.os_ordens ADD COLUMN IF NOT EXISTS venda_id uuid REFERENCES public.pedidos(id);
CREATE UNIQUE INDEX IF NOT EXISTS os_ordens_venda_idx ON public.os_ordens (venda_id) WHERE venda_id IS NOT NULL;

-- o cliente não escreve o vínculo com a venda pela tabela: só a função de cobrança
CREATE OR REPLACE FUNCTION public.os_ordens_protege_pet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.pet_id := NULL; NEW.pet_resumo := NULL; NEW.pet_profissional_id := NULL; NEW.venda_id := NULL;
    ELSE
      NEW.pet_id := OLD.pet_id; NEW.pet_resumo := OLD.pet_resumo; NEW.pet_profissional_id := OLD.pet_profissional_id; NEW.venda_id := OLD.venda_id;
      -- ordem do pet só anda pelas funções (a cobrança no caixa não pode ser contornada marcando a ordem como entregue)
      IF OLD.pet_id IS NOT NULL THEN
        NEW.situacao := OLD.situacao; NEW.controla_estoque := OLD.controla_estoque; NEW.desconto := OLD.desconto;
        NEW.deposito_id := OLD.deposito_id; NEW.entregue_em := OLD.entregue_em;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- os itens da ordem do pet também só mudam pelas funções (senão a ordem cobrada ganharia item que a venda não tem)
CREATE OR REPLACE FUNCTION public.os_itens_protege_pet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_os uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.os_id ELSE NEW.os_id END;
BEGIN
  IF current_user IN ('authenticated', 'anon') AND EXISTS (SELECT 1 FROM public.os_ordens o WHERE o.id = v_os AND o.pet_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Os itens da ordem do pet só mudam pela tela da ordem de serviço do pet';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.os_itens_protege_pet() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS os_itens_protege_pet_trg ON public.os_itens;
CREATE TRIGGER os_itens_protege_pet_trg BEFORE INSERT OR UPDATE OR DELETE ON public.os_itens
  FOR EACH ROW EXECUTE FUNCTION public.os_itens_protege_pet();

-- Itens da ordem para o caixa: um por linha de venda (mesmo produto e mesmo valor somam), com o serviço avulso no produto de apoio.
CREATE OR REPLACE FUNCTION public._pet_os_linhas(p_os_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('produto_id', t.produto_id, 'descricao', t.descricao, 'quantidade', t.quantidade, 'preco', t.preco) ORDER BY t.descricao), '[]'::jsonb)
    FROM (
      SELECT coalesce(i.produto_id, public._pet_produto_avulso()) AS produto_id, min(i.descricao) AS descricao,
             sum(i.quantidade) AS quantidade, i.preco_unitario AS preco
        FROM public.os_itens i WHERE i.os_id = p_os_id AND i.tenant_id = public.current_tenant_id()
       GROUP BY coalesce(i.produto_id, public._pet_produto_avulso()), i.preco_unitario
    ) t
$$;
REVOKE ALL ON FUNCTION public._pet_os_linhas(uuid) FROM PUBLIC, anon, authenticated;

-- O que o caixa precisa para cobrar a ordem pronta: tutor, linhas e o desconto combinado.
CREATE OR REPLACE FUNCTION public.pet_os_cobranca(p_os_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.os_ordens%ROWTYPE;
  v_linhas jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO o FROM public.os_ordens WHERE id = p_os_id AND tenant_id = v_tenant AND pet_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada'; END IF;
  IF o.situacao <> 'pronta' THEN RAISE EXCEPTION 'Só dá para cobrar ordem pronta (situação atual: %)', o.situacao; END IF;
  v_linhas := public._pet_os_linhas(o.id);
  IF jsonb_array_length(v_linhas) = 0 THEN RAISE EXCEPTION 'A ordem não tem itens para cobrar'; END IF;
  PERFORM public._pet_linhas_unicas(v_linhas);
  RETURN jsonb_build_object('os_id', o.id, 'numero', o.numero, 'cliente_id', o.cliente_id, 'pet', o.pet_resumo ->> 'nome',
                            'tutor', o.pet_resumo ->> 'tutor', 'desconto', o.desconto, 'linhas', v_linhas);
END $$;
REVOKE ALL ON FUNCTION public.pet_os_cobranca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_cobranca(uuid) TO authenticated;

-- Vínculo: a venda do caixa cobra a ordem pronta. A ordem passa a entregue e a baixa de estoque dela é devolvida (a venda baixa).
CREATE OR REPLACE FUNCTION public.pet_os_cobrar(p_os_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.os_ordens%ROWTYPE;
  v_pedido uuid;
  v_exigidos jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO o FROM public.os_ordens WHERE id = p_os_id AND tenant_id = v_tenant AND pet_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada'; END IF;
  IF o.situacao = 'entregue' AND o.venda_id IS NOT NULL AND (o.venda_id = p_pedido_id OR p_pedido_id IS NULL) THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    RETURN jsonb_build_object('pedido_id', o.venda_id, 'repetido', true);
  END IF;
  IF o.situacao <> 'pronta' THEN RAISE EXCEPTION 'Só dá para cobrar ordem pronta (situação atual: %)', o.situacao; END IF;
  v_exigidos := public._pet_os_linhas(o.id);
  IF jsonb_array_length(v_exigidos) = 0 THEN RAISE EXCEPTION 'A ordem não tem itens para cobrar'; END IF;
  PERFORM public._pet_linhas_unicas(v_exigidos);

  v_pedido := public._pet_venda_valida(p_pedido_id, p_chave);
  IF EXISTS (SELECT 1 FROM public.os_ordens x WHERE x.venda_id = v_pedido AND x.id <> o.id) THEN
    RAISE EXCEPTION 'Esta venda já cobrou outra ordem';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_internacao_cobrancas c WHERE c.pedido_id = v_pedido) THEN
    RAISE EXCEPTION 'Esta venda já cobrou uma internação';
  END IF;
  PERFORM public._pet_venda_confere(v_pedido, v_exigidos);

  -- a ordem deixa de baixar estoque (devolve o que baixou): quem baixa agora é a venda
  UPDATE public.os_ordens SET situacao = 'entregue', venda_id = v_pedido, entregue_em = now(), controla_estoque = false WHERE id = o.id;
  RETURN jsonb_build_object('pedido_id', v_pedido, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.pet_os_cobrar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_cobrar(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pet_os_situacao(p_os_id uuid, p_situacao text, p_deposito_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.os_ordens%ROWTYPE;
  v_dep uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_situacao NOT IN ('aberta', 'orcamento', 'aprovada', 'em_reparo', 'pronta', 'entregue', 'cancelada') THEN
    RAISE EXCEPTION 'Situação inválida';
  END IF;
  SELECT * INTO o FROM public.os_ordens WHERE id = p_os_id AND tenant_id = v_tenant AND pet_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada'; END IF;
  IF o.situacao IN ('entregue', 'cancelada') THEN RAISE EXCEPTION 'Ordem já encerrada'; END IF;
  IF p_situacao = o.situacao::text THEN RETURN; END IF;
  IF p_situacao = 'entregue' AND o.situacao <> 'pronta' THEN RAISE EXCEPTION 'Só a ordem pronta pode ser entregue'; END IF;
  -- ordem com valor só sai pela cobrança no caixa (pet_os_cobrar); sem valor (ou zerada por desconto), entrega direto
  IF p_situacao = 'entregue' AND o.venda_id IS NULL AND o.valor_total > 0 THEN
    RAISE EXCEPTION 'Esta ordem tem valor a cobrar: use "Cobrar no caixa" (ou zere o valor com desconto)';
  END IF;
  IF p_deposito_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = p_deposito_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Depósito não encontrado';
  END IF;
  v_dep := coalesce(p_deposito_id, o.deposito_id, (SELECT d.id FROM public.depositos d WHERE d.tenant_id = v_tenant AND d.ativo ORDER BY d.created_at LIMIT 1));
  UPDATE public.os_ordens SET situacao = p_situacao::public.os_situacao, deposito_id = v_dep,
         entregue_em = CASE WHEN p_situacao = 'entregue' THEN now() ELSE entregue_em END
   WHERE id = p_os_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_os_situacao(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_os_situacao(uuid, text, uuid) TO authenticated;

-- ============ internação ============
-- Uma linha por internação cobrada. Sem acesso direto: só as funções leem e gravam. `devolvido` guarda a baixa de estoque que foi
-- devolvida no vínculo, para refazê-la se a venda for cancelada.
CREATE TABLE IF NOT EXISTS public.pet_internacao_cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL UNIQUE REFERENCES public.pet_internacoes(id),
  pedido_id uuid NOT NULL UNIQUE REFERENCES public.pedidos(id),
  devolvido jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(devolvido) = 'array'),
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pet_internacao_cobrancas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_internacao_cobrancas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pet_internacao_cobrancas TO service_role;
DROP POLICY IF EXISTS salao_restrito ON public.pet_internacao_cobrancas;
CREATE POLICY salao_restrito ON public.pet_internacao_cobrancas AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- Quem cobra: recepção e gestão (o veterinário e o auxiliar não passam pelo caixa). Só os itens e o total saem daqui, nunca o texto clínico.
CREATE OR REPLACE FUNCTION public._internacao_exige_cobranca()
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
REVOKE ALL ON FUNCTION public._internacao_exige_cobranca() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._internacao_linhas(p_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('produto_id', t.produto_id, 'descricao', t.descricao, 'quantidade', t.quantidade, 'preco', t.preco) ORDER BY t.descricao), '[]'::jsonb)
    FROM (
      SELECT coalesce(i.produto_id, public._pet_produto_avulso()) AS produto_id, min(i.descricao) AS descricao,
             sum(i.quantidade) AS quantidade, i.preco_unitario AS preco
        FROM public.pet_internacao_itens i
       WHERE i.internacao_id = p_id AND i.tenant_id = public.current_tenant_id() AND i.cancelado_em IS NULL
       GROUP BY coalesce(i.produto_id, public._pet_produto_avulso()), i.preco_unitario
    ) t
$$;
REVOKE ALL ON FUNCTION public._internacao_linhas(uuid) FROM PUBLIC, anon, authenticated;

-- Internações encerradas (alta ou óbito) com itens e ainda sem cobrança: a lista da recepção.
CREATE OR REPLACE FUNCTION public.clinica_internacoes_a_cobrar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._internacao_exige_cobranca();
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'encerrado_em') DESC)
      FROM (
        SELECT jsonb_build_object('id', i.id, 'situacao', i.situacao, 'encerrado_em', i.encerrado_em, 'pet', pt.nome, 'tutor', c.nome,
                 'itens', count(it.id), 'total', coalesce(sum(it.total), 0)) AS x
          FROM public.pet_internacoes i
          JOIN public.pets pt ON pt.id = i.pet_id
          JOIN public.clientes c ON c.id = i.cliente_id
          JOIN public.pet_internacao_itens it ON it.internacao_id = i.id AND it.cancelado_em IS NULL
         WHERE i.tenant_id = public.current_tenant_id() AND i.situacao IN ('alta', 'obito')
           AND NOT EXISTS (SELECT 1 FROM public.pet_internacao_cobrancas b WHERE b.internacao_id = i.id)
         GROUP BY i.id, i.situacao, i.encerrado_em, pt.nome, c.nome
         ORDER BY i.encerrado_em DESC LIMIT 100
      ) q), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacoes_a_cobrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacoes_a_cobrar() TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_cobranca(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  i public.pet_internacoes;
  v_linhas jsonb;
BEGIN
  PERFORM public._internacao_exige_cobranca();
  SELECT * INTO i FROM public.pet_internacoes WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Internação não encontrada'; END IF;
  IF i.situacao = 'internado' THEN RAISE EXCEPTION 'O animal ainda está internado: o veterinário precisa dar a alta antes da cobrança'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_internacao_cobrancas WHERE internacao_id = i.id) THEN RAISE EXCEPTION 'Esta internação já foi cobrada'; END IF;
  v_linhas := public._internacao_linhas(i.id);
  IF jsonb_array_length(v_linhas) = 0 THEN RAISE EXCEPTION 'A internação não tem itens para cobrar'; END IF;
  PERFORM public._pet_linhas_unicas(v_linhas);
  RETURN jsonb_build_object('internacao_id', i.id, 'cliente_id', i.cliente_id,
    'pet', (SELECT nome FROM public.pets WHERE id = i.pet_id), 'tutor', (SELECT nome FROM public.clientes WHERE id = i.cliente_id), 'linhas', v_linhas);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_cobranca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_cobranca(uuid) TO authenticated;

-- Vínculo: a venda do caixa cobra a internação encerrada. A baixa de estoque da internação é devolvida (a venda baixa).
CREATE OR REPLACE FUNCTION public.clinica_internacao_cobrar(p_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  i public.pet_internacoes;
  b public.pet_internacao_cobrancas;
  v_pedido uuid;
  v_exigidos jsonb;
  v_dev jsonb := '[]'::jsonb;
  r record;
BEGIN
  PERFORM public._internacao_exige_cobranca();
  SELECT * INTO i FROM public.pet_internacoes WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Internação não encontrada'; END IF;
  SELECT * INTO b FROM public.pet_internacao_cobrancas WHERE internacao_id = i.id;
  IF FOUND THEN
    IF p_pedido_id IS NULL OR b.pedido_id = p_pedido_id THEN
      -- repetir a chamada (resposta perdida) devolve o mesmo resultado
      RETURN jsonb_build_object('pedido_id', b.pedido_id, 'repetido', true);
    END IF;
    RAISE EXCEPTION 'Esta internação já foi cobrada por outra venda';
  END IF;
  IF i.situacao = 'internado' THEN RAISE EXCEPTION 'O animal ainda está internado: o veterinário precisa dar a alta antes da cobrança'; END IF;
  v_exigidos := public._internacao_linhas(i.id);
  IF jsonb_array_length(v_exigidos) = 0 THEN RAISE EXCEPTION 'A internação não tem itens para cobrar'; END IF;
  PERFORM public._pet_linhas_unicas(v_exigidos);

  v_pedido := public._pet_venda_valida(p_pedido_id, p_chave);
  IF EXISTS (SELECT 1 FROM public.pet_internacao_cobrancas x WHERE x.pedido_id = v_pedido) THEN RAISE EXCEPTION 'Esta venda já cobrou outra internação'; END IF;
  IF EXISTS (SELECT 1 FROM public.os_ordens x WHERE x.venda_id = v_pedido) THEN RAISE EXCEPTION 'Esta venda já cobrou uma ordem de serviço'; END IF;
  PERFORM public._pet_venda_confere(v_pedido, v_exigidos);

  FOR r IN SELECT produto_id, baixa_deposito_id, baixa_quantidade FROM public.pet_internacao_itens
            WHERE internacao_id = i.id AND cancelado_em IS NULL AND baixa_deposito_id IS NOT NULL LOOP
    PERFORM public._internacao_movimentar(r.produto_id, r.baixa_deposito_id, 'entrada'::public.mov_tipo, r.baixa_quantidade,
      'Baixa da internação passa para a venda do caixa', 'INT ' || left(i.id::text, 8));
    v_dev := v_dev || jsonb_build_object('produto_id', r.produto_id, 'deposito_id', r.baixa_deposito_id, 'quantidade', r.baixa_quantidade);
  END LOOP;
  INSERT INTO public.pet_internacao_cobrancas (tenant_id, internacao_id, pedido_id, devolvido) VALUES (v_tenant, i.id, v_pedido, v_dev);
  RETURN jsonb_build_object('pedido_id', v_pedido, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_cobrar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_cobrar(uuid, uuid, uuid) TO authenticated;

-- ============ venda cancelada no caixa ============
-- A ordem volta a "pronta" (e baixa o estoque de novo, como antes da cobrança); a internação volta a ficar por cobrar
-- (a baixa devolvida no vínculo é refeita).
CREATE OR REPLACE FUNCTION public.pet_cobranca_venda_cancelada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.pet_internacao_cobrancas;
  d jsonb;
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado' THEN
    UPDATE public.os_ordens SET situacao = 'pronta', venda_id = NULL, entregue_em = NULL, controla_estoque = true
     WHERE venda_id = NEW.id AND pet_id IS NOT NULL;
    FOR c IN SELECT * FROM public.pet_internacao_cobrancas WHERE pedido_id = NEW.id LOOP
      FOR d IN SELECT * FROM jsonb_array_elements(c.devolvido) LOOP
        PERFORM public._internacao_movimentar((d ->> 'produto_id')::uuid, (d ->> 'deposito_id')::uuid, 'saida'::public.mov_tipo,
          (d ->> 'quantidade')::numeric, 'Baixa da internação refeita: venda do caixa cancelada', 'INT ' || left(c.internacao_id::text, 8));
      END LOOP;
      DELETE FROM public.pet_internacao_cobrancas WHERE id = c.id;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pet_cobranca_venda_cancelada() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pet_cobranca_venda_cancelada ON public.pedidos;
CREATE TRIGGER trg_pet_cobranca_venda_cancelada AFTER UPDATE OF situacao ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pet_cobranca_venda_cancelada();
