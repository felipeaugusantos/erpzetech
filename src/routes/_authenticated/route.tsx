import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Conta sem empresa (cadastro próprio): segue para a criação do espaço, exceto equipe Ze Tech.
    const { data: perfil } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.user.id)
      .maybeSingle();
    if (perfil && !perfil.tenant_id) {
      const { data: operador } = await supabase.rpc("eh_saas_operador");
      if (!operador) throw redirect({ to: "/boas-vindas" });
    }
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
