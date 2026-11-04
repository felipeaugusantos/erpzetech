-- Testes comportamentais do bulário veterinário (base global do MAPA): carga só pelo serviço, consulta só da clínica liberada.
-- Traz as próprias fixtures e desfaz tudo com ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA ci;
GRANT USAGE ON SCHEMA ci TO PUBLIC;

CREATE FUNCTION ci.entrar(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  EXECUTE CASE WHEN uid IS NULL THEN 'SET ROLE anon' ELSE 'SET ROLE authenticated' END;
END $$;
CREATE FUNCTION ci.sair() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);
  EXECUTE 'RESET ROLE';
END $$;
CREATE FUNCTION ci.deve_falhar(uid uuid, cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN falhou := true; END;
  PERFORM ci.sair();
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  RAISE NOTICE 'ok: % recusado', descricao;
END $$;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;

DO $$
DECLARE
  tv constant uuid := 'c1111111-1111-1111-1111-111111111111';
  tl constant uuid := 'c2222222-2222-2222-2222-222222222222';
  vet constant uuid := 'c0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'c0000000-0000-0000-0000-000000000002';
  vetl constant uuid := 'c0000000-0000-0000-0000-000000000003';
  op constant uuid := 'c0000000-0000-0000-0000-000000000004';
  r jsonb; n integer; id1 uuid;
  tw constant uuid := 'c3333333-3333-3333-3333-333333333333';
  vetw constant uuid := 'c0000000-0000-0000-0000-000000000005';
BEGIN
  INSERT INTO tenants (id, nome) VALUES (tv, 'Clínica'), (tl, 'Loja');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (tv, 'Clínica LTDA', 'clinica'), (tl, 'Loja LTDA', 'varejo');
  INSERT INTO auth.users (id, email) VALUES (vet, 'v@c.ci'), (vend, 'r@c.ci'), (vetl, 'l@c.ci'), (op, 'o@c.ci');
  INSERT INTO saas_operadores (user_id, nome) VALUES (op, 'operador');
  INSERT INTO tenants (id, nome) VALUES (tw, 'Clínica W');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (tw, 'Clínica W LTDA', 'clinica');
  INSERT INTO auth.users (id, email) VALUES (vetw, 'w@c.ci');
  UPDATE profiles SET tenant_id = tw, nome = 'vetw' WHERE id = vetw;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vetw, tw, 'veterinario');
  UPDATE profiles SET tenant_id = tv, nome = 'vet' WHERE id = vet;
  UPDATE profiles SET tenant_id = tv, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = tl, nome = 'vetl' WHERE id = vetl;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vet, tv, 'veterinario'), (vend, tv, 'vendedor'), (vetl, tl, 'veterinario');

  -- carga: só service_role
  PERFORM ci.deve_falhar(vet, $q$SELECT public.bulario_importar('[{"nome":"X"}]'::jsonb)$q$, 'empresa não carrega o bulário');
  SET ROLE service_role;
  n := public.bulario_importar($j$[
    {"registro":"100","nome":"ADAPTIL Difusor","fabricante":"CEVA","principio_ativo":"Feromônio apaziguante","situacao":"Ativo"},
    {"registro":"101","nome":"Ácaro Mix","fabricante":"BIOFARM"},
    {"nome":"4Dx Plus","fabricante":"IDEXX"},
    {"registro":"100","nome":"ADAPTIL Difusor","fabricante":"CEVA","principio_ativo":"Feromônio apaziguante","situacao":"Suspenso"},
    {"nome":"  "}
  ]$j$::jsonb);
  RESET ROLE;
  PERFORM ci.exige(n = 3, 'lote repetido e linha sem nome não duplicam (entraram ' || n || ')');
  PERFORM ci.exige((SELECT situacao FROM bulario_medicamentos WHERE registro = '100') = 'Suspenso', 'recarga atualiza o registro existente');

  -- ninguém lê a tabela direto
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM public.bulario_medicamentos', 'leitura direta da tabela');

  -- consulta
  PERFORM ci.entrar(vet);
  r := public.bulario_buscar();
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 3 AND r -> 'itens' -> 0 ->> 'nome' = '4Dx Plus', 'lista ordenada por nome');
  PERFORM ci.entrar(vet); r := public.bulario_buscar('feromonio ceva'); PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 1, 'busca sem acento, várias palavras');
  PERFORM ci.entrar(vet); r := public.bulario_buscar(p_letra => 'A'); PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 2, 'letra A inclui Ácaro (sem acento)');
  PERFORM ci.entrar(vet); r := public.bulario_buscar(p_letra => '#'); PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 1 AND r -> 'itens' -> 0 ->> 'nome' = '4Dx Plus', 'letra # pega o que não começa com letra');
  PERFORM ci.entrar(vet); r := public.bulario_buscar(p_fabricante => 'ceva'); PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 1, 'filtro por fabricante');
  PERFORM ci.entrar(vet); r := public.bulario_buscar(p_limite => 1, p_pagina => 1); PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 3 AND jsonb_array_length(r -> 'itens') = 1, 'paginação mantém o total');
  PERFORM ci.entrar(vet); r := public.bulario_resumo(); PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::int = 3 AND jsonb_array_length(r -> 'fabricantes') = 3, 'resumo');

  -- total para a equipe EZRA
  PERFORM ci.entrar(op); n := public.bulario_total(); PERFORM ci.sair();
  PERFORM ci.exige(n = 3, 'operador vê o total sem precisar de clínica');
  PERFORM ci.deve_falhar(vet, 'SELECT public.bulario_total()', 'empresa não vê o total da carga');

  -- ficha e notas da clínica (isoladas por empresa)
  SELECT id INTO id1 FROM bulario_medicamentos WHERE registro = '100';
  PERFORM ci.entrar(vet); r := public.bulario_ficha(id1); PERFORM ci.sair();
  PERFORM ci.exige(r -> 'medicamento' ->> 'nome' = 'ADAPTIL Difusor' AND r -> 'nota' = 'null'::jsonb, 'ficha sem nota ainda');
  PERFORM ci.entrar(vet);
  PERFORM public.bulario_nota_salvar(id1, '{"doses":"  1 a cada 12h  ","indicacoes":"Ansiedade"}'::jsonb);
  r := public.bulario_ficha(id1);
  PERFORM ci.sair();
  PERFORM ci.exige(r -> 'nota' ->> 'doses' = '1 a cada 12h' AND r -> 'nota' ->> 'apresentacoes' IS NULL, 'nota salva e aparada');
  PERFORM ci.entrar(vetw); r := public.bulario_ficha(id1); PERFORM ci.sair();
  PERFORM ci.exige(r -> 'nota' = 'null'::jsonb, 'outra empresa não vê a nota');
  PERFORM ci.entrar(vetw); PERFORM public.bulario_nota_salvar(id1, '{"doses":"da W"}'::jsonb); PERFORM ci.sair();
  PERFORM ci.entrar(vet); r := public.bulario_ficha(id1); PERFORM ci.sair();
  PERFORM ci.exige(r -> 'nota' ->> 'doses' = '1 a cada 12h', 'nota de uma empresa não sobrescreve a da outra');
  PERFORM ci.entrar(vet); PERFORM public.bulario_nota_salvar(id1, '{"doses":"  ","indicacoes":""}'::jsonb); r := public.bulario_ficha(id1); PERFORM ci.sair();
  PERFORM ci.exige(r -> 'nota' = 'null'::jsonb, 'tudo em branco apaga a nota');
  PERFORM ci.exige((SELECT count(*) FROM bulario_notas) = 1, 'só a nota da outra empresa ficou');
  PERFORM ci.deve_falhar(vet, format($q$SELECT public.bulario_nota_salvar(%L, jsonb_build_object('doses', repeat('x', 6001)))$q$, id1), 'campo acima de 6000 caracteres');
  PERFORM ci.deve_falhar(vet, $q$SELECT public.bulario_nota_salvar(gen_random_uuid(), '{"doses":"x"}'::jsonb)$q$, 'nota de medicamento inexistente');
  PERFORM ci.deve_falhar(vet, $q$SELECT public.bulario_ficha(gen_random_uuid())$q$, 'ficha de medicamento inexistente');
  PERFORM ci.deve_falhar(vend, format($q$SELECT public.bulario_nota_salvar(%L, '{"doses":"x"}'::jsonb)$q$, id1), 'vendedor não escreve nota');
  PERFORM ci.deve_falhar(vetl, format($q$SELECT public.bulario_ficha(%L)$q$, id1), 'empresa sem clínica não abre a ficha');
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM public.bulario_notas', 'leitura direta das notas');

  -- quem não pode
  PERFORM ci.deve_falhar(vend, 'SELECT public.bulario_buscar()', 'vendedor não consulta');
  PERFORM ci.deve_falhar(vetl, 'SELECT public.bulario_buscar()', 'empresa sem clínica não consulta');
  PERFORM ci.deve_falhar(NULL, 'SELECT public.bulario_buscar()', 'anônimo não consulta');
  PERFORM ci.deve_falhar(vet, $q$SELECT public.bulario_buscar(p_letra => 'AB')$q$, 'letra inválida');
END $$;
ROLLBACK;
