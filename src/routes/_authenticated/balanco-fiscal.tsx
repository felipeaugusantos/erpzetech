import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins, FileText, Percent, Receipt } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { rotuloMes, usePeriodo } from "@/lib/periodo";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/balanco-fiscal")({
  head: () => ({
    meta: [
      { title: "Balanço fiscal — Ze Obra" },
      {
        name: "description",
        content:
          "Balanço fiscal do período: receita, custo das mercadorias, ICMS destacado e lucro, com o resumo das notas emitidas.",
      },
      { property: "og:title", content: "Balanço fiscal — Ze Obra" },
      {
        property: "og:description",
        content: "Receita, custo, ICMS e lucro do período no Ze Obra.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BalancoFiscal,
});

type ItemNota = {
  nfe_id: string;
  quantidade: number;
  preco_unitario: number;
  custo_unitario: number;
  desconto: number;
  total: number;
  aliquota_icms: number;
  cst_csosn: string | null;
  descricao: string;
};

/** Itens com ICMS já cobrado antes (CSOSN 500 / CST 60) não destacam imposto próprio. */
const ehST = (i: ItemNota) => ["500", "60"].includes((i.cst_csosn ?? "").replace(/\D/g, ""));
const icmsDoItem = (i: ItemNota) => (Number(i.total) * Number(i.aliquota_icms ?? 0)) / 100;

function BalancoFiscal() {
  const { periodo, setDe, setAte } = usePeriodo();
  const { data: session } = useSessionData();
  const filiais = session?.filiais ?? [];
  const [filialSel, setFilialSel] = useState("todas");

  const { data, isLoading } = useQuery({
    queryKey: ["balanco-fiscal", periodo.de, periodo.ate],
    queryFn: async () => {
      const [notas, pedidos, movs] = await Promise.all([
        supabase
          .from("nfe")
          .select(
            "id, numero, serie, situacao, ambiente, filial_id, deposito_id, valor_total, valor_produtos, valor_frete, valor_desconto, created_at, transmitida_em, autorizada_em, pendencias, clientes(nome), depositos(nome, filial_id), nfe_itens(nfe_id, quantidade, preco_unitario, custo_unitario, desconto, total, aliquota_icms, cst_csosn, descricao)",
          )
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false }),
        supabase
          .from("pedidos")
          .select(
            "id, total, situacao, filial_id, created_at, pedido_itens(quantidade, custo_unitario, total)",
          )
          .neq("situacao", "cancelado")
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`),
        supabase
          .from("estoque_movimentacoes")
          .select(
            "id, tipo, quantidade, custo_unitario, valor_total, created_at, depositos!estoque_movimentacoes_deposito_id_fkey(nome, filial_id)",
          )
          .in("tipo", ["entrada", "saida", "ajuste", "inventario"])
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .limit(2000),
      ]);
      if (notas.error) throw notas.error;
      if (pedidos.error) throw pedidos.error;
      if (movs.error) throw movs.error;
      return { notas: notas.data ?? [], pedidos: pedidos.data ?? [], movs: movs.data ?? [] };
    },
  });

  /** A loja é a filial da nota ou a filial do depósito de onde a mercadoria saiu. */
  const filialDaNota = (n: {
    filial_id: string | null;
    depositos: { filial_id: string | null } | null;
  }) => n.depositos?.filial_id ?? n.filial_id;

  const contas = useMemo(() => {
    const notas = (data?.notas ?? [])
      .filter((n) => n.situacao !== "cancelada")
      .filter(
        (n) =>
          filialSel === "todas" ||
          filialDaNota(n as unknown as Parameters<typeof filialDaNota>[0]) === filialSel,
      );
    const itens = notas.flatMap((n) => (n.nfe_itens ?? []) as ItemNota[]);

    const receitaNotas = itens.reduce((s, i) => s + Number(i.total), 0);
    const custoNotas = itens.reduce(
      (s, i) => s + Number(i.quantidade) * Number(i.custo_unitario),
      0,
    );
    const icms = itens.reduce((s, i) => (ehST(i) ? s : s + icmsDoItem(i)), 0);
    const icmsST = itens.reduce((s, i) => (ehST(i) ? s + icmsDoItem(i) : s), 0);
    const frete = notas.reduce((s, n) => s + Number(n.valor_frete), 0);
    const desconto = notas.reduce((s, n) => s + Number(n.valor_desconto), 0);

    const itensPedidos = (data?.pedidos ?? [])
      .filter((p) => filialSel === "todas" || p.filial_id === filialSel)
      .flatMap(
      (p) =>
        (p.pedido_itens ?? []) as Array<{
          quantidade: number;
          custo_unitario: number;
          total: number;
        }>,
    );
    const receitaVendas = itensPedidos.reduce((s, i) => s + Number(i.total), 0);
    const custoVendas = itensPedidos.reduce(
      (s, i) => s + Number(i.quantidade) * Number(i.custo_unitario),
      0,
    );

    const lucroNotas = receitaNotas - custoNotas - icms;
    return {
      notas,
      receitaNotas,
      custoNotas,
      icms,
      icmsST,
      frete,
      desconto,
      lucroNotas,
      margemNotas: receitaNotas > 0 ? (lucroNotas / receitaNotas) * 100 : 0,
      receitaVendas,
      custoVendas,
      lucroVendas: receitaVendas - custoVendas,
      semNota: receitaVendas - receitaNotas,
    };
  }, [data, filialSel]);

  const porMes = useMemo(() => {
    const mapa = new Map<
      string,
      { mes: string; receita: number; custo: number; icms: number; icmsST: number }
    >();
    for (const n of contas.notas) {
      const mes = String(n.created_at).slice(0, 7);
      const atual = mapa.get(mes) ?? { mes, receita: 0, custo: 0, icms: 0, icmsST: 0 };
      for (const i of (n.nfe_itens ?? []) as ItemNota[]) {
        atual.receita += Number(i.total);
        atual.custo += Number(i.quantidade) * Number(i.custo_unitario);
        if (ehST(i)) atual.icmsST += icmsDoItem(i);
        else atual.icms += icmsDoItem(i);
      }
      mapa.set(mes, atual);
    }
    return [...mapa.values()]
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((m) => ({ ...m, rotulo: rotuloMes(m.mes), lucro: m.receita - m.custo - m.icms }));
  }, [contas.notas]);

  /** Entradas, saídas e ajustes de estoque valorizados pelo custo real, por depósito. */
  const estoque = useMemo(() => {
    const porDeposito = new Map<
      string,
      { nome: string; entradas: number; saidas: number; ajustes: number; ajusteQtd: number }
    >();
    let entradas = 0;
    let saidas = 0;
    let ajustes = 0;

    for (const m of data?.movs ?? []) {
      const d = m.depositos as unknown as { nome: string; filial_id: string | null } | null;
      if (filialSel !== "todas" && d?.filial_id !== filialSel) continue;
      const nome = d?.nome ?? "Sem depósito";
      const atual =
        porDeposito.get(nome) ?? { nome, entradas: 0, saidas: 0, ajustes: 0, ajusteQtd: 0 };
      const valor = Number(m.valor_total ?? 0);
      if (m.tipo === "entrada") {
        atual.entradas += valor;
        entradas += valor;
      } else if (m.tipo === "saida") {
        atual.saidas += valor;
        saidas += valor;
      } else {
        atual.ajustes += valor;
        atual.ajusteQtd += 1;
        ajustes += valor;
      }
      porDeposito.set(nome, atual);
    }

    return {
      entradas,
      saidas,
      ajustes,
      lista: [...porDeposito.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
    };
  }, [data?.movs, filialSel]);

  const linhas = [
    { conta: "1. Receita de notas emitidas", valor: contas.receitaNotas, tipo: "receita" },
    { conta: "1.1 Descontos concedidos", valor: -contas.desconto, tipo: "dedução" },
    { conta: "1.2 Frete cobrado", valor: contas.frete, tipo: "receita" },
    { conta: "2. Custo das mercadorias vendidas", valor: -contas.custoNotas, tipo: "custo" },
    { conta: "3. ICMS próprio destacado nas notas", valor: -contas.icms, tipo: "imposto" },
    {
      conta: "3.1 ICMS já recolhido por substituição (ST, dentro do custo)",
      valor: -contas.icmsST,
      tipo: "imposto",
    },
    { conta: "4. Lucro do período (notas)", valor: contas.lucroNotas, tipo: "resultado" },
    { conta: "5. Entradas de estoque a custo real", valor: estoque.entradas, tipo: "estoque" },
    { conta: "5.1 Saídas de estoque a custo real", valor: -estoque.saidas, tipo: "estoque" },
  ];

  return (
    <div>
      <PageHeader
        title="Balanço fiscal"
        description="Receita, custo, ICMS e lucro do período, apurados pelas notas emitidas."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/fiscal">Fiscal (NCM e CFOP)</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/estoque-movimentos">Entradas e saídas</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/inventarios">Balanço de estoque</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              Imprimir / PDF
            </Button>
          </div>
        }
      />

      <div className="panel mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <Label className="text-xs">De</Label>
          <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="sm:w-48">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="sm:w-56">
          <Label className="text-xs">Loja</Label>
          <Select value={filialSel} onValueChange={setFilialSel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as lojas</SelectItem>
              {filiais.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground sm:pb-2">
          É o mesmo período do painel e do relatório de lucro — mudou aqui, muda lá. A loja considera
          o depósito de onde a mercadoria saiu.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receita em notas" value={brl(contas.receitaNotas)} icon={Receipt} />
        <StatCard label="Custo das mercadorias" value={brl(contas.custoNotas)} icon={Coins} tone="warning" />
        <StatCard
          label="ICMS do período"
          value={brl(contas.icms + contas.icmsST)}
          hint={`Próprio ${brl(contas.icms)} · ST ${brl(contas.icmsST)}`}
          icon={Percent}
          tone="accent"
        />
        <StatCard
          label="Lucro do período"
          value={brl(contas.lucroNotas)}
          hint={`Margem ${num(contas.margemNotas, 1)}%`}
          icon={FileText}
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Contas do período</h2>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.conta} className={l.tipo === "resultado" ? "font-semibold" : ""}>
                  <TableCell>{l.conta}</TableCell>
                  <TableCell
                    className={`text-right text-numeric ${l.valor < 0 ? "text-destructive" : ""}`}
                  >
                    {brl(l.valor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Vendas do período nos pedidos: {brl(contas.receitaVendas)} — diferença de{" "}
            {brl(contas.semNota)} ainda sem nota emitida.
          </p>
        </div>

        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Receita, custo, ICMS e lucro por mês</h2>
          {porMes.length === 0 ? (
            <EmptyState
              className="mt-4 border-0 shadow-none"
              title="Nenhuma nota no período"
              description="Emita notas ou amplie o período para ver o balanço."
            />
          ) : (
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => brl(Number(v))} />
                  <Legend />
                  <Bar dataKey="receita" name="Receita" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="custo" name="Custo" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="icms" name="ICMS próprio" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="icmsST" name="ICMS ST" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="lucro" name="Lucro" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="panel mt-4 overflow-x-auto">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        ) : contas.notas.length === 0 ? (
          <EmptyState
            title="Nenhuma nota no período"
            description="Escolha outro período ou emita a nota de um pedido."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Enviada em</TableHead>
                <TableHead className="text-right">Produtos</TableHead>
                <TableHead className="text-right">ICMS</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.notas.map((n) => {
                const itens = (n.nfe_itens ?? []) as ItemNota[];
                const icms = itens.reduce((s, i) => (ehST(i) ? s : s + icmsDoItem(i)), 0);
                const icmsST = itens.reduce((s, i) => (ehST(i) ? s + icmsDoItem(i) : s), 0);
                const envio = n.autorizada_em ?? n.transmitida_em;
                return (
                  <TableRow key={n.id}>
                    <TableCell>
                      <div className="font-medium">
                        {n.numero ? `nº ${String(n.numero).padStart(4, "0")}` : "sem número"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        série {n.serie} · {n.ambiente}
                      </div>
                    </TableCell>
                    <TableCell>{(n.clientes as { nome: string } | null)?.nome ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          n.situacao === "autorizada"
                            ? "bg-success/15 text-success"
                            : n.situacao === "rejeitada"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted text-muted-foreground"
                        }
                      >
                        {n.situacao}
                      </Badge>
                      {(n.pendencias ?? []).length > 0 && (
                        <div className="text-xs text-warning">
                          {(n.pendencias ?? []).length} pendência(s)
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {envio ? dateBR(String(envio).slice(0, 10)) : "não enviada"}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {brl(Number(n.valor_produtos))}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {brl(icms)}
                      {icmsST > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          ST {brl(icmsST)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-numeric font-semibold">
                      {brl(Number(n.valor_total))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
