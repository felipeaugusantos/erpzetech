REVOKE EXECUTE ON FUNCTION public.inventario_abrir(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_contar(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_aplicar(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_cancelar(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_movimentacao(uuid, uuid, mov_tipo, numeric, text, text, uuid, numeric) FROM anon;