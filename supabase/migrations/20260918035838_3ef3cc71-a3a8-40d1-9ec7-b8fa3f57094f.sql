create or replace function public.block_delete() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Registros de entrega não podem ser excluídos';
end $$;