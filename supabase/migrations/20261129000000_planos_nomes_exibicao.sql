-- Nomes de exibição dos planos do ERP Ze Tech: Balcão passa a Essencial, Loja a Profissional e Rede a Empresarial.
-- Só o texto mostrado muda. O código do plano (balcao, loja, rede), o id, os preços, os limites e as assinaturas continuam iguais.
-- Só troca o que ainda está com o nome original: um nome que a equipe Ze Tech já editou não é sobrescrito.
-- As cobranças futuras passam a dizer "Mensalidade plano Essencial" etc. As faturas já emitidas não são alteradas.

UPDATE public.saas_planos SET nome = 'Essencial' WHERE codigo = 'balcao' AND nome = 'Balcão';
UPDATE public.saas_planos SET nome = 'Profissional' WHERE codigo = 'loja' AND nome = 'Loja';
UPDATE public.saas_planos SET nome = 'Empresarial' WHERE codigo = 'rede' AND nome = 'Rede';

-- itens que citam outro plano pelo nome
UPDATE public.saas_planos SET recursos = array_replace(recursos, 'Tudo do Balcão', 'Tudo do Essencial') WHERE codigo = 'loja';
UPDATE public.saas_planos SET recursos = array_replace(recursos, 'Tudo do Loja', 'Tudo do Profissional') WHERE codigo = 'rede';
