revoke execute on function public.frente_abrir_caixa(uuid,numeric) from public, anon;
revoke execute on function public.relatorio_fechamento_operador(date,date) from public, anon;
grant execute on function public.frente_abrir_caixa(uuid,numeric) to authenticated;
grant execute on function public.relatorio_fechamento_operador(date,date) to authenticated;