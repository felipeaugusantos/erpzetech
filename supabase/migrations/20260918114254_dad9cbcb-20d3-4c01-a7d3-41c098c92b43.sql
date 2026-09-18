create unique index if not exists motoristas_user_id_key on public.motoristas(user_id) where user_id is not null;

create or replace function public.current_motorista_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.motoristas where user_id = auth.uid() limit 1
$$;

create or replace function public.eh_motorista_restrito()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'motorista')
     and not public.has_role(auth.uid(), 'administrador')
     and not public.has_role(auth.uid(), 'gestor')
     and not public.has_role(auth.uid(), 'logistica')
$$;

drop policy if exists entregas_motorista_restrito on public.entregas;
create policy entregas_motorista_restrito on public.entregas
as restrictive for select to authenticated
using (not public.eh_motorista_restrito() or motorista_id = public.current_motorista_id());

drop policy if exists entrega_itens_motorista_restrito on public.entrega_itens;
create policy entrega_itens_motorista_restrito on public.entrega_itens
as restrictive for select to authenticated
using (
  not public.eh_motorista_restrito()
  or exists (select 1 from public.entregas e where e.id = entrega_id and e.motorista_id = public.current_motorista_id())
);

create or replace function public.entregas_bloqueia_outro_motorista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.eh_motorista_restrito() and new.motorista_id is distinct from public.current_motorista_id() then
    raise exception 'Você só pode registrar entregas da sua própria rota';
  end if;
  return new;
end $$;

drop trigger if exists trg_entregas_motorista_guard on public.entregas;
create trigger trg_entregas_motorista_guard
before update on public.entregas
for each row execute function public.entregas_bloqueia_outro_motorista();