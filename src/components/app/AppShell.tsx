import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Calculator,
  Bike,
  ChefHat,
  ConciergeBell,
  UtensilsCrossed,
  Landmark,
  CalendarClock,
  Hammer,
  Wrench,
  Building2,
  Boxes,
  ChevronDown,
  ClipboardList,
  FileText,
  Gauge,
  HardHat,
  IdCard,
  LayoutGrid,
  LogOut,
  MapPin,
  Menu,
  PackageSearch,
  Percent,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tag,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Warehouse,
  X,
  CircleDollarSign,
  Receipt,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useSincronizacaoOffline } from "@/hooks/useSincronizacaoOffline";
import { initials } from "@/lib/format";
import { useSaasOperador } from "@/lib/saas";
import { useModulosCnae } from "@/lib/cnae";
import { ehGestaoSalao, ehSalaoRestrito } from "@/lib/restaurante";
import { LogoEmpresa, useTemaEmpresa } from "@/components/app/MarcaEmpresa";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { NotificationsMenu } from "@/components/app/NotificationsMenu";

type Item = { label: string; to?: string; icon: typeof Gauge; soon?: boolean; secao?: string };
type Group = { label: string; icon: typeof Gauge; items: Item[] };

const groups: Group[] = [
  {
    label: "Visão geral",
    icon: Gauge,
    items: [{ label: "Dashboard", to: "/dashboard", icon: Gauge }],
  },
  {
    label: "Comercial",
    icon: Store,
    items: [
      { label: "Clientes", to: "/clientes", icon: Users },
      { label: "Clientes e obras", to: "/clientes-obras", icon: Users },
      { label: "Obras", to: "/obras", icon: HardHat },
      { label: "Histórico da obra", to: "/obra-historico", icon: HardHat },
      { label: "Profissionais e prêmios", to: "/profissionais", icon: HardHat },
      { label: "Orçamentos", to: "/orcamentos", icon: ClipboardList },
      { label: "Pedidos", to: "/pedidos", icon: ClipboardList },
      { label: "Personalização", to: "/personalizacao", icon: ClipboardList },
      { label: "Produção", to: "/producao", icon: ClipboardList },
      { label: "Custo por par", to: "/custo-par", icon: Calculator },
      { label: "Devoluções de venda", to: "/devolucoes", icon: ClipboardList },
      { label: "Vendedores", to: "/vendedores", icon: Users },
      { label: "Comissão de vendedores", to: "/comissoes", icon: Tag },
      { label: "PDV — venda rápida", to: "/pdv", icon: Store },
      { label: "Frente de caixa (tela cheia)", to: "/frente-caixa", icon: Store },
    ],
  },
  {
    label: "Estoque",
    icon: Boxes,
    items: [
      { label: "Produtos", to: "/produtos", icon: PackageSearch },
      { label: "Preços e margens", to: "/precos", icon: Tag },
      { label: "Categorias", to: "/categorias", icon: LayoutGrid },
      { label: "Estoque", to: "/estoque", icon: Boxes },
      { label: "Lotes e tonalidades", to: "/estoque-lotes", icon: Boxes },
      { label: "Ajuste de lotes", to: "/ajuste-lotes", icon: Boxes },
      { label: "Lotes sem internet", to: "/lotes-offline", icon: Wallet },
      { label: "Entradas e saídas", to: "/estoque-movimentos", icon: Boxes },
      { label: "Balanço de estoque", to: "/inventarios", icon: ClipboardList },
      { label: "Sugestão de reposição", to: "/sugestao-compra", icon: ShoppingCart },
      { label: "Transferência entre lojas", to: "/transferencias", icon: ArrowLeftRight },
      { label: "Conferência sem internet", to: "/conferencia-offline", icon: Wallet },

      { label: "Depósitos", to: "/depositos", icon: Warehouse },
    ],
  },
  {
    label: "Compras",
    icon: ShoppingCart,
    items: [
      { label: "Fornecedores", to: "/fornecedores", icon: Building2 },
      { label: "Cotações", to: "/cotacoes", icon: ClipboardList },
      { label: "Pedidos de compra", to: "/compras", icon: ShoppingCart },
      { label: "Importar XML da NF-e", to: "/nfe-entrada", icon: FileText },
      { label: "Importar CT-e de frete", to: "/importar-cte", icon: FileText },
    ],
  },
  {
    label: "Logística",
    icon: Truck,
    items: [
      { label: "Entregas", to: "/entregas", icon: Truck },
      { label: "Rota do dia", to: "/rota", icon: MapPin },
      { label: "Entregas do motorista", to: "/entregas-motorista", icon: MapPin },
      { label: "Onde estão os caminhões", to: "/frota-mapa", icon: MapPin },
      { label: "Tela do motorista", to: "/motorista", icon: IdCard },
      { label: "Veículos", to: "/veiculos", icon: Truck },
      { label: "Motoristas", to: "/motoristas", icon: IdCard },
    ],
  },
  {
    label: "Financeiro",
    icon: Wallet,
    items: [
      { label: "Contas a receber", to: "/contas-receber", icon: Wallet },
      { label: "Contas a pagar", to: "/contas-pagar", icon: Wallet },
      { label: "Caixa", to: "/caixa", icon: Wallet },
      { label: "Contas bancárias", to: "/contas-bancarias", icon: Building2 },
      { label: "Movimentação bancária", to: "/banco-movimentos", icon: ArrowLeftRight },
      { label: "Crédito de clientes", to: "/credito", icon: ShieldCheck },
      { label: "Notas fiscais", to: "/nfe", icon: FileText },
      { label: "Pendências fiscais", to: "/pendencias-fiscais", icon: FileText },
      { label: "Configuração da NFC-e", to: "/nfce-config", icon: FileText },
      { label: "Fiscal (NCM e CFOP)", to: "/fiscal", icon: FileText },
      { label: "Impostos por filial", to: "/impostos-filial", icon: Percent },
      { label: "Impostos por nota", to: "/impostos-nota", icon: Percent },
      { label: "Configuração de prefeitura", to: "/prefeitura", icon: Landmark },
      { label: "Simulação de nota", to: "/nfe-simulacao", icon: Calculator },
    ],
  },
  {
    label: "Restaurante",
    icon: UtensilsCrossed,
    items: [
      { label: "PDV do restaurante", to: "/salao", icon: ConciergeBell },
      { label: "Delivery", to: "/delivery", icon: Bike },
      { label: "Cozinha", to: "/cozinha", icon: ChefHat },
      { label: "Cardápio e mesas", to: "/cardapio", icon: ClipboardList },
    ],
  },
  {
    label: "Assistência técnica",
    icon: Wrench,
    items: [
      { label: "Ordens de serviço", to: "/assistencia", icon: Wrench },
      { label: "Técnicos", to: "/tecnicos", icon: IdCard },
    ],
  },
  {
    label: "Locação de equipamentos",
    icon: Hammer,
    items: [
      { label: "Balcão de locação", to: "/locacao-balcao", icon: Receipt },
      { label: "Locações", to: "/locacoes", icon: CalendarClock },
      { label: "Equipamentos", to: "/locacao-equipamentos", icon: Hammer },
      { label: "Estoque de equipamentos", to: "/locacao-estoque", icon: Boxes },
    ],
  },
  {
    label: "Relatórios",
    icon: FileText,
    items: [
      { secao: "Gerencial", label: "Relatório do sócio", to: "/relatorio", icon: FileText },
      { secao: "Gerencial", label: "Painel da filial extra", to: "/painel-filial", icon: Gauge },
      { secao: "Gerencial", label: "Auditoria", to: "/auditoria", icon: ShieldCheck },
      { secao: "Comercial", label: "Lucro e margem", to: "/lucro", icon: TrendingUp },
      { secao: "Comercial", label: "Comissões", to: "/relatorio-comissoes", icon: Tag },
      {
        secao: "Estoque",
        label: "Estoque por depósito",
        to: "/relatorio-estoque",
        icon: Warehouse,
      },
      { secao: "Estoque", label: "Giro e curva ABC", to: "/giro-estoque", icon: Gauge },
      { secao: "Estoque", label: "Movimentações", to: "/movimentacoes", icon: ClipboardList },
      { secao: "Estoque", label: "Movimento por tamanho", to: "/movimento-grade", icon: Boxes },
      { secao: "Financeiro", label: "Extrato a receber", to: "/extrato-receber", icon: Wallet },
      { secao: "Financeiro", label: "Fluxo de caixa", to: "/fluxo-caixa", icon: Wallet },
      {
        secao: "Financeiro",
        label: "Fechamento por operador",
        to: "/fechamento-operador",
        icon: Wallet,
      },
      { secao: "Fiscal", label: "Balanço fiscal", to: "/balanco-fiscal", icon: FileText },
      { secao: "Fiscal", label: "Painel fiscal por loja", to: "/painel-fiscal", icon: Gauge },
      {
        secao: "Assistência técnica",
        label: "Assistência por loja",
        to: "/assistencia-lojas",
        icon: Gauge,
      },
      {
        secao: "Assistência técnica",
        label: "Relatório em PDF",
        to: "/relatorio-assistencia",
        icon: FileText,
      },
      { secao: "Locação", label: "Painel de locação", to: "/painel-locacao", icon: Gauge },
      { secao: "Locação", label: "Relatório em PDF", to: "/relatorio-locacoes", icon: FileText },
    ],
  },
  {
    label: "Administração",
    icon: ShieldCheck,
    items: [
      { label: "Cadastro da empresa", to: "/empresa", icon: Building2 },
      { label: "Impostos da empresa", to: "/impostos", icon: Percent },
      { label: "Certificado e NFS-e", to: "/certificado-nfse", icon: ShieldCheck },
      { label: "Usuários e perfis", to: "/usuarios", icon: ShieldCheck },
      { label: "Importação por planilha", to: "/importacao", icon: FileText },
      { label: "Operadores de caixa", to: "/operadores", icon: ShieldCheck },
      { label: "Maquininha (TEF)", to: "/tef", icon: Wallet },
      { label: "Painel da maquininha", to: "/tef-painel", icon: Wallet },

      { label: "Filial extra", to: "/filial-extra", icon: Building2 },
      { label: "Plano e assinatura", to: "/planos", icon: Wallet },
      { label: "Configurações", to: "/configuracoes", icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  /** Módulos recolhidos, guardados no navegador do usuário. */
  const [fechados, setFechados] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const { data } = useSessionData();
  // Aplica a cor da marca da loja assim que o sistema abre.
  useTemaEmpresa();
  useSincronizacaoOffline();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem("zeobra:menu-fechados");
      if (salvo) setFechados(JSON.parse(salvo) as string[]);
    } catch {
      /* preferência ausente ou inválida: mantém tudo aberto */
    }
  }, []);

  function alternarGrupo(label: string) {
    setFechados((atual) => {
      const proximo = atual.includes(label) ? atual.filter((l) => l !== label) : [...atual, label];
      try {
        localStorage.setItem("zeobra:menu-fechados", JSON.stringify(proximo));
      } catch {
        /* sem armazenamento: só não guarda a preferência */
      }
      return proximo;
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filial = useMemo(
    () => data?.filiais.find((f) => f.id === data?.profile?.filial_id) ?? data?.filiais[0],
    [data],
  );

  /** Motorista puro vê apenas a própria rota. */
  const somenteMotorista = useMemo(() => {
    const roles = data?.roles ?? [];
    return (
      roles.includes("motorista") &&
      !roles.some((r) => ["administrador", "gestor", "logistica"].includes(r))
    );
  }, [data]);

  /** Garçom e cozinha puros só enxergam as telas do salão (o banco também os isola). */
  const somenteSalao = useMemo(() => ehSalaoRestrito(data?.roles ?? []), [data]);

  /** Equipe Ze Tech: painel das assinaturas dos clientes. */
  const { data: operadorSaas } = useSaasOperador();

  /** Assistência técnica e locação dependem do CNAE informado no cadastro da empresa. */
  const modulos = useModulosCnae();
  /** Obras só existem para lojas de materiais de construção. */
  const empresaMenu = data?.empresa as
    { ramo_atividade?: string | null; faz_personalizacao?: boolean } | null | undefined;
  const ehConstrucao = (empresaMenu?.ramo_atividade ?? "construcao") === "construcao";
  const fazPersonalizacao = Boolean(empresaMenu?.faz_personalizacao);
  const gruposLoja = useMemo(
    () =>
      groups
        .filter((g) => {
          if (g.label === "Assistência técnica") return modulos.assistencia;
          if (g.label === "Locação de equipamentos") return modulos.locacao;
          if (g.label === "Restaurante") return modulos.restaurante;
          return true;
        })
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => {
            if (i.to === "/obras" || i.to === "/obra-historico" || i.to === "/clientes-obras")
              return ehConstrucao;
            if (i.to === "/assistencia-lojas" || i.to === "/relatorio-assistencia")
              return modulos.assistencia;
            if (i.to === "/painel-locacao" || i.to === "/relatorio-locacoes")
              return modulos.locacao;
            if (
              i.to === "/personalizacao" ||
              i.to === "/custo-par" ||
              i.to === "/producao" ||
              i.to === "/movimento-grade"
            )
              return fazPersonalizacao;
            return true;
          }),
        })),
    [modulos.assistencia, modulos.locacao, modulos.restaurante, ehConstrucao, fazPersonalizacao],
  );

  /** Telas do restaurante que o perfil pode abrir. */
  const itensSalao = useMemo(() => {
    const roles = data?.roles ?? [];
    const gestao = ehGestaoSalao(roles);
    return [
      { label: "PDV do restaurante", to: "/salao", icon: ConciergeBell },
      { label: "Delivery", to: "/delivery", icon: Bike },
      { label: "Cozinha", to: "/cozinha", icon: ChefHat },
    ].filter((i) =>
      i.to === "/salao" || i.to === "/delivery"
        ? gestao || roles.some((r) => r === "garcom" || r === "caixa")
        : gestao || roles.includes("cozinha"),
    );
  }, [data]);

  /** Grupo exclusivo da equipe Ze Tech. */
  const grupoZeTech: Group = {
    label: "Ze Tech",
    icon: LayoutGrid,
    items: [
      { label: "Painel de clientes", to: "/ze-tech", icon: Users },
      { label: "Tempo real das lojas", to: "/ze-tech-tempo-real", icon: Gauge },
      { label: "Clientes da rede", to: "/ze-tech-clientes", icon: Users },
      { label: "Lojas da rede", to: "/ze-tech-lojas", icon: Building2 },
      { label: "Planos", to: "/ze-tech-planos", icon: Tag },
      { label: "Cobrança das lojas", to: "/ze-tech-cobranca", icon: CircleDollarSign },
      { label: "Contas a pagar", to: "/ze-tech-contas-pagar", icon: Wallet },
      { label: "Notas emitidas", to: "/ze-tech-notas", icon: FileText },
      { label: "Relatório fiscal", to: "/ze-tech-relatorio-fiscal", icon: Percent },
      { label: "Assistência técnica", to: "/ze-tech-assistencia", icon: Wrench },
      { label: "Custo por técnico", to: "/ze-tech-tecnicos", icon: IdCard },
      { label: "Relatórios de assinatura", to: "/ze-tech-relatorios", icon: TrendingUp },
    ],
  };

  /** Dentro da área Ze Tech o menu da loja não aparece. */
  const naAreaZeTech = pathname.startsWith("/ze-tech");

  const menu: Group[] = somenteSalao
    ? [{ label: "Restaurante", icon: UtensilsCrossed, items: itensSalao }]
    : somenteMotorista
      ? [
          {
            label: "Minha rota",
            icon: Truck,
            items: [{ label: "Minhas entregas", to: "/motorista", icon: IdCard }],
          },
        ]
      : operadorSaas
        ? naAreaZeTech
          ? [grupoZeTech]
          : [...gruposLoja, grupoZeTech]
        : gruposLoja;

  useEffect(() => {
    if (somenteMotorista && pathname !== "/motorista") {
      navigate({ to: "/motorista", replace: true });
    }
  }, [somenteMotorista, pathname, navigate]);

  useEffect(() => {
    if (!somenteSalao || itensSalao.length === 0) return;
    if (!itensSalao.some((i) => i.to === pathname)) {
      navigate({ to: itensSalao[0]!.to as "/salao", replace: true });
    }
  }, [somenteSalao, itensSalao, pathname, navigate]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (pathname === "/frente-caixa") return <>{children}</>;

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
      {mobileOpen && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <LogoEmpresa />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold tracking-wide">
              {(data?.empresa?.nome_fantasia || data?.empresa?.razao_social || "ERP ZE TECH")
                .toUpperCase()
                .slice(0, 22)}
            </p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              ERP Ze Tech · por Ze Tech
            </p>
          </div>
          <button
            className="ml-auto lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
          {menu.map((group) => {
            const aberto = !fechados.includes(group.label);
            return (
              <div key={group.label}>
                <button
                  onClick={() => alternarGrupo(group.label)}
                  aria-expanded={aberto}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <group.icon className="size-3.5 shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    className={cn("size-3.5 transition-transform", !aberto && "-rotate-90")}
                  />
                </button>
                <ul className={cn("space-y-0.5 pb-1", !aberto && "hidden")}>
                  {group.items.map((item, i) => (
                    <li key={`${item.secao ?? ""}-${item.label}`}>
                      {item.secao && item.secao !== group.items[i - 1]?.secao ? (
                        <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/35">
                          {item.secao}
                        </p>
                      ) : null}
                      {item.to && !item.soon ? (
                        <Link
                          to={item.to}
                          className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          activeProps={{
                            className:
                              "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_3px_0_0_0_var(--sidebar-primary)]",
                          }}
                        >
                          <item.icon className="size-4 shrink-0" />
                          {item.label}
                        </Link>
                      ) : (
                        <span className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-2 text-sm text-sidebar-foreground/35">
                          <item.icon className="size-4 shrink-0" />
                          {item.label}
                          <span className="ml-auto text-[9px] uppercase tracking-wider">
                            fase 2
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-card/90 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </Button>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-9 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-ring sm:max-w-md"
          >
            <Search className="size-4" />
            <span className="truncate">Buscar cliente, produto, obra…</span>
            <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 text-[10px] sm:block">
              Ctrl K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="hidden items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 md:flex">
              <Building2 className="size-3.5 text-muted-foreground" />
              <div className="leading-tight">
                <p className="max-w-[10rem] truncate text-xs font-semibold">
                  {data?.empresa?.nome_fantasia ?? data?.empresa?.razao_social ?? "Empresa"}
                </p>
                <p className="text-[10px] text-muted-foreground">{filial?.nome ?? "Filial"}</p>
              </div>
              <ChevronDown className="size-3 text-muted-foreground" />
            </div>

            <NotificationsMenu />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-secondary">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                      {initials(data?.profile?.nome ?? data?.user.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left leading-tight sm:block">
                    <p className="max-w-[9rem] truncate text-xs font-semibold">
                      {data?.profile?.nome || data?.user.email}
                    </p>
                    <p className="text-[10px] capitalize text-muted-foreground">
                      {data?.roles[0] ?? "usuário"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{data?.user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="flex flex-wrap gap-1 px-2 py-1.5">
                  {(data?.roles ?? []).map((r) => (
                    <Badge key={r} variant="secondary" className="capitalize">
                      {r}
                    </Badge>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes">
                    <Settings className="mr-2 size-4" /> Configurações
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 size-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
