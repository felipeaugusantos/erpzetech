create or replace function public.block_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Registros de entrega não podem ser excluídos';
end $$;

drop trigger if exists block_entregas on public.entregas;
drop trigger if exists block_entrega_itens on public.entrega_itens;

create trigger block_entregas_delete before delete on public.entregas
for each row execute function public.block_delete();
create trigger block_entrega_itens_delete before delete on public.entrega_itens
for each row execute function public.block_delete();