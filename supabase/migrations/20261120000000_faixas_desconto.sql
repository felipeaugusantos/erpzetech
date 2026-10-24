-- Faixas de desconto: desconto máximo (%) por grupo (categoria), marca e perfil do usuário.
-- Vale o desconto que o operador pode dar na frente de caixa sem senha do gestor; acima disso continua pedindo a senha.
-- Qual faixa vale para um produto: das faixas que combinam com o produto e com algum perfil do usuário, vence a mais
-- específica no produto (grupo + marca, depois grupo, depois marca); a faixa de um perfil vence a sem perfil no mesmo nível;
-- se o usuário tem mais de um perfil com faixa no mesmo nível, vale a maior. Sem faixa, vale o limite da empresa
-- (empresas.pdv_desconto_limite, 5% por padrão), como era antes.

CREATE TABLE IF NOT EXISTS public.faixas_desconto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants (id) ON DELETE CASCADE,
  perfil public.app_role,
  categoria_id uuid REFERENCES public.categorias (id) ON DELETE CASCADE,
  marca text CHECK (marca IS NULL OR btrim(marca) <> ''),
  percentual numeric(5,2) NOT NULL CHECK (percentual BETWEEN 0 AND 100),
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- uma faixa por combinação (perfil, grupo, marca) na empresa
CREATE UNIQUE INDEX IF NOT EXISTS faixas_desconto_combinacao_uk ON public.faixas_desconto (
  tenant_id, perfil, categoria_id, lower(btrim(marca))) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.faixas_desconto_confere() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.categoria_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.categorias WHERE id = NEW.categoria_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Grupo de outra empresa';
  END IF;
  IF NEW.marca IS NOT NULL AND btrim(NEW.marca) = '' THEN RAISE EXCEPTION 'Marca em branco'; END IF;
  NEW.marca := btrim(NEW.marca);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS faixas_desconto_confere ON public.faixas_desconto;
CREATE TRIGGER faixas_desconto_confere BEFORE INSERT OR UPDATE ON public.faixas_desconto
  FOR EACH ROW EXECUTE FUNCTION public.faixas_desconto_confere();

ALTER TABLE public.faixas_desconto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faixas_desconto FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.faixas_desconto TO authenticated;
GRANT ALL ON public.faixas_desconto TO service_role;
DROP POLICY IF EXISTS faixas_desconto_leitura ON public.faixas_desconto;
DROP POLICY IF EXISTS faixas_desconto_inclusao ON public.faixas_desconto;
DROP POLICY IF EXISTS faixas_desconto_alteracao ON public.faixas_desconto;
DROP POLICY IF EXISTS faixas_desconto_exclusao ON public.faixas_desconto;
DROP POLICY IF EXISTS salao_restrito ON public.faixas_desconto;
CREATE POLICY faixas_desconto_leitura ON public.faixas_desconto FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY faixas_desconto_inclusao ON public.faixas_desconto FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
CREATE POLICY faixas_desconto_alteracao ON public.faixas_desconto FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY faixas_desconto_exclusao ON public.faixas_desconto FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));
CREATE POLICY salao_restrito ON public.faixas_desconto AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- Quanto de desconto (em R$) o usuário que chama pode dar nestes itens sem senha do gestor.
-- p_itens: [{produto_id, quantidade, preco_unitario}], o mesmo formato da venda.
CREATE OR REPLACE FUNCTION public.desconto_limite_itens(p_itens jsonb)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_padrao numeric;
  v_total numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Itens em formato inválido'; END IF;

  SELECT coalesce(e.pdv_desconto_limite, 5) INTO v_padrao FROM public.empresas e
   WHERE e.tenant_id = v_tenant ORDER BY e.created_at LIMIT 1;
  v_padrao := coalesce(v_padrao, 5);

  SELECT coalesce(round(sum(x.valor * x.pct / 100), 2), 0) INTO v_total
    FROM (
      SELECT (it ->> 'quantidade')::numeric * coalesce((it ->> 'preco_unitario')::numeric, 0) AS valor,
             coalesce(f.percentual, v_padrao) AS pct
        FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) it
        LEFT JOIN public.produtos p ON p.id = (it ->> 'produto_id')::uuid AND p.tenant_id = v_tenant
        LEFT JOIN LATERAL (
          SELECT r.percentual
            FROM public.faixas_desconto r
           WHERE r.tenant_id = v_tenant AND r.ativa
             AND (r.perfil IS NULL OR public.has_role(auth.uid(), r.perfil))
             AND (r.categoria_id IS NULL OR r.categoria_id = p.categoria_id)
             AND (r.marca IS NULL OR lower(btrim(r.marca)) = lower(btrim(coalesce(p.marca, ''))))
           ORDER BY ((r.categoria_id IS NOT NULL)::int * 2 + (r.marca IS NOT NULL)::int) * 2 + (r.perfil IS NOT NULL)::int DESC,
                    r.percentual DESC
           LIMIT 1
        ) f ON true
    ) x;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.desconto_limite_itens(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desconto_limite_itens(jsonb) TO authenticated;

-- A venda da frente de caixa passa a usar as faixas (antes: só o limite único da empresa).
CREATE OR REPLACE FUNCTION public.frente_venda(p_deposito_id uuid, p_itens jsonb, p_forma forma_pagamento, p_cliente_id uuid DEFAULT NULL::uuid, p_desconto numeric DEFAULT 0, p_parcelas integer DEFAULT 1, p_primeiro_vencimento date DEFAULT NULL::date, p_autorizacao uuid DEFAULT NULL::uuid, p_chave uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_caixa uuid := public.frente_caixa_atual(); v_permitido numeric; v_sub numeric := 0; it jsonb;
  v_pedido uuid; v_gestor uuid; v_existente uuid;
begin
  PERFORM public.exige_nao_salao();
  -- mesma chave de novo: devolve a venda já gravada, sem vender (nem consumir a autorização) outra vez.
  -- O bloqueio faz duas tentativas simultâneas da mesma venda esperarem uma pela outra.
  if p_chave is not null then
    perform pg_advisory_xact_lock(hashtextextended(public.current_tenant_id()::text || ':' || p_chave::text, 0));
    select id into v_existente from public.pedidos
     where tenant_id = public.current_tenant_id() and chave_idempotencia = p_chave;
    if v_existente is not null then return v_existente; end if;
  end if;
  if v_caixa is null then raise exception 'Abra o seu caixa antes de vender'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_sub := v_sub + (it->>'quantidade')::numeric * coalesce((it->>'preco_unitario')::numeric,0);
  end loop;
  v_permitido := public.desconto_limite_itens(p_itens);
  if v_sub > 0 and coalesce(p_desconto,0) > v_permitido then
    if p_autorizacao is null then raise exception 'Desconto acima do permitido (R$ %): exige senha do gestor', v_permitido; end if;
    v_gestor := public.consumir_autorizacao(p_autorizacao, 'desconto');
  end if;
  v_pedido := public.pdv_venda(p_deposito_id, p_itens, p_forma, p_cliente_id, p_desconto, p_parcelas, p_primeiro_vencimento, 'Venda na frente de caixa');
  update public.pedidos set caixa_id = v_caixa, autorizado_por = v_gestor, chave_idempotencia = p_chave where id = v_pedido;
  return v_pedido;
end $function$;
