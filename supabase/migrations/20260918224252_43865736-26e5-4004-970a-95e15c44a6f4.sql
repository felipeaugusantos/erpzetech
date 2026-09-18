ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS regime_tributario text NOT NULL DEFAULT 'simples',
  ADD COLUMN IF NOT EXISTS inscricao_municipal text,
  ADD COLUMN IF NOT EXISTS cnae text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='empresas' AND policyname='Admin cria empresa do tenant'
  ) THEN
    CREATE POLICY "Admin cria empresa do tenant" ON public.empresas
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'administrador'));
  END IF;
END $$;
