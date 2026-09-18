ALTER TABLE public.saas_clientes
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS endereco text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text;

CREATE TABLE IF NOT EXISTS public.saas_lojas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id uuid NOT NULL REFERENCES public.saas_clientes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  apelido text,
  tipo text NOT NULL DEFAULT 'filial',
  documento text,
  responsavel text,
  telefone text,
  whatsapp text,
  email text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  situacao text NOT NULL DEFAULT 'implantacao',
  implantacao_paga boolean NOT NULL DEFAULT false,
  abertura date,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_lojas_tipo_chk CHECK (tipo IN ('matriz','filial')),
  CONSTRAINT saas_lojas_situacao_chk CHECK (situacao IN ('implantacao','ativa','inativa'))
);

CREATE INDEX IF NOT EXISTS saas_lojas_cliente_idx ON public.saas_lojas(cliente_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saas_lojas TO authenticated;
GRANT ALL ON public.saas_lojas TO service_role;

ALTER TABLE public.saas_lojas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Somente equipe Ze Tech gerencia lojas"
  ON public.saas_lojas FOR ALL TO authenticated
  USING (public.eh_saas_operador())
  WITH CHECK (public.eh_saas_operador());

CREATE TRIGGER saas_lojas_touch BEFORE UPDATE ON public.saas_lojas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.saas_sincronizar_filiais(p_cliente_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_extras integer;
BEGIN
  IF NOT public.eh_saas_operador() THEN
    RAISE EXCEPTION 'Acesso restrito a equipe Ze Tech';
  END IF;

  SELECT greatest(count(*)::int - 1, 0) INTO v_extras
  FROM public.saas_lojas
  WHERE cliente_id = p_cliente_id AND situacao <> 'inativa';

  UPDATE public.saas_clientes
     SET filiais_extras = v_extras, updated_at = now()
   WHERE id = p_cliente_id;

  RETURN v_extras;
END;
$$;