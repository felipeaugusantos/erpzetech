import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bike,
  Boxes,
  Building2,
  Check,
  ClipboardList,
  Factory,
  Hammer,
  MessageCircle,
  PawPrint,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  UtensilsCrossed,
  Wallet,
  WifiOff,
  Wrench,
} from "lucide-react";

import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";

const WHATSAPP =
  "https://wa.me/5516988547561?text=Ol%C3%A1!%20Quero%20conhecer%20as%20fun%C3%A7%C3%B5es%20do%20EZRA%20ERP";

export const Route = createFileRoute("/funcionalidades")({
  head: () => ({
    meta: [
      { title: "Funcionalidades do EZRA ERP — tudo o que o sistema faz" },
      {
        name: "description",
        content:
          "Conheça todas as funções do EZRA ERP: PDV, estoque por grade, compras com XML e CT-e, financeiro, NF-e, OS, locação, delivery, personalização e mais.",
      },
      { property: "og:title", content: "Todas as funções do EZRA ERP" },
      {
        property: "og:description",
        content:
          "Vendas, estoque, compras, financeiro, fiscal e módulos por ramo em um só sistema.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Funcionalidades,
});

type Grupo = { icon: typeof Store; titulo: string; resumo: string; itens: string[] };

const essenciais: Grupo[] = [
  {
    icon: Store,
    titulo: "Frente de caixa (PDV)",
    resumo: "Venda rápida no balcão, mesmo sem internet.",
    itens: [
      "Busca por código, código de barras ou descrição",
      "Vendas em espera e limite de desconto por perfil",
      "Abertura, sangria, suprimento e fechamento de caixa",
      "TEF manual, PIX, cartão, dinheiro e crediário",
      "Funciona sem internet e envia tudo ao reconectar",
      "Cupom 80 mm e NFC-e",
    ],
  },
  {
    icon: ClipboardList,
    titulo: "Pedidos e orçamentos",
    resumo: "Do orçamento à entrega, com controle de cada etapa.",
    itens: [
      "Orçamentos convertidos em pedido",
      "Pedido em rascunho sem reservar estoque",
      "Alteração e cancelamento com regras de segurança",
      "Separação, conferência e entrega",
      "Impressão em A4, meia folha ou 80 mm",
      "Grade rápida por tamanho",
    ],
  },
  {
    icon: Boxes,
    titulo: "Estoque",
    resumo: "Saldo confiável, sem estoque negativo.",
    itens: [
      "Vários depósitos com custo médio ponderado",
      "Saldo e inventário por tamanho (grade)",
      "Movimento por tamanho com histórico",
      "Lotes, reservas e transferências",
      "Código interno automático e código de barras gerado",
      "Conversão de unidade de compra para unidade de estoque",
    ],
  },
  {
    icon: ShoppingCart,
    titulo: "Compras e entrada de notas",
    resumo: "Importe a nota e o custo real é calculado sozinho.",
    itens: [
      "Pedido de compra com aprovação, alteração e cancelamento",
      "Importação de NF-e por XML ou DANFE em PDF",
      "Impostos guardados por item (ICMS, CST, CFOP, IPI, PIS, COFINS)",
      "Conferência física separada do documento fiscal",
      "CT-e de frete por XML ou PDF, com vários CT-e no mesmo arquivo",
      "Rateio de frete, desconto, ST e IPI no custo dos produtos",
    ],
  },
  {
    icon: Wallet,
    titulo: "Financeiro",
    resumo: "Contas em dia e visão clara do caixa.",
    itens: [
      "Contas a pagar e a receber com parcelas",
      "Crediário: compras marcadas e fechamento mensal por cliente",
      "Limite de crédito e saldo vencido",
      "Conta separada para transportadora do frete",
      "Painel com total a receber, recebido e vencido",
    ],
  },
  {
    icon: Receipt,
    titulo: "Fiscal",
    resumo: "Notas emitidas com os dados certos da empresa.",
    itens: [
      "NF-e, NFC-e e NFS-e",
      "Impostos configurados por empresa e por nota",
      "Balanço fiscal e devoluções",
      "Empresa com CNPJ ou começando por CPF",
    ],
  },
  {
    icon: BarChart3,
    titulo: "Relatórios",
    resumo: "Decida com números, não com palpite.",
    itens: [
      "Lucro e margem por produto, depósito e mês",
      "Margem editável com preço de venda automático",
      "Painel do dia com vendas e recebimentos",
      "Tempo real por cliente para a equipe EZRA",
    ],
  },
  {
    icon: ShieldCheck,
    titulo: "Segurança e gestão",
    resumo: "Cada pessoa vê só o que precisa.",
    itens: [
      "Várias empresas e filiais separadas",
      "Usuários com perfis: administrador, gestor, caixa, vendedor e outros",
      "Auditoria das operações importantes",
      "Login personalizado com o link da sua empresa",
      "Zerar dados de teste para começar do zero",
    ],
  },
];

const modulos: Grupo[] = [
  {
    icon: Hammer,
    titulo: "Materiais de construção",
    resumo: "Para lojas de material.",
    itens: ["Obras por cliente", "Histórico da obra", "Venda fracionada (m³, metro, rolo)"],
  },
  {
    icon: Wrench,
    titulo: "Assistência técnica",
    resumo: "Ordens de serviço completas.",
    itens: ["OS por loja e técnico", "Baixa de peças no estoque", "Impressão da OS"],
  },
  {
    icon: Truck,
    titulo: "Locação de equipamentos",
    resumo: "Controle do que saiu e voltou.",
    itens: ["Contratos de locação", "Devolução e cobrança", "NFS-e por item"],
  },
  {
    icon: UtensilsCrossed,
    titulo: "Restaurante e delivery",
    resumo: "Salão, cardápio e entrega.",
    itens: ["Comandas no salão", "Cardápio digital", "Delivery com motoristas e iFood"],
  },
  {
    icon: Factory,
    titulo: "Personalização e produção",
    resumo: "Para quem fabrica sob encomenda.",
    itens: [
      "Arte aprovada e grade por tamanho",
      "Etapas de impressão, prensa e montagem",
      "Custo real por peça, visível só para a equipe",
    ],
  },
  {
    icon: PawPrint,
    titulo: "Pet shop e veterinária",
    resumo: "Atendimento e agenda.",
    itens: ["Banho e tosa", "Profissionais com acesso próprio", "Prontuário e documentos"],
  },
];

function Cartao({ g }: { g: Grupo }) {
  return (
    <div className="panel flex flex-col p-6">
      <span className="grid size-10 place-items-center rounded-md bg-mint/15 text-accent-foreground">
        <g.icon className="size-5" />
      </span>
      <h3 className="mt-4 font-display text-lg font-bold">{g.titulo}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{g.resumo}</p>
      <ul className="mt-4 space-y-2 text-sm">
        {g.itens.map((i) => (
          <li key={i} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Funcionalidades() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <ZeLogo />
          <span className="whitespace-nowrap font-display text-sm font-bold tracking-wide sm:text-base">
            EZRA ERP
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/">Início</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/auth">Entrar</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-5 py-16 text-center sm:px-8 sm:py-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium">
          <Building2 className="size-3.5 text-brand" /> Um sistema, todos os setores da empresa
        </span>
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
          Tudo o que o <span className="text-brand">EZRA ERP</span> faz por você
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-muted-foreground">
          Vendas, estoque, compras, financeiro e fiscal para qualquer empresa — mais módulos
          especiais que aparecem conforme o seu ramo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 size-4" /> Testar 15 dias
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#modulos">
              Ver módulos por ramo <ArrowRight className="ml-2 size-4" />
            </a>
          </Button>
        </div>
        <div className="mt-10 grid gap-3 text-left sm:grid-cols-3">
          {[
            { icon: WifiOff, t: "Vende sem internet" },
            { icon: Bike, t: "Delivery e iFood" },
            { icon: Receipt, t: "Notas fiscais integradas" },
          ].map((d) => (
            <div
              key={d.t}
              className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-4"
            >
              <d.icon className="size-5 text-brand" />
              <span className="font-display text-sm font-semibold">{d.t}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <h2 className="font-display text-3xl font-extrabold">Para toda empresa</h2>
          <p className="mt-2 text-muted-foreground">Incluído em todos os planos.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {essenciais.map((g) => (
              <Cartao key={g.titulo} g={g} />
            ))}
          </div>
        </div>
      </section>

      <section id="modulos" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <h2 className="font-display text-3xl font-extrabold">Módulos por ramo</h2>
          <p className="mt-2 text-muted-foreground">
            Liberados conforme a atividade da empresa — o menu mostra só o que você usa.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {modulos.map((g) => (
              <Cartao key={g.titulo} g={g} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-primary text-primary-foreground">
        <div className="mx-auto max-w-4xl px-5 py-14 text-center sm:px-8">
          <h2 className="font-display text-3xl font-extrabold">
            Pronto para organizar sua empresa?
          </h2>
          <p className="mt-3 opacity-90">Fale com a gente no WhatsApp (16) 98854-7561.</p>
          <Button asChild size="lg" variant="secondary" className="mt-6">
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 size-4" /> Chamar no WhatsApp
            </a>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground sm:px-8">
        Desenvolvido por EZRA
      </footer>
    </div>
  );
}
