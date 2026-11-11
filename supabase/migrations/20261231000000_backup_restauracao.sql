-- Restauração assistida de backup por cliente (fase 4): devolve ao cliente linhas de CADASTRO que faltam.
-- Regras que não se negociam:
--   * só INSERE: linha que já existe fica como está (ON CONFLICT DO NOTHING); nada é sobrescrito nem apagado;
--   * só cadastros sem efeito colateral (lista abaixo, a mesma de src/lib/backup-restauracao.ts, conferida por teste):
--     nunca vendas, estoque, financeiro, fiscal, prontuário, nem acessos e permissões (restaurar papel antigo devolveria acesso revogado);
--   * toda linha precisa ser do cliente informado; as colunas vêm do arquivo, o resto usa o padrão da tabela;
--   * só o serviço chama (equipe Ze Tech, por função de servidor); cada chamada fica na auditoria do cliente;
--   * os gatilhos de validação da tabela continuam ligados.
CREATE OR REPLACE FUNCTION public.backup_restaurar_tabela(p_tenant uuid, p_tabela text, p_linhas jsonb, p_usuario uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  permitidas constant text[] := ARRAY['fornecedores', 'categorias', 'tabelas_preco', 'lr_lavadores', 'produtos', 'produto_variacoes', 'tabela_preco_itens', 'clientes', 'pets', 'lr_veiculos', 'obras', 'veiculos', 'pet_servicos', 'pet_servico_precos', 'lr_servicos', 'lr_servico_precos', 'lr_planos'];
  colunas text;
  enviadas integer;
  inseridas integer;
BEGIN
  IF NOT (p_tabela = ANY (permitidas)) THEN
    RAISE EXCEPTION 'Tabela não restaurável: %', p_tabela USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'As linhas devem vir em uma lista.' USING ERRCODE = '22023';
  END IF;
  enviadas := jsonb_array_length(p_linhas);
  IF enviadas = 0 OR enviadas > 1000 THEN
    RAISE EXCEPTION 'Envie de 1 a 1000 linhas por chamada.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_linhas) r WHERE r->>'tenant_id' IS DISTINCT FROM p_tenant::text) THEN
    RAISE EXCEPTION 'Há linha que não pertence a este cliente.' USING ERRCODE = '42501';
  END IF;

  -- colunas do arquivo que existem na tabela e não são geradas
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO colunas
    FROM pg_attribute a
   WHERE a.attrelid = format('public.%I', p_tabela)::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND (p_linhas -> 0) ? a.attname;
  IF colunas IS NULL OR position('"id"' IN '"' || replace(colunas, ', ', '", "') || '"') = 0 THEN
    RAISE EXCEPTION 'As linhas não trazem a coluna id.' USING ERRCODE = '22023';
  END IF;

  EXECUTE format(
    'INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) ON CONFLICT DO NOTHING',
    p_tabela, colunas, colunas, p_tabela)
  USING p_linhas;
  GET DIAGNOSTICS inseridas = ROW_COUNT;

  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, operacao, valor_novo)
  VALUES (p_tenant, p_usuario, 'backup_restauracao', 'restaurar',
          jsonb_build_object('tabela', p_tabela, 'enviadas', enviadas, 'inseridas', inseridas, 'origem', 'equipe_ze_tech'));

  RETURN jsonb_build_object('enviadas', enviadas, 'inseridas', inseridas, 'ja_existiam', enviadas - inseridas);
END;
$$;

REVOKE ALL ON FUNCTION public.backup_restaurar_tabela(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_restaurar_tabela(uuid, text, jsonb, uuid) TO service_role;
