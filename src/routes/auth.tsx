import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { HardHat, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Ze Obra" },
      {
        name: "description",
        content: "Acesse o Ze Obra para gerenciar clientes, produtos e estoque da sua loja.",
      },
      { property: "og:title", content: "Entrar no Ze Obra" },
      { property: "og:description", content: "Acesso ao ERP da sua loja de materiais." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setLoading("login");
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(null);
    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function criarConta(e: React.FormEvent) {
    e.preventDefault();
    setLoading("signup");
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: { emailRedirectTo: window.location.origin, data: { nome } },
    });
    setLoading(null);
    if (error) {
      toast.error("Não foi possível criar a conta", { description: error.message });
      return;
    }
    if (!data.session) {
      toast.success("Confirme seu e-mail", {
        description: "Enviamos um link de confirmação para concluir o cadastro.",
      });
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function google() {
    setLoading("google");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(null);
      toast.error("Falha no acesso com Google");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-md bg-sidebar-primary font-display font-bold text-sidebar-primary-foreground">
            EB
          </span>
          <span className="font-display text-lg font-bold tracking-wide">ENZOVA BUILD</span>
        </Link>
        <div className="max-w-md">
          <HardHat className="mb-4 size-9 text-sidebar-primary" />
          <h2 className="font-display text-3xl font-bold leading-tight">
            A operação da sua loja de materiais, do balcão ao depósito.
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70">
            Clientes e obras, produtos com conversão de unidades, estoque físico, reservado e
            disponível em múltiplos depósitos — em um único sistema.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Multiempresa • Multifilial • Multidepósito</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <span className="grid size-10 place-items-center rounded-md bg-primary font-display font-bold text-primary-foreground">
              EB
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold">Acessar o sistema</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use seu e-mail corporativo ou sua conta Google.
          </p>

          <Tabs defaultValue="login" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={entrar} className="space-y-3">
                <div>
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@empresa.com.br"
                  />
                </div>
                <div>
                  <Label htmlFor="senha">Senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    required
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading === "login"}>
                  {loading === "login" && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Entrar
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={criarConta} className="space-y-3">
                <div>
                  <Label htmlFor="nome">Nome completo</Label>
                  <Input
                    id="nome"
                    required
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Seu nome"
                  />
                </div>
                <div>
                  <Label htmlFor="email2">E-mail</Label>
                  <Input
                    id="email2"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="senha2">Senha</Label>
                  <Input
                    id="senha2"
                    type="password"
                    required
                    minLength={6}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading === "signup"}>
                  {loading === "signup" && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Criar conta
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={google} disabled={loading === "google"}>
            {loading === "google" && <Loader2 className="mr-2 size-4 animate-spin" />}
            Continuar com Google
          </Button>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Ao entrar você acessa o ambiente de demonstração Constrular Materiais.
          </p>
        </div>
      </div>
    </div>
  );
}
