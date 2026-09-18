import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ClipboardList,
  PackageX,
  Truck,
  Wallet,
  TrendingDown,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { hojeISO, somaDias } from "@/lib/financeiro";
import { usePeriodo } from "@/lib/periodo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard, EmptyState } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Pedidos em andamento, orçamentos expirados, contas a receber e a pagar, alertas de vencimento e estoque.",
      },
      { property: "og:title", content: "Dashboard — ERP Ze Tech" },
      { property: "og:description", content: "Visão geral comercial, financeira e de estoque da loja." },
    ],
  }),
  component: Dashboard,
});

const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const emAndamento = [
  "aguardando_pagamento",
  "aprovado",
  "separacao",
  "separado",
  "conferencia",
  "pronto_entrega",
  "em_rota",
];

function Dashboard() {
  const hoje = hojeISO();
  const em7 = somaDias(hoje, 7);
  const { periodo, setDe, setAte } = usePeriodo();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [pedidos, orcamentos, receber, pagar, entregas, estoques, produtosCount] =
        await Promise.all([
          supabase.from("pedidos").select("id, numero, situacao, total, previsao_entrega, created_at, clientes(nome), pedido_itens(quantidade, custo_unitario, total)"),
          supabase.from("orcamentos").select("id, numero, situacao, validade, total, clientes(nome)").is("deleted_at", null),
          supabase.from("contas_receber").select("id, numero, descricao, vencimento, valor, valor_recebido, situacao, clientes(nome)"),
          supabase.from("contas_pagar").select("id, numero, descricao, vencimento, valor, valor_pago, situacao, fornecedores(nome_fantasia, razao_social)"),
          supabase.from("entregas").select("id, situacao, previsao_data"),
          supabase
            .from("estoques")
            .select("quantidade, reservado, produtos(id, descricao, custo, preco_venda, estoque_minimo, unidade, categorias(nome))"),
          supabase.from("produtos").select("id", { count: "exact", head: true }),
        ]);
      return {
        pedidos: pedidos.data ?? [],
        orcamentos: orcamentos.data ?? [],
        receber: receber.data ?? [],
        pagar: pagar.data ?? [],
        entregas: entregas.data ?? [],
        estoques: estoques.data ?? [],
        totalProdutos: produtosCount.count ?? 0,
      };
    },
  });

  const { data: fiscal } = useQuery({
    queryKey: ["dashboard-fiscal"],
    queryFn: async () => {
      const [notas, vinculos, pedidos] = await Promise.all([
        supabase
          .from("nfe")
          .select(
            "id, numero, serie, situacao, ambiente, valor_total, pendencias, mensagem, created_at, transmitida_em, autorizada_em, clientes(nome)",
          )
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("nfe_pedidos").select("pedido_id, nfe_id, nfe(situacao)"),
        supabase
          .from("pedidos")
          .select("id, numero, total, situacao, created_at, clientes(nome)")
          .neq("situacao", "cancelado")
          .order("numero", { ascending: false })
          .limit(100),
      ]);
      const comNota = new Set(
        (vinculos.data ?? [])
          .filter((v) => (v.nfe as { situacao: string } | null)?.situacao !== "cancelada")
          .map((v) => v.pedido_id),
      );
      return {
        notas: notas.data ?? [],
        semNota: (pedidos.data ?? []).filter((p) => !comNota.has(p.id)),
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

  const noPeriodo = data.pedidos.filter((p) => {
    const d = String(p.created_at).slice(0, 10);
    return p.situacao !== "cancelado" && d >= periodo.de && d <= periodo.ate;
  });
  const itensPeriodo = noPeriodo.flatMap(
    (p) => (p.pedido_itens ?? []) as Array<{ quantidade: number; custo_unitario: number; total: number }>,
  );
  const receitaPeriodo = itensPeriodo.reduce((s, i) => s + Number(i.total), 0);
  const custoPeriodo = itensPeriodo.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0);
  const lucroPeriodo = receitaPeriodo - custoPeriodo;
  const margemPeriodo = receitaPeriodo > 0 ? (lucroPeriodo / receitaPeriodo) * 100 : 0;

  const nomeCliente = (x: unknown) => (x as { nome: string } | null)?.nome ?? "—";

  // Comercial
  const pedidosAndamento = data.pedidos.filter((p) => emAndamento.includes(p.situacao));
  const valorAndamento = pedidosAndamento.reduce((s, p) => s + Number(p.total), 0);
  const orcamentosExpirados = data.orcamentos.filter(
    (o) => o.situacao === "expirado" || (["enviado", "em_negociacao"].includes(o.situacao) && o.validade && o.validade < hoje),
  );
  const orcamentosAbertos = data.orcamentos.filter((o) => ["enviado", "em_negociacao"].includes(o.situacao));

  // Financeiro
  const abertoReceber = data.receber.filter((c) => ["aberto", "parcial"].includes(c.situacao));
  const abertoPagar = data.pagar.filter((c) => ["aberto", "parcial"].includes(c.situacao));
  const saldoReceber = abertoReceber.reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0);
  const saldoPagar = abertoPagar.reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0);
  const receberVencidas = abertoReceber.filter((c) => c.vencimento < hoje);
  const pagarVencidas = abertoPagar.filter((c) => c.vencimento < hoje);
  const venceHoje = [...abertoReceber, ...abertoPagar].filter((c) => c.vencimento === hoje);
  const prox7 = [...abertoReceber, ...abertoPagar].filter((c) => c.vencimento > hoje && c.vencimento <= em7);

  // Estoque
  type Prod = {
    id: string;
    descricao: string;
    custo: number;
    preco_venda: number;
    estoque_minimo: number;
    unidade: string;
    categorias: { nome: string } | null;
  };
  const porProduto = new Map<string, { prod: Prod; fisico: number; reservado: number }>();
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
  const semEstoque = linhas.filter((l) => l.fisico - l.reservado <= 0);
  const baixoEstoque = linhas.filter(
    (l) => l.fisico - l.reservado > 0 && l.fisico - l.reservado < Number(l.prod.estoque_minimo),
  );

  // Gráficos
  const etapas = emAndamento.map((s) => ({
    nome: s.replace(/_/g, " "),
    valor: pedidosAndamento.filter((p) => p.situacao === s).length,
  }));

  const dias = Array.from({ length: 15 }).map((_, i) => somaDias(hoje, i - 7));
  const serieCaixa = dias.map((d) => ({
    dia: dateBR(d).slice(0, 5),
    receber: abertoReceber
      .filter((c) => c.vencimento === d)
      .reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0),
    pagar: abertoPagar
      .filter((c) => c.vencimento === d)
      .reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0),
  }));

  const situacoesOrc = ["rascunho", "enviado", "em_negociacao", "aprovado", "rejeitado", "expirado"];
  const orcData = situacoesOrc
    .map((s) => ({ nome: s.replace(/_/g, " "), valor: data.orcamentos.filter((o) => o.situacao === s).length }))
    .filter((x) => x.valor > 0);

  const alertas = [
    ...receberVencidas.map((c) => ({
      id: `r-${c.id}`,
      tipo: "Receber vencido",
      tone: "bg-destructive/15 text-destructive",
      quem: nomeCliente(c.clientes),
      vencimento: c.vencimento,
      valor: Number(c.valor) - Number(c.valor_recebido),
    })),
    ...pagarVencidas.map((c) => ({
      id: `p-${c.id}`,
      tipo: "Pagar vencido",
      tone: "bg-destructive/15 text-destructive",
      quem:
        (c.fornecedores as unknown as { nome_fantasia: string | null; razao_social: string } | null)
          ?.nome_fantasia ??
        (c.fornecedores as unknown as { razao_social: string } | null)?.razao_social ??
        c.descricao,
      vencimento: c.vencimento,
      valor: Number(c.valor) - Number(c.valor_pago),
    })),
  ]
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Pedidos em andamento, orçamentos, contas a receber e a pagar, alertas de vencimento e saúde do estoque."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/pedidos">Pedidos</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/fluxo-caixa">Fluxo de caixa</Link>
            </Button>
          </div>
        }
      />

      <div className="panel mb-4 p-4">
        <h2 className="mb-3 font-display text-sm font-semibold">Período de referência</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label>De</Label>
          <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Vendas no período: <strong className="text-foreground">{brl(receitaPeriodo)}</strong> ·
          custo {brl(custoPeriodo)} · lucro{" "}
          <strong className={lucroPeriodo >= 0 ? "text-success" : "text-destructive"}>
            {brl(lucroPeriodo)}
          </strong>{" "}
          ({num(margemPeriodo, 1)}% de margem). O relatório de lucro usa o mesmo período.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pedidos em andamento"
          value={num(pedidosAndamento.length, 0)}
          icon={ClipboardList}
          tone="accent"
          hint={`${brl(valorAndamento)} em carteira`}
        />
        <StatCard
          label="Orçamentos expirados"
          value={num(orcamentosExpirados.length, 0)}
          icon={CalendarClock}
          tone={orcamentosExpirados.length > 0 ? "warning" : "default"}
          hint={`${orcamentosAbertos.length} em negociação`}
        />
        <StatCard
          label="A receber em aberto"
          value={brl(saldoReceber)}
          icon={Wallet}
          tone="success"
          hint={`${receberVencidas.length} vencidas`}
        />
        <StatCard
          label="A pagar em aberto"
          value={brl(saldoPagar)}
          icon={Wallet}
          tone="danger"
          hint={`${pagarVencidas.length} vencidas`}
        />
        <StatCard
          label="Vence hoje"
          value={num(venceHoje.length, 0)}
          icon={AlertTriangle}
          tone={venceHoje.length > 0 ? "warning" : "default"}
          hint="Contas a receber e a pagar"
        />
        <StatCard
          label="Vence em 7 dias"
          value={num(prox7.length, 0)}
          icon={CalendarClock}
          hint="Planeje o caixa da semana"
        />
        <StatCard
          label="Entregas em rota"
          value={num(data.entregas.filter((e) => e.situacao === "em_rota").length, 0)}
          icon={Truck}
          hint={`${data.entregas.filter((e) => e.situacao === "planejada").length} planejadas`}
        />
        <StatCard
          label="Valor do estoque (custo)"
          value={brl(valorCusto)}
          icon={Boxes}
          hint={`${data.totalProdutos} produtos cadastrados`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold">Caixa projetado (7 dias para trás e 7 para frente)</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serieCaixa}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => brl(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="receber" name="A receber" stroke="var(--chart-1)" strokeWidth={2} />
                <Line type="monotone" dataKey="pagar" name="A pagar" stroke="var(--chart-4)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Orçamentos por situação</h2>
          <div className="mt-4 h-72">
            {orcData.length === 0 ? (
              <EmptyState className="border-0 shadow-none" title="Nenhum orçamento registrado." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={orcData} dataKey="valor" nameKey="nome" innerRadius={45} outerRadius={80}>
                    {orcData.map((_, i) => (
                      <Cell key={i} fill={chartColors[i % chartColors.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Pedidos por etapa</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={etapas} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="nome" type="category" width={110} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="valor" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold">Alertas de vencimento</h2>
          {alertas.length === 0 ? (
            <EmptyState
              className="mt-4 border-0 shadow-none"
              title="Nenhuma conta vencida."
              description="Tudo em dia no financeiro."
            />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {alertas.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Badge className={a.tone}>{a.tipo}</Badge>
                  <span className="min-w-0 flex-1 truncate">{a.quem}</span>
                  <span className="text-xs text-muted-foreground">{dateBR(a.vencimento)}</span>
                  <span className="text-numeric font-semibold">{brl(a.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold">Pendências fiscais</h2>
            <p className="text-xs text-muted-foreground">
              Notas emitidas com data de envio e situação, e pedidos que ainda não geraram nota.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/nfe">Notas fiscais</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/balanco-fiscal">Balanço fiscal</Link>
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Notas emitidas</h3>
            {(fiscal?.notas ?? []).length === 0 ? (
              <EmptyState
                className="mt-3 border-0 shadow-none"
                title="Nenhuma nota gerada."
                description="Gere a nota a partir do pedido."
              />
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {(fiscal?.notas ?? []).slice(0, 8).map((n) => {
                  const pend = (n.pendencias ?? []).length;
                  const envio = n.autorizada_em ?? n.transmitida_em;
                  return (
                    <li key={n.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <Badge
                        className={
                          n.situacao === "autorizada"
                            ? "bg-success/15 text-success"
                            : n.situacao === "rejeitada" || n.situacao === "cancelada"
                              ? "bg-destructive/15 text-destructive"
                              : pend > 0
                                ? "bg-warning/15 text-warning"
                                : "bg-primary/15 text-primary"
                        }
                      >
                        {n.situacao}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {n.numero ? `nº ${String(n.numero).padStart(4, "0")}` : "sem número"} ·{" "}
                        {nomeCliente(n.clientes)}
                        {pend > 0 && (
                          <span className="block text-xs text-warning">
                            {pend} pendência(s): {(n.pendencias ?? []).slice(0, 2).join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {envio ? `enviada ${dateBR(String(envio).slice(0, 10))}` : "não enviada"}
                      </span>
                      <span className="text-numeric font-semibold">{brl(Number(n.valor_total))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              Pedidos sem nota fiscal
            </h3>
            {(fiscal?.semNota ?? []).length === 0 ? (
              <EmptyState
                className="mt-3 border-0 shadow-none"
                title="Todos os pedidos têm nota."
                description="Nenhuma pendência por pedido."
              />
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {(fiscal?.semNota ?? []).slice(0, 8).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Badge className="bg-warning/15 text-warning">sem nota</Badge>
                    <Link
                      to="/pedidos/$id"
                      params={{ id: p.id }}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      Pedido nº {String(p.numero).padStart(4, "0")} · {nomeCliente(p.clientes)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {dateBR(String(p.created_at).slice(0, 10))}
                    </span>
                    <span className="text-numeric font-semibold">{brl(Number(p.total))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>


      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Orçamentos vencidos sem resposta</h2>
          {orcamentosExpirados.length === 0 ? (
            <EmptyState
              className="mt-4 border-0 shadow-none"
              title="Nenhum orçamento expirado."
              description="Todos dentro da validade."
            />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {orcamentosExpirados.slice(0, 8).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="text-numeric text-xs text-muted-foreground">
                    #{String(o.numero).padStart(4, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{nomeCliente(o.clientes)}</span>
                  <span className="text-xs text-muted-foreground">
                    validade {o.validade ? dateBR(o.validade) : "—"}
                  </span>
                  <span className="text-numeric font-semibold">{brl(Number(o.total))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Atenção no estoque</h2>
          <div className="mt-2 flex gap-2">
            <Badge className="bg-destructive/15 text-destructive">
              <PackageX className="mr-1 size-3" /> {semEstoque.length} sem estoque
            </Badge>
            <Badge className="bg-warning/20 text-warning-foreground">
              <TrendingDown className="mr-1 size-3" /> {baixoEstoque.length} abaixo do mínimo
            </Badge>
          </div>
          {semEstoque.length + baixoEstoque.length === 0 ? (
            <EmptyState className="mt-4 border-0 shadow-none" title="Estoque saudável." />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {[...semEstoque, ...baixoEstoque].slice(0, 8).map((l) => {
                const disponivel = l.fisico - l.reservado;
                return (
                  <li key={l.prod.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{l.prod.descricao}</span>
                    <span className="text-numeric text-xs text-muted-foreground">
                      disponível {num(disponivel)} {l.prod.unidade} · mínimo {num(l.prod.estoque_minimo)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
