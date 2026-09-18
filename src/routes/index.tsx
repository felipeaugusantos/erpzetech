import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  HardHat,
  LayoutGrid,
  Ruler,
  ShieldCheck,
  Truck,
  Warehouse,
} from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ze Obra — ERP para lojas de materiais de construção" },
      {
        name: "description",
        content:
          "Ze Obra controla clientes, obras, produtos, conversão de unidades e estoque em múltiplos depósitos e filiais.",
      },
      { property: "og:title", content: "Ze Obra — ERP para materiais de construção" },
      {
        property: "og:description",
        content: "Do balcão ao depósito: clientes, obras, produtos e estoque em um só sistema.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: HardHat,
    title: "Clientes e obras",
    text: "Pessoa física e jurídica, limite de crédito, prazo e obras vinculadas a cada cliente.",
  },
  {
    icon: Ruler,
    title: "Conversão de unidades",
    text: "Compre em rolo, palete ou caixa e venda em metro, saco ou m² sem erro de saldo.",
  },
  {
    icon: Boxes,
    title: "Estoque real",
    text: "Físico, reservado e disponível por produto, com histórico permanente de movimentações.",
  },
  {
    icon: Warehouse,
    title: "Múltiplos depósitos",
    text: "Loja, depósito principal e externo com transferências entre depósitos e filiais.",
  },
  {
    icon: ShieldCheck,
    title: "Perfis e permissões",
    text: "Nove perfis operacionais e permissões configuráveis por módulo.",
  },
  {
    icon: Truck,
    title: "Pronto para crescer",
    text: "Estrutura multiempresa preparada para orçamentos, pedidos, entregas e financeiro.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            EB
          </span>
          <span className="font-display text-base font-bold tracking-wide">ENZOVA BUILD</span>
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-8 sm:py-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium">
          <LayoutGrid className="size-3.5" /> Fase 1 disponível
        </span>
        <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
          A gestão completa da sua loja de <span className="text-accent">material de construção</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
          Cadastros, estoque com reserva, múltiplos depósitos e filiais em um ERP feito para o ritmo
          do balcão. Simples para o atendente, completo para o gestor.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">
              Acessar demonstração <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-16 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="panel p-5">
              <span className="grid size-9 place-items-center rounded-md bg-accent/15 text-accent-foreground">
                <f.icon className="size-4.5" />
              </span>
              <h3 className="mt-3 font-display text-base font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground sm:px-8">
        Ze Obra • Multiempresa, multifilial e multidepósito
      </footer>
    </div>
  );
}
