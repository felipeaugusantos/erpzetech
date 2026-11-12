-- Preserve exact decimal calculated results; do not rewrite existing examinations.
CREATE OR REPLACE FUNCTION public._clinica_exame_recalcular(p_exame_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.pet_exame_resultados r
     SET valor_num = (SELECT t.valor_num * p.valor_num / 100
                        FROM public.pet_exame_resultados t, public.pet_exame_resultados p
                       WHERE t.id = r.total_id AND p.id = r.pct_id AND t.valor_num IS NOT NULL AND p.valor_num IS NOT NULL)
    WHERE r.exame_id = p_exame_id AND r.forma = 'calculado'
$$;
REVOKE ALL ON FUNCTION public._clinica_exame_recalcular(uuid) FROM PUBLIC, anon, authenticated;