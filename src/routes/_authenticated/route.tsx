import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { registrarLinkDeEntrada } from "@/lib/link-uso";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Sem internet: vale a sessão já guardada neste computador (o banco confere tudo ao reconectar).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw redirect({ to: "/auth" });
      return { user: s.session.user };
    }

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
  component: Layout,
});

function Layout() {
  // quem entrou pelo link da empresa tem o uso registrado (o link fica guardado até o login terminar)
  useEffect(() => {
    void registrarLinkDeEntrada();
  }, []);
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
