import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ze-tech-login")({
  head: () => ({
    meta: [
      { title: "Acesso Ze Tech — área do fabricante" },
      {
        name: "description",
        content:
          "Entrada exclusiva da equipe Ze Tech para gerenciar clientes, planos, cobranças e relatórios de assinatura.",
      },
      { property: "og:title", content: "Acesso Ze Tech — área do fabricante" },
      {
        property: "og:description",
        content: "Área restrita da Ze Tech: clientes assinantes, planos e cobranças.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginZeTech,
});

function LoginZeTech() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const entrar = useMutation({
    mutationFn: async () => {
      if (!email.trim() || !senha) throw new Error("Informe o e-mail e a senha.");
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });
      if (error) throw new Error("E-mail ou senha incorretos.");

      // só entra quem é da equipe Ze Tech
      const { data: operador, error: erroOperador } = await supabase.rpc("eh_saas_operador");
      if (erroOperador) throw erroOperador;
      if (!operador) {
        await supabase.auth.signOut();
        throw new Error("Esta conta não tem acesso à área da Ze Tech.");
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Bem-vindo à área da Ze Tech.");
      void navigate({ to: "/ze-tech" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <ZeLogo className="size-14" />
          <div>
            <h1 className="text-xl font-semibold">Área da Ze Tech</h1>
            <p className="text-sm text-muted-foreground">
              Acesso exclusivo do fabricante para clientes, planos e cobranças.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" /> Entrar na área restrita
            </CardTitle>
            <CardDescription>
              Use a conta da equipe Ze Tech, separada da conta da loja.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                entrar.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="z-email">E-mail</Label>
                <Input
                  id="z-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="z-senha">Senha</Label>
                <Input
                  id="z-senha"
                  type="password"
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={entrar.isPending}>
                {entrar.isPending ? "Entrando…" : "Entrar na área Ze Tech"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          É lojista?{" "}
          <Link to="/auth" className="underline">
            entre no sistema da sua loja
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
