import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  HardHat,
  LayoutGrid,
  Receipt,
  Ruler,
  ShieldCheck,
  Truck,
  Wallet,
  Warehouse,
} from "lucide-react";

import { ZeLogo } from "@/components/app/ZeLogo";
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
    title: "Clientes, obras e crédito",
    text: "Pessoa física e jurídica, limite de crédito com autorização do gestor e obras por cliente.",
  },
  {
    icon: Ruler,
    title: "Orçamento vira pedido",
    text: "Orçamento no balcão, aprovação, pedido com reserva de estoque, separação e conferência.",
  },
  {
    icon: Boxes,
    title: "Estoque e custo por depósito",
    text: "Físico, reservado e disponível, custo médio de cada depósito e histórico que nunca se apaga.",
  },
  {
    icon: Warehouse,
    title: "Compras do início ao fim",
    text: "Sugestão pelo estoque mínimo, cotação comparada, recebimento com divergência e conta a pagar.",
  },
  {
    icon: Truck,
    title: "Entregas e rota do dia",
    text: "Roteirização automática por urgência e capacidade, tela do motorista com foto e assinatura.",
  },
  {
    icon: Wallet,
    title: "Financeiro completo",
    text: "Contas a receber e a pagar, caixa com sangria e fechamento, fluxo de caixa e alertas.",
  },
  {
    icon: Receipt,
    title: "Fiscal e NF-e",
    text: "NCM, CFOP e CST por produto, nota do pedido ou agrupada e balanço fiscal com ICMS.",
  },
  {
    icon: BarChart3,
    title: "Painel e relatórios",
    text: "Pedidos em andamento, pendências fiscais, lucro por produto, depósito e mês.",
  },
  {
    icon: ShieldCheck,
    title: "Multiempresa e permissões",
    text: "Empresas, filiais e depósitos com nove perfis, permissões por módulo e auditoria.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
        <div className="flex items-center gap-2">
          <ZeLogo />
          <span className="font-display text-base font-bold tracking-wide">ZE OBRA</span>
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-8 sm:py-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium">
          <LayoutGrid className="size-3.5" /> Comercial, estoque, compras, logística, financeiro e
          fiscal
        </span>
        <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
          A gestão completa da sua loja de <span className="text-accent">material de construção</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
          Do orçamento no balcão à entrega na obra, com estoque reservado, custo por depósito,
          cobrança, caixa e nota fiscal. Simples para o atendente, completo para o gestor.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">
              Acessar demonstração <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
        <dl className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-4">
          {[
            { k: "Fluxo completo", v: "Orçamento → pedido → entrega → financeiro" },
            { k: "Depósitos", v: "Estoque e custo médio separados" },
            { k: "Logística", v: "Rota do dia e tela do motorista" },
            { k: "Fiscal", v: "NCM, CFOP, NF-e e balanço" },
          ].map((i) => (
            <div key={i.k} className="panel p-4 text-left">
              <dt className="font-display text-sm font-semibold">{i.k}</dt>
              <dd className="mt-1 text-xs text-muted-foreground">{i.v}</dd>
            </div>
          ))}
        </dl>
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
        Ze Obra, um produto Ze Tech • Multiempresa, multifilial e multidepósito
      </footer>
    </div>
  );
}
