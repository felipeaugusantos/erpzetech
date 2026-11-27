ALTER POLICY modelos_editar ON public.clinica_wa_campanha_modelos
  USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));