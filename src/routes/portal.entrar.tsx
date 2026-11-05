import { useEffect, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { PortalShell } from "@/components/portal/PortalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { guardarCodigoDoConvite } from "@/lib/portal-sessao";
import { codigoDoFragmento } from "@/lib/portal-tutor";

export const Route = createFileRoute("/portal/entrar")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Entrar — Portal do tutor" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async () => {
    // o código do convite vem no fragmento do link (#c=…): guarda só nesta aba antes de qualquer redirecionamento
    const codigo = codigoDoFragmento(window.location.hash);
    if (codigo) guardarCodigoDoConvite(codigo);
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/portal" });
  },
  component: Entrar,
});

function Entrar() {
  const navigate = useNavigate();
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // tira o código do endereço da página (ele já está guardado só nesta aba)
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    if (modo === "entrar") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });
      setOcupado(false);
      if (error) {
        toast.error("Não foi possível entrar", { description: "Confira o e-mail e a senha." });
        return;
      }
      void navigate({ to: "/portal" });
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: { emailRedirectTo: `${window.location.origin}/portal` },
    });
    setOcupado(false);
    if (error) {
      toast.error("Não foi possível criar a conta", { description: error.message });
      return;
    }
    if (!data.session) {
      toast.success("Confirme seu e-mail", {
        description:
          "Enviamos um link de confirmação. Depois de confirmar, entre e use o código da clínica.",
      });
      setModo("entrar");
      return;
    }
    void navigate({ to: "/portal" });
  }

  return (
    <PortalShell sair={false}>
      <div className="panel space-y-4 p-4">
        <div>
          <h1 className="text-lg font-semibold">{modo === "entrar" ? "Entrar" : "Criar conta"}</h1>
          <p className="text-sm text-muted-foreground">
            {modo === "entrar"
              ? "Acompanhe as próximas vacinas e os exames e receitas que a clínica liberar."
              : "Crie a sua conta. Depois, use o código que a clínica te entregou para vincular seus animais."}
          </p>
        </div>
        <form onSubmit={enviar} className="space-y-3">
          <div>
            <Label htmlFor="pt-email">E-mail</Label>
            <Input
              id="pt-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pt-senha">Senha</Label>
            <Input
              id="pt-senha"
              type="password"
              autoComplete={modo === "entrar" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            {modo === "criar" && (
              <p className="mt-1 text-xs text-muted-foreground">Pelo menos 8 caracteres.</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={ocupado}>
            {ocupado ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
          </Button>
        </form>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setModo(modo === "entrar" ? "criar" : "entrar")}
        >
          {modo === "entrar" ? "Ainda não tenho conta" : "Já tenho conta"}
        </button>
      </div>
    </PortalShell>
  );
}
