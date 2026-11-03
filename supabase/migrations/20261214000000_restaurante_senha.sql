-- Restaurante: senha do pedido de balcao (lojas de shopping) e painel de senhas.
--
-- A comanda avulsa (sem mesa) pode receber uma senha: numero sequencial do dia, por empresa e filial, que recomeca
-- em 1 a cada dia (fuso de Sao Paulo). Emitir a senha tambem envia os itens pendentes a producao. O painel de
-- senhas usa o andamento que ja existe nos itens: "em preparo" enquanto algum item esta na fila ou sendo feito,
-- "pronto" quando nao ha mais nada em preparo e algum item esta pronto; some quando tudo foi entregue.

ALTER TABLE public.comandas
  ADD COLUMN IF NOT EXISTS senha integer CHECK (senha IS NULL OR senha > 0),
  ADD COLUMN IF NOT EXISTS senha_data date,
  ADD CONSTRAINT comandas_senha_ck CHECK ((senha IS NULL) = (senha_data IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS comandas_senha_uk
  ON public.comandas (tenant_id, coalesce(filial_id, '00000000-0000-0000-0000-000000000000'::uuid), senha_data, senha)
  WHERE senha IS NOT NULL;

-- contador do dia (so as funcoes mexem; sem acesso do cliente)
CREATE TABLE IF NOT EXISTS public.restaurante_senhas_contador (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  filial_chave uuid NOT NULL,
  data date NOT NULL,
  ultimo integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, filial_chave, data)
);
ALTER TABLE public.restaurante_senhas_contador ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurante_senhas_contador FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.restaurante_senhas_contador TO service_role;

CREATE OR REPLACE FUNCTION public.restaurante_emitir_senha(p_comanda_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_cmd public.comandas;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_senha integer;
  v_enviados integer;
BEGIN
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.situacao <> 'aberta' THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;
  IF v_cmd.tipo <> 'salao' OR v_cmd.mesa_id IS NOT NULL THEN
    RAISE EXCEPTION 'A senha é só para comanda avulsa (balcão)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado') THEN
    RAISE EXCEPTION 'Lance os itens do pedido antes de emitir a senha';
  END IF;

  IF v_cmd.senha IS NULL THEN
    INSERT INTO public.restaurante_senhas_contador (tenant_id, filial_chave, data, ultimo)
    VALUES (v_tenant, coalesce(v_cmd.filial_id, '00000000-0000-0000-0000-000000000000'::uuid), v_hoje, 1)
    ON CONFLICT (tenant_id, filial_chave, data) DO UPDATE SET ultimo = restaurante_senhas_contador.ultimo + 1
    RETURNING ultimo INTO v_senha;
    UPDATE public.comandas SET senha = v_senha, senha_data = v_hoje WHERE id = p_comanda_id;
  ELSE
    v_senha := v_cmd.senha;
  END IF;

  -- quem emite a senha manda o pedido para a producao; reemitir so reenvia o que ainda estiver pendente
  v_enviados := public.restaurante_enviar_cozinha(p_comanda_id);
  RETURN jsonb_build_object('senha', v_senha, 'enviados', v_enviados, 'nova', v_cmd.senha IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_emitir_senha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_emitir_senha(uuid) TO authenticated;
