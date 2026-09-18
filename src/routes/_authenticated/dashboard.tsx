import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  HardHat,
  PackageX,
  TrendingDown,
  Users,
  Warehouse,
  Wallet,
  ClipboardList,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR, num } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ze Obra" },
      { name: "description", content: "Indicadores de estoque, cadastros e movimentações da loja." },
      { property: "og:title", content: "Dashboard — Ze Obra" },
      { property: "og:description", content: "Visão geral da operação da loja." },
    ],
  }),
  component: Dashboard,
});

const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [estoques, clientes, obras, movs, depositos] = await Promise.all([
        supabase
          .from("estoques")
          .select(
            "quantidade, reservado, deposito_id, produtos(id, descricao, custo, preco_venda, estoque_minimo, unidade, categorias(nome))",
          ),
        supabase.from("clientes").select("id, ativo, limite_credito, saldo_utilizado"),
        supabase.from("obras").select("id, situacao"),
        supabase
          .from("estoque_movimentacoes")
          .select("id, tipo, quantidade, created_at, produtos(descricao), depositos!estoque_movimentacoes_deposito_id_fkey(nome)")
          .order("created_at", { ascending: false })
          .limit(120),
        supabase.from("depositos").select("id, nome"),
      ]);
      return {
        estoques: estoques.data ?? [],
        clientes: clientes.data ?? [],
        obras: obras.data ?? [],
        movs: movs.data ?? [],
        depositos: depositos.data ?? [],
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="panel h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  type Prod = {
    id: string;
    descricao: string;
    custo: number;
    preco_venda: number;
    estoque_minimo: number;
    unidade: string;
    categorias: { nome: string } | null;
  };

  const porProduto = new Map<
    string,
    { prod: Prod; fisico: number; reservado: number }
  >();
  for (const e of data.estoques) {
    const p = e.produtos as unknown as Prod | null;
    if (!p) continue;
    const atual = porProduto.get(p.id) ?? { prod: p, fisico: 0, reservado: 0 };
    atual.fisico += Number(e.quantidade);
    atual.reservado += Number(e.reservado);
    porProduto.set(p.id, atual);
  }
  const linhas = [...porProduto.values()];

  const valorCusto = linhas.reduce((s, l) => s + l.fisico * Number(l.prod.custo), 0);
  const valorVenda = linhas.reduce((s, l) => s + l.fisico * Number(l.prod.preco_venda), 0);
  const semEstoque = linhas.filter((l) => l.fisico - l.reservado <= 0);
  const baixoEstoque = linhas.filter(
    (l) => l.fisico - l.reservado > 0 && l.fisico - l.reservado < Number(l.prod.estoque_minimo),
  );
  const reservadoTotal = linhas.reduce((s, l) => s + l.reservado, 0);
  const creditoUsado = data.clientes.reduce((s, c) => s + Number(c.saldo_utilizado), 0);
  const obrasAndamento = data.obras.filter((o) => o.situacao === "em_andamento").length;

  const porCategoria = new Map<string, number>();
  for (const l of linhas) {
    const nome = l.prod.categorias?.nome ?? "Sem categoria";
    porCategoria.set(nome, (porCategoria.get(nome) ?? 0) + l.fisico * Number(l.prod.custo));
  }
  const catData = [...porCategoria.entries()]
    .map(([nome, valor]) => ({ nome, valor: Math.round(valor) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);

  const porTipo = new Map<string, number>();
  for (const m of data.movs) porTipo.set(m.tipo, (porTipo.get(m.tipo) ?? 0) + 1);
  const tipoData = [...porTipo.entries()].map(([nome, valor]) => ({ nome: nome.replace(/_/g, " "), valor }));

  const topValor = [...linhas]
    .map((l) => ({ nome: l.prod.descricao.slice(0, 22), valor: Math.round(l.fisico * Number(l.prod.custo)) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 7);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Situação atual dos cadastros e do estoque. Faturamento e pedidos entram na Fase 2."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/estoque">Abrir estoque</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Valor do estoque (custo)" value={brl(valorCusto)} icon={Wallet} tone="accent" hint={`Venda estimada ${brl(valorVenda)}`} />
        <StatCard label="Produtos cadastrados" value={num(porProduto.size, 0)} icon={Boxes} hint={`${data.depositos.length} depósitos ativos`} />
        <StatCard label="Sem estoque disponível" value={num(semEstoque.length, 0)} icon={PackageX} tone="danger" hint="Precisam de reposição imediata" />
        <StatCard label="Abaixo do mínimo" value={num(baixoEstoque.length, 0)} icon={TrendingDown} tone="warning" hint="Sugestão de compra na Fase 2" />
        <StatCard label="Clientes" value={num(data.clientes.length, 0)} icon={Users} hint={`Crédito utilizado ${brl(creditoUsado)}`} />
        <StatCard label="Obras em andamento" value={num(obrasAndamento, 0)} icon={HardHat} hint={`${data.obras.length} obras cadastradas`} />
        <StatCard label="Quantidade reservada" value={num(reservadoTotal, 2)} icon={Warehouse} hint="Aguardando separação/entrega" />
        <StatCard label="Movimentações recentes" value={num(data.movs.length, 0)} icon={ClipboardList} hint="Últimos lançamentos" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold">Valor em estoque por produto (custo)</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topValor}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => brl(Number(v))} />
                <Bar dataKey="valor" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Estoque por categoria</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={catData} dataKey="valor" nameKey="nome" innerRadius={45} outerRadius={80}>
                  {catData.map((_, i) => (
                    <Cell key={i} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => brl(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Movimentações por tipo</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tipoData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="nome" type="category" width={90} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="valor" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold">Últimas movimentações</h2>
          {data.movs.length === 0 ? (
            <EmptyState className="mt-4 border-0 shadow-none" title="Nenhuma movimentação registrada." />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {data.movs.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                  <Badge variant="secondary" className="capitalize">
                    {m.tipo.replace(/_/g, " ")}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {(m.produtos as unknown as { descricao: string } | null)?.descricao}
                  </span>
                  <span className="text-numeric text-muted-foreground">{num(m.quantidade)}</span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {dateTimeBR(m.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(semEstoque.length > 0 || baixoEstoque.length > 0) && (
        <div className="panel mt-4 p-4">
          <h2 className="font-display text-sm font-semibold">Atenção no estoque</h2>
          <ul className="mt-3 divide-y divide-border">
            {[...semEstoque, ...baixoEstoque].slice(0, 10).map((l) => {
              const disponivel = l.fisico - l.reservado;
              return (
                <li key={l.prod.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.prod.descricao}</span>
                  <Badge variant={disponivel <= 0 ? "destructive" : "secondary"}>
                    {disponivel <= 0 ? "Sem estoque" : "Abaixo do mínimo"}
                  </Badge>
                  <span className="text-numeric text-xs text-muted-foreground">
                    disponível {num(disponivel)} {l.prod.unidade} • mínimo {num(l.prod.estoque_minimo)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
