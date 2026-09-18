import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  HardHat,
  LayoutGrid,
  Receipt,
  Ruler,
  ScanBarcode,

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
      { title: "ERP Ze Tech — gestão completa para comércio de materiais e varejo" },
      {
        name: "description",
        content:
          "ERP Ze Tech: clientes, produtos, estoque por depósito, orçamento, pedido, compras, entregas, caixa, financeiro, NF-e e PDV em um só sistema.",
      },
      { property: "og:title", content: "ERP Ze Tech — gestão completa da sua loja" },
      {
        property: "og:description",
        content:
          "Do orçamento no balcão à entrega e ao financeiro, com estoque por depósito, PDV, NF-e e relatórios.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
    icon: ScanBarcode,
    title: "PDV de venda rápida",
    text: "Leitor de código de barras, troco na tela, cupom de 80 mm, baixa de estoque e caixa.",
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

const planos = [
  {
    nome: "Balcão",
    preco: "R$ 149",
    resumo: "1 loja, 1 depósito, 5 usuários",
    destaque: false,
    teste: false,
    itens: [
      "Clientes e obras",
      "Produtos e categorias",
      "Estoque com reserva",
      "Orçamento no balcão",
      "Pedidos",
    ],
  },
  {
    nome: "Loja",
    preco: "R$ 299",
    resumo: "1 loja, depósitos ilimitados, 15 usuários",
    destaque: true,
    teste: true,
    itens: [
      "Tudo do Balcão",
      "Compras com cotação",
      "Separação e conferência",
      "Entregas",
      "Financeiro completo",
      "NF-e",
    ],
  },
  {
    nome: "Rede",
    preco: "R$ 599",
    resumo: "Multiempresa e filiais, usuários ilimitados",
    destaque: false,
    teste: true,
    itens: [
      "Tudo do Loja",
      "Roteirização automática",
      "Tela do motorista",
      "Custo por depósito",
      "Balanço fiscal",
      "Relatórios gerenciais",
    ],
  },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
        <div className="flex items-center gap-2">
          <ZeLogo />
          <span className="font-display text-base font-bold tracking-wide">ERP ZE TECH</span>

        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href="#planos">Planos</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/contato">Contato</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/auth">Entrar</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-8 sm:py-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium">
          <LayoutGrid className="size-3.5" /> PDV, comercial, estoque, compras, logística,
          financeiro e fiscal
        </span>
        <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
          O <span className="text-accent">ERP Ze Tech</span> para quem vende produto e controla
          estoque
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
          Da venda no balcão à entrega e ao financeiro, com estoque por depósito, custo de aquisição
          real, caixa, nota fiscal e relatórios. Nasceu nas lojas de material de construção e atende
          também autopeças, agro, elétrica, hidráulica, distribuidoras e papelaria.
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

      <section id="planos" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-extrabold">Planos</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
              Escolha pelo tamanho da operação. Sem taxa por nota emitida e sem limite de produtos.
              Teste grátis de 15 dias nos planos Loja e Rede.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {planos.map((p) => (
              <div
                key={p.nome}
                className={
                  p.destaque
                    ? "panel relative border-2 border-accent p-6 shadow-lg"
                    : "panel p-6"
                }
              >
                {p.destaque && (
                  <span className="absolute -top-3 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent-foreground">
                    Mais escolhido
                  </span>
                )}
                <h3 className="font-display text-xl font-bold">{p.nome}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{p.resumo}</p>
                <p className="mt-4 font-display text-3xl font-extrabold">
                  {p.preco}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">/mês</span>
                </p>
                {p.teste && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] font-semibold">
                    <Check className="size-3" /> 15 dias grátis
                  </p>
                )}
                <ul className="mt-5 space-y-2">
                  {p.itens.map((i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                      {i}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className="mt-6 w-full"
                  variant={p.destaque ? "default" : "outline"}
                >
                  <Link to="/auth">{p.teste ? "Testar 15 dias" : "Começar agora"}</Link>
                </Button>
              </div>
            ))}
          </div>

          <div className="panel mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="font-display text-sm font-semibold">Filial extra</p>
              <p className="text-xs text-muted-foreground">
                Para cada loja adicional no plano Rede
              </p>
            </div>
            <p className="font-display text-lg font-bold">
              R$ 390<span className="text-xs font-medium text-muted-foreground">/mês</span>
            </p>
            <div className="hidden h-8 w-px bg-border sm:block" />
            <div>
              <p className="font-display text-sm font-semibold">Implantação</p>
              <p className="text-xs text-muted-foreground">
                Cadastro inicial, importação de produtos e treinamento
              </p>
            </div>
            <p className="font-display text-lg font-bold">R$ 1.500</p>
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">
              Ficou em dúvida de qual plano atende a sua loja?
            </p>
            <Button asChild size="lg" className="mt-3">
              <Link to="/contato">
                Falar com a gente <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground sm:px-8">
        ERP Ze Tech • Multiempresa, multifilial e multidepósito
      </footer>
    </div>
  );
}
