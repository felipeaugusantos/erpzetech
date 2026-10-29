import { useEffect, useState } from "react";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { entrarComUsuarioOuEmail } from "@/lib/login-cliente";
import { lovable } from "@/integrations/lovable/index";
import { ZeLogo } from "@/components/app/ZeLogo";
import { aplicarCorEmpresa } from "@/components/app/MarcaEmpresa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buscarMarcaLogin } from "@/lib/marca-login.functions";
import { guardarLinkDeEntrada } from "@/lib/link-uso";

export const Route = createFileRoute("/$empresa")({
  loader: async ({ params }) => {
    const marca = await buscarMarcaLogin({ data: { slug: params.empresa } });
    if (!marca) throw notFound();
    return marca;
  },
  head: ({ loaderData }) => {
    const nome = loaderData?.nome;
    const titulo = nome ? `Entrar — ${nome}` : "Empresa não encontrada — EZRA ERP";
    const desc = nome
      ? `Acesso dos colaboradores de ${nome} ao EZRA ERP.`
      : "Link de acesso não encontrado.";
    return {
      meta: [
        { title: titulo },
        { name: "description", content: desc },
        { property: "og:title", content: titulo },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  notFoundComponent: NaoEncontrada,
  component: LoginEmpresa,
});

function NaoEncontrada() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <ZeLogo className="mx-auto size-12" />
        <h1 className="mt-4 font-display text-2xl font-bold">Empresa não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confira o endereço com o administrador da sua loja.
        </p>
        <Button asChild className="mt-6">
          <Link to="/auth">Ir para o login do EZRA ERP</Link>
        </Button>
      </div>
    </div>
  );
}

function LoginEmpresa() {
  const marca = Route.useLoaderData();
  const params = Route.useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  useEffect(() => {
    aplicarCorEmpresa(marca.cor);
  }, [marca.cor]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setLoading("login");
    try {
      await entrarComUsuarioOuEmail(email, senha, params.empresa);
    } catch (erro) {
      setLoading(null);
      toast.error("Não foi possível entrar", { description: (erro as Error).message });
      return;
    }
    setLoading(null);
    guardarLinkDeEntrada(params.empresa);
    navigate({ to: "/dashboard" });
  }

  async function google() {
    setLoading("google");
    guardarLinkDeEntrada(params.empresa);
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

  const logo = marca.logoUrl ? (
    <img src={marca.logoUrl} alt={marca.nome} className="max-h-24 max-w-[220px] object-contain" />
  ) : (
    <ZeLogo className="size-16" />
  );

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="rounded-lg bg-background/95 p-4 self-start">{logo}</div>
        <div className="max-w-md">
          <p className="text-sm uppercase tracking-wider text-sidebar-foreground/70">
            Portal do colaborador
          </p>
          <h2 className="mt-2 font-display text-4xl font-bold leading-tight">{marca.nome}</h2>
        </div>
        <p className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <ZeLogo className="size-5" /> EZRA ERP · Desenvolvido por EZRA
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">{logo}</div>
          <h1 className="font-display text-2xl font-bold">Entrar — {marca.nome}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use o e-mail e a senha que o administrador da loja criou para você.
          </p>

          <form onSubmit={entrar} className="mt-6 space-y-3">
            <div>
              <Label htmlFor="email">Usuário ou e-mail</Label>
              <Input
                id="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
          <p className="mt-6 text-center text-xs text-muted-foreground lg:hidden">
            Desenvolvido por EZRA
          </p>
        </div>
      </div>
    </div>
  );
}
