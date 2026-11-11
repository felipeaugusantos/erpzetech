import { useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bike,
  Boxes,
  Check,
  Droplets,
  Hammer,
  MessageCircle,
  PawPrint,
  Receipt,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Store,
  Truck,
  UtensilsCrossed,
  Wallet,
  WifiOff,
  Wrench,
} from "lucide-react";

import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { NOME_DO_PLANO } from "@/lib/planos-nomes";

const WHATSAPP = "https://wa.me/5516988547561?text=Ol%C3%A1!%20Quero%20conhecer%20o%20EZRA%20ERP";
const WHATSAPP_LABEL = "(16) 98854-7561";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EZRA ERP — varejo, serviços, locação e restaurante em um só sistema" },
      {
        name: "description",
        content:
          "EZRA ERP: PDV com IA, estoque por depósito, ordens de serviço, locação, restaurante com iFood, financeiro e NF-e para lojas, MEIs e redes.",
      },
      { property: "og:title", content: "EZRA ERP — o sistema que acompanha o seu ramo" },
      {
        property: "og:description",
        content:
          "Varejo, serviços e MEI, locação de equipamentos e gastronomia. Fale no WhatsApp e teste 15 dias.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const segmentos = [
  {
    id: "varejo",
    icon: Store,
    nome: "Comércio e varejo",
    publicos: [
      "Materiais de construção",
      "Autopeças",
      "Agro",
      "Elétrica",
      "Hidráulica",
      "Distribuidoras",
    ],
    titulo: "Do balcão à entrega, com estoque certo em cada depósito",
    itens: [
      "Orçamento que vira pedido com reserva de estoque",
      "Estoque e custo médio por depósito e filial",
      "Compras com cotação e entrada por XML",
      "Rota do dia e app do motorista",
      "Venda fracionada (m³, metro, caixa)",
    ],
  },
  {
    id: "servicos",
    icon: Wrench,
    nome: "Serviços e MEI",
    publicos: ["Eletricistas", "Ar-condicionado", "Câmeras de segurança", "Assistência técnica"],
    titulo: "Ordem de serviço do chamado ao laudo, direto do celular",
    itens: [
      "Abertura no balcão separada do atendimento técnico",
      "Laudo, garantia e horas trabalhadas",
      "Peças e mão de obra na mesma OS",
      "Custo e comissão por técnico",
      "PDF da OS para enviar ao cliente",
    ],
  },
  {
    id: "pet",
    icon: PawPrint,
    nome: "Pet shop e veterinária",
    publicos: ["Pet shop", "Clínica veterinária"],
    titulo: "Pets, tutores, agenda e cobrança no mesmo sistema",
    itens: [
      "Banho e tosa com agenda por profissional",
      "Cadastro de pets e tutores",
      "Serviços cobrados junto com os produtos no caixa",
      "Comissão do profissional",
      "Prontuário e documentos da clínica",
    ],
  },
  {
    id: "lava",
    icon: Droplets,
    nome: "Lava-rápido",
    publicos: ["Lava-rápido"],
    titulo: "Pátio, veículos e planos mensais no mesmo sistema",
    itens: [
      "Pátio com a situação de cada veículo",
      "Veículos cadastrados por placa ou prefixo",
      "Serviços e preços por tipo de veículo",
      "Planos mensais e programa de fidelidade",
      "Lavadores e comissões",
    ],
  },
  {
    id: "locacao",
    icon: Hammer,
    nome: "Locação",
    publicos: ["Ferramentas", "Andaimes", "Máquinas e equipamentos"],
    titulo: "Controle o que está alugado, o que voltou e o que falta receber",
    itens: [
      "Balcão de locação com vários equipamentos",
      "Período, diárias extras e devolução",
      "Estoque de equipamentos locados e disponíveis",
      "Nota fiscal de serviço da locação",
      "Relatório de locações em PDF",
    ],
  },
  {
    id: "gastronomia",
    icon: UtensilsCrossed,
    nome: "Gastronomia",
    publicos: ["Restaurantes", "Lanchonetes", "Pizzarias", "Delivery"],
    titulo: "Salão, cozinha e delivery conversando em tempo real",
    itens: [
      "Mesas e comandas com divisão de conta",
      "Tela da cozinha com itens prontos",
      "Delivery do pedido à entrega",
      "Integração com iFood",
      "Ficha técnica e custo do prato",
    ],
  },
];

/** "Materiais de construção, autopeças, agro…": a lista dos públicos em uma frase. */
const paraTexto = (publicos: string[]) =>
  publicos.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(", ");

const destaques = [
  {
    icon: Sparkles,
    title: "Busca com IA no caixa",
    text: "O operador descreve o que o cliente procura e o sistema sugere os produtos.",
  },
  {
    icon: ScanBarcode,
    title: "Frente de caixa rápida",
    text: "Tela cheia, atalhos de teclado, leitor de código e cupom de 80 mm.",
  },
  {
    icon: WifiOff,
    title: "Vende sem internet",
    text: "As vendas ficam guardadas e são enviadas quando a conexão volta.",
  },
  {
    icon: Bike,
    title: "iFood e delivery",
    text: "Pedidos do iFood entram no sistema e seguem para a cozinha.",
  },
  {
    icon: Receipt,
    title: "NF-e e NFS-e",
    text: "Impostos por filial, simulação de nota e download em PDF e XML.",
  },
  {
    icon: Wallet,
    title: "Financeiro completo",
    text: "Contas a pagar e receber, caixa por operador, maquininha e fluxo de caixa.",
  },
  {
    icon: Truck,
    title: "Logística",
    text: "Roteirização automática e app do motorista com foto e assinatura.",
  },
  {
    icon: ShieldCheck,
    title: "Liberado pelo CNAE",
    text: "Cada empresa vê só os módulos do seu ramo, sem complicação.",
  },
];

/** Grade bento: quais recursos ocupam o dobro de espaço em telas grandes. Só apresentação. */
const destaqueAmplo = new Set([
  "Busca com IA no caixa",
  "Financeiro completo",
  "Logística",
  "Liberado pelo CNAE",
]);

const planos = [
  {
    nome: NOME_DO_PLANO.balcao,
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
    nome: NOME_DO_PLANO.loja,
    preco: "R$ 299",
    resumo: "1 loja, depósitos ilimitados, 15 usuários",
    destaque: true,
    teste: true,
    itens: [
      `Tudo do ${NOME_DO_PLANO.balcao}`,
      "Compras com cotação",
      "Separação e conferência",
      "Entregas",
      "Financeiro completo",
      "NF-e",
    ],
  },
  {
    nome: NOME_DO_PLANO.rede,
    preco: "R$ 599",
    resumo: "Inclui 2 empresas, cada uma com 1 filial. Usuários ilimitados.",
    destaque: false,
    teste: true,
    itens: [
      `Tudo do ${NOME_DO_PLANO.loja}`,
      "Roteirização automática",
      "Tela do motorista",
      "Custo por depósito",
      "Balanço fiscal",
      "Relatórios gerenciais",
    ],
  },
];

/**
 * Módulos setoriais incluídos na mensalidade do plano escolhido. Só recursos que existem hoje; a distribuição por plano ainda não
 * é aplicada pelo sistema, então ela não aparece aqui. A taxa inicial de cada módulo fica em `taxasIniciais`.
 */
const solucoesSetoriais = [
  {
    icon: PawPrint,
    nome: "Pet shop",
    itens: [
      "Agenda por profissional",
      "Cadastro de pets e tutores",
      "Serviços e preços",
      "Profissionais e contatos",
      "Pacotes de serviços",
      "Comissões do profissional",
    ],
  },
  {
    icon: Stethoscope,
    nome: "Clínica veterinária",
    itens: [
      "Prontuário do paciente",
      "Exames e modelos de exame",
      "Catálogo de vacinas e reforços",
      "Consulta aberta a partir da agenda, com pet e tutor cadastrados",
    ],
  },
  {
    icon: Droplets,
    nome: "Lava-rápido",
    itens: [
      "Pátio com a situação de cada veículo",
      "Veículos e clientes",
      "Serviços e preços",
      "Lavadores e comissões",
      "Insumos",
      "Planos de serviços, fidelidade e brindes",
    ],
  },
];

/** Expansão do plano Empresarial. A primeira filial de uma empresa adicional já está na mensalidade da empresa. */
const expansao = [
  {
    titulo: "Empresa adicional, incluindo a primeira filial",
    implantacao: "R$ 599",
    mensalidade: "R$ 149",
    unidade: "/mês",
  },
  {
    titulo: "Demais filiais",
    implantacao: "R$ 390",
    mensalidade: "R$ 99",
    unidade: "/mês por filial",
  },
];

function WhatsButton({
  size = "lg",
  className = "",
  dark = false,
}: {
  size?: "sm" | "lg";
  className?: string;
  dark?: boolean;
}) {
  return (
    <Button
      asChild
      size={size}
      variant="outline"
      className={`transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.98] ${
        dark
          ? "border-white/25 bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white"
          : ""
      } ${className}`}
    >
      <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="mr-2 size-4" /> WhatsApp {size === "lg" && WHATSAPP_LABEL}
      </a>
    </Button>
  );
}

function MockupPdv() {
  const itens = [
    { n: "Cimento CP II 50kg", q: "10", v: "R$ 389,00" },
    { n: "Areia média (m³)", q: "0,500", v: "R$ 72,50" },
    { n: "Fio flexível 2,5mm", q: "1 rolo", v: "R$ 219,90" },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-left text-foreground shadow-panel">
      <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-2.5 text-primary-foreground sm:px-5">
        <span className="font-display text-sm font-semibold tracking-tight">
          Frente de caixa • Caixa 1
        </span>
        <span className="text-xs opacity-80">Operador: Ana</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-[1.6fr_1fr]">
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 shrink-0 text-brand" /> "material para assentar piso no
            banheiro"
          </div>
          <ul className="mt-3 divide-y divide-border text-sm">
            {itens.map((i) => (
              <li key={i.n} className="flex justify-between gap-2 py-2.5">
                <span>
                  {i.n} <span className="text-xs text-muted-foreground">× {i.q}</span>
                </span>
                <span className="whitespace-nowrap font-medium text-numeric">{i.v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-3 border-t border-border bg-secondary p-4 sm:border-l sm:border-t-0 sm:p-5">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="whitespace-nowrap font-display text-2xl font-extrabold tracking-tight text-numeric xl:text-3xl">
              R$ 681,40
            </p>
          </div>
          <div className="space-y-1.5 text-xs">
            {["F2 Buscar", "F4 Pagamento", "F8 Remover item"].map((k) => (
              <div key={k} className="rounded border border-border bg-card px-2 py-1 font-medium">
                {k}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cartão com spotlight (21st.dev): o brilho menta acompanha o cursor. Só apresentação. */
function SpotCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`lp-spot ${className}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

function Landing() {
  const [ativo, setAtivo] = useState("varejo");
  const seg = segmentos.find((s) => s.id === ativo) ?? segmentos[0]!;

  return (
    <div className="lp-root min-h-screen bg-[#f6f9f7]">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <ZeLogo />
            <span className="whitespace-nowrap font-display text-sm font-bold tracking-[0.08em] sm:text-base">
              EZRA ERP
            </span>
          </div>
          <nav className="flex items-center gap-1 sm:gap-1.5">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <Link to="/funcionalidades">Funcionalidades</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <a href="#segmentos">Segmentos</a>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <a href="#recursos">Recursos</a>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <a href="#planos">Planos</a>
            </Button>
            <WhatsButton size="sm" className="hidden sm:inline-flex" />
            <Button asChild size="icon" variant="outline" className="sm:hidden">
              <a
                href={WHATSAPP}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Falar no WhatsApp"
              >
                <MessageCircle className="size-4" />
              </a>
            </Button>
            <Button
              asChild
              size="sm"
              className="shadow-sm transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.98]"
            >
              <Link to="/auth">Entrar</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#0a1610] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 lp-grid-dark [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[540px] lp-glow-hero lp-aurora"
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:px-8 sm:pb-20 sm:pt-24">
          <span className="lp-fade inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/10 px-3.5 py-1.5 text-xs font-semibold text-mint">
            <Sparkles className="size-3.5" /> Agora com IA no caixa e integração com iFood
          </span>
          <h1 className="lp-lead mx-auto mt-7 max-w-4xl text-balance font-display text-4xl font-extrabold leading-[1.04] tracking-[-0.035em] min-[400px]:text-5xl sm:text-6xl lg:text-7xl">
            Vendas, estoque e financeiro{" "}
            <span className="text-mint">em&nbsp;um&nbsp;só&nbsp;sistema para o seu negócio</span>
          </h1>
          <p className="lp-support lp-d1 mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-white/65 sm:text-lg">
            Loja, prestador de serviço, locadora ou restaurante: o EZRA ERP reúne caixa, estoque,
            ordens de serviço, locação, delivery, financeiro e nota fiscal. Cada empresa usa só o
            que precisa.
          </p>
          <div className="lp-support lp-d2 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="lp-shine group w-full border-transparent bg-mint font-semibold text-mint-foreground shadow-raised transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out hover:bg-mint/90 active:scale-[0.98] sm:w-auto"
            >
              <Link to="/auth" search={{ aba: "criar" }}>
                Testar 15 dias grátis{" "}
                <ArrowRight className="ml-2 size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <WhatsButton dark className="w-full sm:w-auto" />
          </div>
          <p className="lp-fade lp-d3 mt-6 text-xs text-white/55">
            Sem taxa por nota emitida • Sem limite de produtos • Funciona no celular
          </p>
          <div className="lp-mock lp-d4 relative mx-auto mt-14 max-w-4xl sm:mt-16">
            <div aria-hidden className="pointer-events-none absolute -inset-8 lp-glow lp-aurora" />
            <div className="relative rounded-2xl border border-white/10 bg-white/5 p-2 shadow-raised backdrop-blur-sm">
              <div aria-hidden className="flex items-center gap-1.5 px-3 pb-2 pt-1.5">
                <span className="size-2.5 rounded-full bg-white/20" />
                <span className="size-2.5 rounded-full bg-white/20" />
                <span className="size-2.5 rounded-full bg-mint/70" />
              </div>
              <MockupPdv />
            </div>
          </div>
        </div>
      </section>

      <section id="segmentos" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="text-balance font-display text-3xl font-extrabold tracking-[-0.025em] sm:text-5xl">
              Feito para o seu negócio
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Escolha o seu ramo e veja o que o sistema faz por você.
            </p>
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[300px_1fr] lg:gap-10">
            <div className="flex snap-x gap-3 overflow-x-auto pb-2 lg:snap-none lg:flex-col lg:overflow-visible lg:pb-0">
              {segmentos.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={ativo === s.id}
                  onClick={() => setAtivo(s.id)}
                  className={`relative flex min-w-60 snap-start flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.99] lg:min-w-0 ${
                    ativo === s.id
                      ? "border-[#0a1610] bg-[#0a1610] text-white shadow-raised"
                      : "border-border bg-card hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-panel"
                  }`}
                >
                  {ativo === s.id && (
                    <span
                      aria-hidden
                      className="absolute inset-y-3 left-0 w-1 rounded-full bg-mint"
                    />
                  )}
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <s.icon
                      className={`size-4 shrink-0 ${ativo === s.id ? "text-mint" : "text-brand"}`}
                    />
                    {s.nome}
                  </span>
                  {!(s.publicos.length === 1 && s.publicos[0] === s.nome) && (
                    <span className="flex flex-wrap gap-1.5">
                      {s.publicos.map((p) => (
                        <span
                          key={p}
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            ativo === s.id
                              ? "border-white/25 text-white/75"
                              : "border-border bg-secondary text-muted-foreground"
                          }`}
                        >
                          {p}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div
              key={seg.id}
              className="lp-swap panel grid content-start gap-8 rounded-3xl p-6 sm:p-10 md:grid-cols-[1.1fr_1fr] md:gap-10"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
                  {seg.nome}
                </p>
                <h3 className="mt-3 font-display text-2xl font-bold leading-snug tracking-[-0.015em] sm:text-3xl">
                  {seg.titulo}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Para: {paraTexto(seg.publicos)}.
                </p>
                <Button
                  asChild
                  className="group mt-7 shadow-sm transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.98]"
                >
                  <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
                    Quero para o meu negócio{" "}
                    <ArrowRight className="ml-2 size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </a>
                </Button>
              </div>
              <ul className="space-y-3.5">
                {seg.itens.map((i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-relaxed">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-mint/15">
                      <Check className="size-3 text-brand" />
                    </span>
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="recursos" className="scroll-mt-16 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <h2 className="max-w-2xl text-balance font-display text-3xl font-extrabold tracking-[-0.025em] sm:text-5xl">
            Recursos que fazem diferença
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {destaques.map((f) => (
              <SpotCard
                key={f.title}
                className={`panel rounded-2xl p-6 transition-[transform,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-raised ${
                  destaqueAmplo.has(f.title) ? "sm:col-span-2" : ""
                }`}
              >
                <span className="grid size-11 place-items-center rounded-xl bg-[#0a1610] text-mint">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold tracking-[-0.01em] sm:text-lg">
                  {f.title}
                </h3>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {f.text}
                </p>
              </SpotCard>
            ))}
          </div>
          <div className="mt-6 grid gap-6 rounded-3xl bg-[#0a1610] p-6 text-white sm:grid-cols-3 sm:p-8">
            {[
              { icon: Boxes, k: "Multidepósito", v: "Estoque e custo separados por depósito" },
              { icon: BarChart3, k: "Relatórios", v: "Lucro por produto, depósito e mês" },
              { icon: ShieldCheck, k: "Multiempresa", v: "Filiais, perfis de acesso e auditoria" },
            ].map((i) => (
              <div key={i.k} className="flex items-center gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-mint/25 bg-mint/10 text-mint">
                  <i.icon className="size-5" />
                </span>
                <div>
                  <p className="font-display text-sm font-semibold sm:text-base">{i.k}</p>
                  <p className="text-xs leading-relaxed text-white/60">{i.v}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="text-balance font-display text-3xl font-extrabold tracking-[-0.025em] sm:text-5xl">
              Planos
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Escolha pelo tamanho da operação. Teste grátis de 15 dias nos planos{" "}
              {NOME_DO_PLANO.loja} e {NOME_DO_PLANO.rede}.
            </p>
          </div>
          <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
            {planos.map((p) =>
              p.destaque ? (
                <div key={p.nome} className="lp-beam relative rounded-3xl p-[1.5px] shadow-raised">
                  <div className="flex h-full flex-col rounded-[calc(1.5rem-1.5px)] bg-[#0a1610] p-6 text-white sm:p-8">
                    <span className="absolute -top-3 left-6 rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-mint-foreground shadow-sm">
                      Recomendado
                    </span>
                    <h3 className="font-display text-xl font-bold tracking-[-0.01em]">{p.nome}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-white/60">{p.resumo}</p>
                    <p className="mt-5 font-display text-5xl font-extrabold tracking-[-0.02em] text-mint text-numeric">
                      {p.preco}
                      <span className="ml-1.5 text-sm font-medium text-white/60">/mês</span>
                    </p>
                    {p.teste && (
                      <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-mint/30 bg-mint/10 px-2.5 py-0.5 text-[11px] font-semibold text-mint">
                        <Check className="size-3" /> 15 dias grátis
                      </p>
                    )}
                    <ul className="mt-6 flex-1 space-y-2.5">
                      {p.itens.map((i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-mint/15">
                            <Check className="size-3 text-mint" />
                          </span>
                          {i}
                        </li>
                      ))}
                    </ul>
                    <Button
                      asChild
                      className="lp-shine mt-7 w-full border-transparent bg-mint font-semibold text-mint-foreground transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out hover:bg-mint/90 active:scale-[0.98]"
                    >
                      {p.teste ? (
                        <Link to="/auth" search={{ aba: "criar" }}>
                          Testar 15 dias
                        </Link>
                      ) : (
                        <Link to="/auth">Começar agora</Link>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={p.nome}
                  className="panel flex flex-col rounded-3xl p-6 transition-[transform,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-raised sm:p-8"
                >
                  <h3 className="font-display text-xl font-bold tracking-[-0.01em]">{p.nome}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{p.resumo}</p>
                  <p className="mt-5 font-display text-4xl font-extrabold tracking-[-0.02em] text-numeric">
                    {p.preco}
                    <span className="ml-1.5 text-sm font-medium text-muted-foreground">/mês</span>
                  </p>
                  {p.teste && (
                    <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/25 bg-mint/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand-strong">
                      <Check className="size-3" /> 15 dias grátis
                    </p>
                  )}
                  <ul className="mt-6 flex-1 space-y-2.5">
                    {p.itens.map((i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-mint/15">
                          <Check className="size-3 text-brand" />
                        </span>
                        {i}
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    variant="outline"
                    className="mt-7 w-full transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out active:scale-[0.98]"
                  >
                    {p.teste ? (
                      <Link to="/auth" search={{ aba: "criar" }}>
                        Testar 15 dias
                      </Link>
                    ) : (
                      <Link to="/auth">Começar agora</Link>
                    )}
                  </Button>
                </div>
              ),
            )}
          </div>
          <div className="panel mt-8 rounded-3xl p-6 sm:p-10">
            <h3 className="font-display text-xl font-bold tracking-[-0.015em]">
              Módulos setoriais
            </h3>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Pet shop, clínica veterinária e lava-rápido vêm incluídos na mensalidade do plano
              escolhido, sem adicional pelo módulo. Para usar mais de um módulo na mesma empresa,
              fale com a equipe.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {solucoesSetoriais.map((s) => (
                <div
                  key={s.nome}
                  className="rounded-2xl border border-border bg-secondary p-5 transition-[transform,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-panel"
                >
                  <p className="flex items-center gap-2.5 text-sm font-semibold">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#0a1610] text-mint">
                      <s.icon className="size-4" />
                    </span>
                    {s.nome}
                  </p>
                  <ul className="mt-3.5 space-y-2">
                    {s.itens.map((i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-mint/15">
                          <Check className="size-3 text-brand" />
                        </span>
                        {i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="panel mt-6 rounded-3xl p-6 sm:p-10">
            <h3 className="font-display text-xl font-bold tracking-[-0.015em]">
              Implantação e expansão
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Implantação é paga uma única vez. Mensalidade é cobrada todo mês.
            </p>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
                  Contratação inicial
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-border bg-secondary p-5">
                    <p className="text-sm font-semibold">Implantação inicial</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Demais segmentos
                    </p>
                    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-display text-3xl font-extrabold tracking-tight text-numeric">
                        R$ 1.500
                      </span>
                      <span className="text-xs text-muted-foreground">pagamento único</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-secondary p-5">
                    <p className="text-sm font-semibold">Treinamento e configuração inicial</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Pet shop, clínica veterinária e lava-rápido, no lugar da implantação inicial
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Inclui cadastro inicial, importação de produtos e treinamento remoto.
                    </p>
                    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-display text-3xl font-extrabold tracking-tight text-numeric">
                        R$ 299
                      </span>
                      <span className="text-xs text-muted-foreground">taxa única</span>
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
                  Expansão do plano {NOME_DO_PLANO.rede}
                </p>
                <div className="mt-4 space-y-3">
                  {expansao.map((e) => (
                    <div
                      key={e.titulo}
                      className="rounded-2xl border border-border bg-secondary p-5"
                    >
                      <p className="text-sm font-semibold">{e.titulo}</p>
                      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">Implantação</dt>
                          <dd className="font-display text-lg font-bold text-numeric">
                            {e.implantacao}{" "}
                            <span className="text-xs font-medium text-muted-foreground">
                              pagamento único
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Mensalidade</dt>
                          <dd className="font-display text-lg font-bold text-numeric">
                            {e.mensalidade}
                            <span className="text-xs font-medium text-muted-foreground">
                              {e.unidade}
                            </span>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-border bg-mint text-mint-foreground">
        <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-5 px-5 py-16 text-center sm:px-8 sm:py-24">
          <h2 className="text-balance font-display text-3xl font-extrabold tracking-[-0.025em] text-[#0a1610] sm:text-5xl">
            Vamos conversar sobre o seu negócio?
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-[#0a1610]/75 sm:text-base">
            Mostramos o sistema funcionando no seu ramo e ajudamos a escolher o plano certo.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="h-auto max-w-full whitespace-normal border-transparent bg-[#0a1610] py-2.5 text-center text-white shadow-raised transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out hover:bg-[#0a1610]/90 active:scale-[0.98]"
            >
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 size-4 shrink-0" /> Chamar no WhatsApp{" "}
                {WHATSAPP_LABEL}
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="border-[#0a1610]/25 bg-transparent text-[#0a1610] shadow-none transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out hover:bg-white/25 active:scale-[0.98]"
            >
              <Link to="/contato">Outros contatos</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-[#0a1610] px-5 py-10 text-center text-xs text-white/50 sm:px-8">
        <p>EZRA ERP • WhatsApp {WHATSAPP_LABEL} • contato@zeregistra.com.br</p>
        <p className="mt-1.5">Desenvolvido por EZRA</p>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mt-3 text-xs text-white/60 hover:bg-white/10 hover:text-white"
        >
          <Link to="/ze-tech-login">Painel EZRA (equipe)</Link>
        </Button>
      </footer>

      {/* No celular o atalho do WhatsApp fica no cabeçalho, para não cobrir texto, preços nem a demonstração do caixa */}
      <a
        href={WHATSAPP}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-30 hidden size-14 place-items-center rounded-full bg-mint text-mint-foreground shadow-raised transition-transform duration-150 ease-out hover:scale-105 active:scale-95 sm:grid"
      >
        <MessageCircle className="size-6" />
      </a>
    </div>
  );
}
