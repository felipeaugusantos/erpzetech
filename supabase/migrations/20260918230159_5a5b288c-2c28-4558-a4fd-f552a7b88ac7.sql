CREATE POLICY empresa_logo_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'empresa'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY empresa_logo_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'empresa'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_role(auth.uid(), 'administrador')
  );

CREATE POLICY empresa_logo_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'empresa'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_role(auth.uid(), 'administrador')
  )
  WITH CHECK (
    bucket_id = 'empresa'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY empresa_logo_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'empresa'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_role(auth.uid(), 'administrador')
  );