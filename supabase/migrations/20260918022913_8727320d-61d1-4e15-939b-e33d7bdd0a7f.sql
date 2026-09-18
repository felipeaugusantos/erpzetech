
revoke all on function public.handle_new_user() from anon, authenticated, public;
revoke all on function public.current_tenant_id() from anon, public;
revoke all on function public.has_role(uuid, public.app_role) from anon, public;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
