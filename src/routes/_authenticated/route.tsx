import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { ContadorShell } from "@/components/app/ContadorShell";
import { registrarLinkDeEntrada } from "@/lib/link-uso";

// As funções do contador entram nos tipos gerados quando o Lovable os atualizar depois da migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcSemTipo = (nome: string) => (supabase as any).rpc(nome);

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Sem internet: vale a sessão já guardada neste computador (o banco confere tudo ao reconectar).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) throw redirect({ to: "/auth" });
      return { user: s.session.user, contador: null as null | { editaTributos: boolean } };
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

    // Contador: só a própria área (o banco recusa o resto mesmo que alguém abra outro endereço). Sem acesso ativo
    // (revogado), vai para a tela do contador, que mostra o aviso.
    const { data: ehContador } = await rpcSemTipo("eh_contador_restrito");
    if (ehContador === true) {
      const { data: acesso } = await rpcSemTipo("contador_meu_acesso");
      const edita = Array.isArray(acesso) && acesso[0]?.pode_editar_tributos === true;
      const liberadas = edita ? ["/contador", "/tributos-aprox", "/fiscal-regras"] : ["/contador"];
      if (!liberadas.includes(location.pathname.replace(/\/+$/, ""))) {
        throw redirect({ to: "/contador" });
      }
      return { user: data.user, contador: { editaTributos: edita } };
    }
    return { user: data.user, contador: null as null | { editaTributos: boolean } };
  },
  component: Layout,
});

function Layout() {
  const { contador } = Route.useRouteContext();
  // quem entrou pelo link da empresa tem o uso registrado (o link fica guardado até o login terminar)
  useEffect(() => {
    void registrarLinkDeEntrada();
  }, []);
  if (contador) {
    return (
      <ContadorShell editaTributos={contador.editaTributos}>
        <Outlet />
      </ContadorShell>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
