-- Clínica: lista dos serviços de consulta ativos para o veterinário iniciar um atendimento no Prontuário, sem consulta marcada.
-- A visita em si é criada por clinica_visita_registrar (a mesma do trabalho sem internet); o preço é conferido lá.
CREATE OR REPLACE FUNCTION public.clinica_servicos_consulta()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_vet();
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', sv.id, 'nome', sv.nome, 'duracao_min', sv.duracao_min) ORDER BY sv.nome), '[]'::jsonb)
            FROM public.pet_servicos sv
           WHERE sv.tenant_id = public.current_tenant_id() AND sv.ativo AND sv.categoria = 'consulta');
END $$;
REVOKE ALL ON FUNCTION public.clinica_servicos_consulta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_servicos_consulta() TO authenticated;

-- Cadastro profissional do veterinário que está logado: a ficha do paciente só oferece "Continuar atendimento" para o atendimento aberto por ele
-- (o de outro veterinário não abre nem edita por este usuário).
CREATE OR REPLACE FUNCTION public.clinica_meu_veterinario()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public._clinica_vet();
END $$;
REVOKE ALL ON FUNCTION public.clinica_meu_veterinario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_meu_veterinario() TO authenticated;
