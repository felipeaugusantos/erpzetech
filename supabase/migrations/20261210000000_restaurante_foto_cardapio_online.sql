-- Restaurante: foto do item do cardápio e cardápio online (página pública, só para ver).
--
-- Foto: bucket público `cardapio-fotos` (a foto do prato é feita para ser exibida: PDV, salão, cardápio online).
-- O arquivo fica em `<empresa>/<arquivo>`; só a gestão da própria empresa envia, troca e apaga. O endereço do arquivo
-- tem um nome aleatório, então não dá para listar as fotos de uma empresa pelo endereço.
--
-- Cardápio online: a empresa liga em `restaurante_config.cardapio_online` (desligado por padrão) e a página
-- `/menu/<link da empresa>` mostra categorias, itens ativos, preço, descrição, foto e adicionais. A função pública devolve
-- só isso: nunca custo, ficha técnica, estação, comandas nem dados de clientes.

ALTER TABLE public.restaurante_config ADD COLUMN IF NOT EXISTS cardapio_online boolean NOT NULL DEFAULT false;

ALTER TABLE public.cardapio_itens ADD COLUMN IF NOT EXISTS foto_path text;
ALTER TABLE public.cardapio_itens DROP CONSTRAINT IF EXISTS cardapio_itens_foto_ck;
ALTER TABLE public.cardapio_itens ADD CONSTRAINT cardapio_itens_foto_ck CHECK (
  foto_path IS NULL
  OR (foto_path LIKE tenant_id::text || '/%' AND substr(foto_path, 38) ~ '^[A-Za-z0-9._-]{1,100}$')
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cardapio-fotos', 'cardapio-fotos', true, 4194304, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 4194304,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS cardapio_fotos_select ON storage.objects;
DROP POLICY IF EXISTS cardapio_fotos_insert ON storage.objects;
DROP POLICY IF EXISTS cardapio_fotos_update ON storage.objects;
DROP POLICY IF EXISTS cardapio_fotos_delete ON storage.objects;
CREATE POLICY cardapio_fotos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cardapio-fotos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY cardapio_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cardapio-fotos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
              AND public.restaurante_gestao());
CREATE POLICY cardapio_fotos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cardapio-fotos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
         AND public.restaurante_gestao())
  WITH CHECK (bucket_id = 'cardapio-fotos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY cardapio_fotos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cardapio-fotos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
         AND public.restaurante_gestao());

-- ===== Cardápio público =====
CREATE OR REPLACE FUNCTION public.restaurante_cardapio_publico(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp record;
  v_cats jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[A-Za-z0-9-]{3,50}$' THEN RETURN NULL; END IF;

  SELECT e.tenant_id, coalesce(nullif(e.nome_fantasia, ''), e.razao_social) AS nome, e.cor_primaria, e.logo_path
    INTO v_emp
    FROM public.empresas e
    JOIN public.restaurante_config c ON c.tenant_id = e.tenant_id AND c.cardapio_online
   WHERE e.slug IS NOT NULL AND lower(e.slug) = lower(p_slug) AND e.ativo
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(cat.obj ORDER BY cat.ord, cat.nome), '[]'::jsonb) INTO v_cats FROM (
    SELECT g.ord, g.nome, jsonb_build_object('nome', g.nome, 'itens', g.itens) AS obj FROM (
      SELECT coalesce(c.ordem, 2147483647) AS ord, coalesce(c.nome, 'Outros') AS nome,
             jsonb_agg(jsonb_build_object(
               'nome', i.nome,
               'descricao', i.descricao,
               'preco', i.preco,
               'foto_path', i.foto_path,
               'grupos', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'nome', gr.nome, 'obrigatorio', gr.obrigatorio, 'max_escolhas', gr.max_escolhas,
                          'opcoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', o.nome, 'preco_adicional', o.preco_adicional)
                                                              ORDER BY o.nome), '[]'::jsonb)
                                       FROM public.cardapio_opcoes o
                                      WHERE o.grupo_id = gr.id AND o.tenant_id = v_emp.tenant_id AND o.ativo))
                        ORDER BY gr.nome)
                   FROM public.cardapio_grupos gr
                  WHERE gr.item_id = i.id AND gr.tenant_id = v_emp.tenant_id), '[]'::jsonb)
             ) ORDER BY i.ordem, i.nome) AS itens
        FROM public.cardapio_itens i
        LEFT JOIN public.cardapio_categorias c ON c.id = i.categoria_id AND c.tenant_id = i.tenant_id
       WHERE i.tenant_id = v_emp.tenant_id AND i.ativo AND NOT i.interno
         AND (i.categoria_id IS NULL OR c.ativo)
       GROUP BY c.id, c.ordem, c.nome
    ) g
  ) cat;

  RETURN jsonb_build_object(
    'empresa', jsonb_build_object('nome', v_emp.nome, 'cor', v_emp.cor_primaria, 'logo_path', v_emp.logo_path),
    'categorias', v_cats);
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_cardapio_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restaurante_cardapio_publico(text) TO anon, authenticated, service_role;
