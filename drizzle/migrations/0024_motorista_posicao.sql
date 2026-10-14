ALTER TABLE public.motoristas ADD COLUMN IF NOT EXISTS ultima_lat double precision, ADD COLUMN IF NOT EXISTS ultima_lng double precision, ADD COLUMN IF NOT EXISTS ultima_posicao_em timestamptz;
CREATE OR REPLACE FUNCTION public.motorista_enviar_posicao(p_lat double precision, p_lng double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Posição inválida'; END IF;
  UPDATE public.motoristas SET ultima_lat = p_lat, ultima_lng = p_lng, ultima_posicao_em = now()
   WHERE user_id = auth.uid() AND tenant_id = public.current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION public.motorista_enviar_posicao(double precision, double precision) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.motorista_enviar_posicao(double precision, double precision) TO authenticated;