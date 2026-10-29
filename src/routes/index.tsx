import { useState } from "react";
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

const WHATSAPP =
  "https://wa.me/5516988547561?text=Ol%C3%A1!%20Quero%20conhecer%20o%20ERP%20Ze%20Tech";
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

function WhatsButton({ size = "lg", className = "" }: { size?: "sm" | "lg"; className?: string }) {
  return (
    <Button asChild size={size} variant="outline" className={className}>
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
    <div className="panel overflow-hidden p-0 text-left shadow-xl">
      <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-2.5 text-primary-foreground">
        <span className="font-display text-sm font-semibold">Frente de caixa • Caixa 1</span>
        <span className="text-xs opacity-80">Operador: Ana</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-[1.6fr_1fr]">
        <div className="p-4">
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-brand" /> "material para assentar piso no banheiro"
          </div>
          <ul className="mt-3 divide-y divide-border text-sm">
            {itens.map((i) => (
              <li key={i.n} className="flex justify-between gap-2 py-2">
                <span>
                  {i.n} <span className="text-xs text-muted-foreground">× {i.q}</span>
                </span>
                <span className="font-medium">{i.v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between gap-3 border-t border-border bg-secondary p-4 sm:border-l sm:border-t-0">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-display text-3xl font-extrabold">R$ 681,40</p>
          </div>
          <div className="space-y-1.5 text-xs">
            {["F2 Buscar", "F4 Pagamento", "F8 Remover item"].map((k) => (
              <div key={k} className="rounded border border-border bg-card px-2 py-1">
                {k}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const [ativo, setAtivo] = useState("varejo");
  const seg = segmentos.find((s) => s.id === ativo) ?? segmentos[0]!;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <ZeLogo />
          <span className="whitespace-nowrap font-display text-sm font-bold tracking-wide sm:text-base">
            EZRA ERP
          </span>
        </div>
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link to="/funcionalidades">Funcionalidades</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <a href="#segmentos">Segmentos</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <a href="#recursos">Recursos</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
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
          <Button asChild size="sm">
            <Link to="/auth">Entrar</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium">
            <Sparkles className="size-3.5 text-brand" /> Agora com IA no caixa e integração com
            iFood
          </span>
          <h1 className="mt-5 text-balance font-display text-3xl font-extrabold leading-tight min-[400px]:text-4xl sm:text-5xl">
            Vendas, estoque e financeiro{" "}
            <span className="text-brand">em&nbsp;um&nbsp;só&nbsp;sistema para o seu negócio</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground">
            Loja, prestador de serviço, locadora ou restaurante: o EZRA ERP reúne caixa, estoque,
            ordens de serviço, locação, delivery, financeiro e nota fiscal. Cada empresa usa só o
            que precisa.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/auth" search={{ aba: "criar" }}>
                Testar 15 dias grátis <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
            <WhatsButton className="w-full sm:w-auto" />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Sem taxa por nota emitida • Sem limite de produtos • Funciona no celular
          </p>
        </div>
        <MockupPdv />
      </section>

      <section id="segmentos" className="scroll-mt-16 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <div className="text-center">
            <h2 className="font-display text-3xl font-extrabold">Feito para o seu negócio</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
              Escolha o seu ramo e veja o que o sistema faz por você.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {segmentos.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={ativo === s.id}
                onClick={() => setAtivo(s.id)}
                className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                  ativo === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-secondary"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <s.icon className="size-4 shrink-0" /> {s.nome}
                </span>
                {!(s.publicos.length === 1 && s.publicos[0] === s.nome) && (
                  <span className="flex flex-wrap gap-1.5">
                    {s.publicos.map((p) => (
                      <span
                        key={p}
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          ativo === s.id
                            ? "border-primary-foreground/40"
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
          <div className="panel mt-5 grid gap-6 p-6 md:grid-cols-2 md:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-strong">
                {seg.nome}
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold">{seg.titulo}</h3>
              <p className="mt-3 text-sm text-muted-foreground">Para: {paraTexto(seg.publicos)}.</p>
              <Button asChild className="mt-5">
                <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
                  Quero para o meu negócio <ArrowRight className="ml-2 size-4" />
                </a>
              </Button>
            </div>
            <ul className="space-y-2.5">
              {seg.itens.map((i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" /> {i}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="recursos" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <h2 className="text-center font-display text-3xl font-extrabold">
            Recursos que fazem diferença
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {destaques.map((f) => (
              <div key={f.title} className="panel p-5">
                <span className="grid size-9 place-items-center rounded-md bg-mint/15 text-accent-foreground">
                  <f.icon className="size-4.5" />
                </span>
                <h3 className="mt-3 font-display text-base font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Boxes, k: "Multidepósito", v: "Estoque e custo separados por depósito" },
              { icon: BarChart3, k: "Relatórios", v: "Lucro por produto, depósito e mês" },
              { icon: ShieldCheck, k: "Multiempresa", v: "Filiais, perfis de acesso e auditoria" },
            ].map((i) => (
              <div
                key={i.k}
                className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-4"
              >
                <i.icon className="size-5 text-brand" />
                <div>
                  <p className="font-display text-sm font-semibold">{i.k}</p>
                  <p className="text-xs text-muted-foreground">{i.v}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="scroll-mt-16 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-extrabold">Planos</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
              Escolha pelo tamanho da operação. Teste grátis de 15 dias nos planos{" "}
              {NOME_DO_PLANO.loja} e {NOME_DO_PLANO.rede}.
            </p>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {planos.map((p) => (
              <div
                key={p.nome}
                className={
                  p.destaque
                    ? "panel relative flex flex-col border-2 border-brand p-6 shadow-lg"
                    : "panel flex flex-col p-6"
                }
              >
                {p.destaque && (
                  <span className="absolute -top-3 left-6 rounded-full bg-mint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-mint-foreground">
                    Recomendado
                  </span>
                )}
                <h3 className="font-display text-xl font-bold">{p.nome}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{p.resumo}</p>
                <p className="mt-4 font-display text-3xl font-extrabold">
                  {p.preco}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">/mês</span>
                </p>
                {p.teste && (
                  <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] font-semibold">
                    <Check className="size-3" /> 15 dias grátis
                  </p>
                )}
                <ul className="mt-5 flex-1 space-y-2">
                  {p.itens.map((i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" /> {i}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className="mt-6 w-full"
                  variant={p.destaque ? "default" : "outline"}
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
            ))}
          </div>
          <div className="panel mt-6 p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold">Implantação e expansão</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Implantação é paga uma única vez. Mensalidade é cobrada todo mês.
            </p>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-strong">
                  Contratação inicial
                </p>
                <div className="mt-3 rounded-lg border border-border bg-secondary p-4">
                  <p className="text-sm font-semibold">Implantação inicial</p>
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-display text-2xl font-extrabold">R$ 1.500</span>
                    <span className="text-xs text-muted-foreground">pagamento único</span>
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-strong">
                  Expansão do plano {NOME_DO_PLANO.rede}
                </p>
                <div className="mt-3 space-y-3">
                  {expansao.map((e) => (
                    <div
                      key={e.titulo}
                      className="rounded-lg border border-border bg-secondary p-4"
                    >
                      <p className="text-sm font-semibold">{e.titulo}</p>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">Implantação</dt>
                          <dd className="font-display text-lg font-bold">
                            {e.implantacao}{" "}
                            <span className="text-xs font-medium text-muted-foreground">
                              pagamento único
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Mensalidade</dt>
                          <dd className="font-display text-lg font-bold">
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

      <section className="border-t border-border bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-5 py-14 text-center sm:px-8">
          <h2 className="font-display text-3xl font-extrabold">
            Vamos conversar sobre o seu negócio?
          </h2>
          <p className="max-w-xl text-sm opacity-85">
            Mostramos o sistema funcionando no seu ramo e ajudamos a escolher o plano certo.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="h-auto max-w-full whitespace-normal py-2.5 text-center"
            >
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-2 size-4 shrink-0" /> Chamar no WhatsApp{" "}
                {WHATSAPP_LABEL}
              </a>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/contato">Outros contatos</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground sm:px-8">
        <p>EZRA ERP • WhatsApp {WHATSAPP_LABEL} • contato@zeregistra.com.br</p>
        <p className="mt-1">Desenvolvido por EZRA</p>
        <Button asChild variant="ghost" size="sm" className="mt-2 text-xs">
          <Link to="/ze-tech-login">Painel Ze Tech (equipe)</Link>
        </Button>
      </footer>

      {/* No celular o atalho do WhatsApp fica no cabeçalho, para não cobrir texto, preços nem a demonstração do caixa */}
      <a
        href={WHATSAPP}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-5 right-5 z-30 hidden size-14 place-items-center rounded-full bg-mint text-mint-foreground shadow-xl transition-transform hover:scale-105 sm:grid"
      >
        <MessageCircle className="size-6" />
      </a>
    </div>
  );
}
