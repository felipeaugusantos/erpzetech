revoke execute on function public.frente_caixa_atual() from public, anon;
revoke execute on function public.frente_abrir_caixa(uuid,numeric) from public, anon;
revoke execute on function public.frente_venda(uuid,jsonb,forma_pagamento,uuid,numeric,integer,date,uuid) from public, anon;
revoke execute on function public.frente_cancelar_venda(uuid,uuid,text) from public, anon;
revoke execute on function public.frente_movimento(caixa_mov_tipo,numeric,text,uuid) from public, anon;
revoke execute on function public.relatorio_fechamento_operador(date,date) from public, anon;