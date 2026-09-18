import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Mail, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Contatos da loja — troque pelos seus dados reais. */
export const CONTATO = {
  email: "contato@zeregistra.com.br",
  whatsapp: "5516997994239",
  whatsappVisivel: "(16) 99799-4239",
};

export const Route = createFileRoute("/contato")({
  head: () => ({
    meta: [
      { title: "Falar com o ERP Ze Tech — planos e demonstração" },
      {
        name: "description",
        content:
          "Fale com a equipe do ERP Ze Tech por e-mail ou WhatsApp e escolha o plano ideal para a sua loja de material de construção.",
      },
      { property: "og:title", content: "Falar com o ERP Ze Tech — planos e demonstração" },
      {
        property: "og:description",
        content: "E-mail, WhatsApp e formulário para conhecer os planos Balcão, Loja e Rede.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Contato,
});

function Contato() {
  const [form, setForm] = useState({
    nome: "",
    email: "",
    whatsapp: "",
    plano_interesse: "loja",
    mensagem: "",
  });
  const [enviado, setEnviado] = useState(false);

  const enviar = useMutation({
    mutationFn: async () => {
      if (form.nome.trim().length < 2) throw new Error("Informe o seu nome");
      if (!form.email.trim() && !form.whatsapp.trim())
        throw new Error("Informe e-mail ou WhatsApp para eu responder");
      const { error } = await supabase.from("contatos").insert({
        nome: form.nome.trim(),
        email: form.email.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        plano_interesse: form.plano_interesse,
        mensagem: form.mensagem.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEnviado(true);
      toast.success("Recebemos o seu contato");
    },
    onError: (e: Error) => toast.error("Não foi possível enviar", { description: e.message }),
  });

  const textoWhats = encodeURIComponent(
    `Olá! Quero conhecer o ERP Ze Tech (plano ${form.plano_interesse}).`,
  );

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <ZeLogo />
          <span className="font-display text-base font-bold tracking-wide">ERP ZE TECH</span>
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-2 size-4" /> Ver planos
          </Link>
        </Button>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Fale com a gente</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Conte o tamanho da sua loja e respondemos com o plano ideal, o prazo de implantação e o
          teste de 15 dias nos planos Loja e Rede.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            <a
              href={`https://wa.me/${CONTATO.whatsapp}?text=${textoWhats}`}
              target="_blank"
              rel="noreferrer"
              className="panel flex items-center gap-3 p-5 transition-colors hover:border-accent"
            >
              <span className="grid size-10 place-items-center rounded-md bg-accent/15 text-accent-foreground">
                <MessageCircle className="size-5" />
              </span>
              <div>
                <p className="font-display text-sm font-semibold">WhatsApp</p>
                <p className="text-sm text-muted-foreground">{CONTATO.whatsappVisivel}</p>
              </div>
            </a>

            <a
              href={`mailto:${CONTATO.email}?subject=Planos ERP Ze Tech`}
              className="panel flex items-center gap-3 p-5 transition-colors hover:border-accent"
            >
              <span className="grid size-10 place-items-center rounded-md bg-secondary">
                <Mail className="size-5" />
              </span>
              <div>
                <p className="font-display text-sm font-semibold">E-mail</p>
                <p className="text-sm text-muted-foreground">{CONTATO.email}</p>
              </div>
            </a>

            <div className="panel p-5">
              <p className="flex items-center gap-2 font-display text-sm font-semibold">
                <Phone className="size-4" /> Atendimento
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Segunda a sexta, 8h às 18h. Respondemos os contatos do formulário no mesmo dia útil.
              </p>
            </div>
          </div>

          <div className="panel p-6">
            {enviado ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-success/15 text-success">
                  <Check className="size-5" />
                </span>
                <p className="font-display text-base font-semibold">Contato enviado!</p>
                <p className="text-sm text-muted-foreground">
                  Vamos responder pelo canal que você informou. Se preferir, chame no WhatsApp agora.
                </p>
                <Button asChild>
                  <a
                    href={`https://wa.me/${CONTATO.whatsapp}?text=${textoWhats}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Chamar no WhatsApp
                  </a>
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  enviar.mutate();
                }}
              >
                <div>
                  <Label htmlFor="nome">Nome ou nome da loja</Label>
                  <Input
                    id="nome"
                    className="mt-1"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      className="mt-1"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="whatsapp">WhatsApp</Label>
                    <Input
                      id="whatsapp"
                      inputMode="tel"
                      className="mt-1"
                      value={form.whatsapp}
                      onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Plano de interesse</Label>
                  <Select
                    value={form.plano_interesse}
                    onValueChange={(v) => setForm({ ...form, plano_interesse: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="balcao">Balcão — R$ 149/mês</SelectItem>
                      <SelectItem value="loja">Loja — R$ 299/mês</SelectItem>
                      <SelectItem value="rede">Rede — R$ 599/mês</SelectItem>
                      <SelectItem value="nao_sei">Ainda não sei</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="mensagem">Mensagem</Label>
                  <Textarea
                    id="mensagem"
                    className="mt-1"
                    rows={4}
                    placeholder="Quantas lojas, depósitos e usuários você tem?"
                    value={form.mensagem}
                    onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={enviar.isPending}>
                  {enviar.isPending ? "Enviando…" : "Enviar contato"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground sm:px-8">
        ERP Ze Tech, um produto Ze Tech
      </footer>
    </div>
  );
}
