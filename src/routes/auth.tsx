import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { entrarComUsuarioOuEmail } from "@/lib/login-cliente";
import { pareceEmail } from "@/lib/usuario-login";
import { lovable } from "@/integrations/lovable/index";
import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Acesse o ERP Ze Tech para gerenciar vendas, estoque, compras, financeiro e notas fiscais da sua empresa.",
      },
      { property: "og:title", content: "Entrar no ERP Ze Tech" },
      {
        property: "og:description",
        content: "Vendas, estoque, compras, financeiro e notas fiscais da sua empresa em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  // quem entra por usuário informa também a empresa (o link dela); quem entra por e-mail não precisa
  const [empresa, setEmpresa] = useState("");
  const [usuarioOuEmail, setUsuarioOuEmail] = useState("");

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setLoading("login");
    try {
      await entrarComUsuarioOuEmail(usuarioOuEmail, senha, empresa);
    } catch (erro) {
      setLoading(null);
      toast.error("Não foi possível entrar", { description: (erro as Error).message });
      return;
    }
    setLoading(null);
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
          <ZeLogo />
          <span className="font-display text-lg font-bold tracking-wide">ERP ZE TECH</span>
        </Link>
        <div className="max-w-md">
          <TrendingUp className="mb-4 size-9 text-sidebar-primary" />
          <h2 className="font-display text-3xl font-bold leading-tight">
            Toda a gestão da sua empresa em um só lugar.
          </h2>
          <p className="mt-4 text-sm text-sidebar-foreground/70">
            Vendas no balcão e PDV, controle de estoque em tempo real, compras com importação de
            notas fiscais, financeiro integrado e emissão fiscal completa.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Multiempresa • Controle por filial • Operação segura
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <ZeLogo className="size-10" />
          </div>
          <h1 className="font-display text-2xl font-bold">Bem-vindo de volta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com seu usuário e código da empresa, ou use seu e-mail cadastrado.
          </p>

          <Tabs defaultValue="login" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={entrar} className="space-y-3">
                <div>
                  <Label htmlFor="usuario">Usuário ou e-mail</Label>
                  <Input
                    id="usuario"
                    required
                    autoComplete="username"
                    value={usuarioOuEmail}
                    onChange={(e) => setUsuarioOuEmail(e.target.value)}
                    placeholder="seu.usuario ou voce@empresa.com.br"
                  />
                </div>
                {usuarioOuEmail.trim() !== "" && !pareceEmail(usuarioOuEmail) && (
                  <div>
                    <Label htmlFor="empresa">Código ou link da sua empresa</Label>
                    <Input
                      id="empresa"
                      required
                      value={empresa}
                      onChange={(e) => setEmpresa(e.target.value)}
                      placeholder="Ex: sua-empresa ou código de acesso"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Peça o link personalizado ou o código de acesso ao administrador da sua loja.
                    </p>
                  </div>
                )}
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

          <Button
            variant="outline"
            className="w-full"
            onClick={google}
            disabled={loading === "google"}
          >
            {loading === "google" && <Loader2 className="mr-2 size-4 animate-spin" />}
            Continuar com Google
          </Button>

          <Link
            to="/ze-tech-login"
            className="mt-3 flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Entrar no Painel Ze Tech (equipe)
          </Link>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Acesso protegido e criptografado • <strong>ERP Ze Tech</strong>
            <br />
            Dúvidas ou problemas de acesso? Fale com o suporte Ze Tech no WhatsApp:{" "}
            <a
              href="https://wa.me/5516988547561"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              (16) 98854-7561
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
