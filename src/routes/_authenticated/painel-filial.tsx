import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Coins, FileText, TrendingUp } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/painel-filial")({
  head: () => ({
    meta: [
      { title: "Painel da filial extra — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Painel só da filial extra: vendas, custo das mercadorias, lucro, margem e notas fiscais do depósito dessa loja.",
      },
      { property: "og:title", content: "Painel da filial extra — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Vendas, custo, lucro e NF-e da segunda loja, separados do painel principal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PainelFilial,
});

type ItemPedido = { quantidade: number; custo_unitario: number; total: number };

function PainelFilial() {
  const { periodo, setDe, setAte } = usePeriodo();
  const { data: session } = useSessionData();
  const filiais = session?.filiais ?? [];
  const [filialId, setFilialId] = useState<string | null>(null);
  const filial = filiais.find((f) => f.id === filialId) ?? filiais[1] ?? filiais[0] ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["painel-filial", filial?.id, periodo.de, periodo.ate],
    enabled: !!filial,
    queryFn: async () => {
      const [depositosRes, pedidosRes, notasRes] = await Promise.all([
        supabase.from("depositos").select("id, nome").eq("filial_id", filial!.id),
        supabase
          .from("pedidos")
          .select(
            "id, numero, total, situacao, created_at, clientes(nome), pedido_itens(quantidade, custo_unitario, total)",
          )
          .eq("filial_id", filial!.id)
          .neq("situacao", "cancelado")
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false }),
        supabase
          .from("nfe")
          .select(
            "id, numero, serie, situacao, ambiente, valor_total, created_at, transmitida_em, autorizada_em, pendencias, filial_id, deposito_id, clientes(nome), depositos(nome, filial_id)",
          )
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false }),
      ]);
      if (pedidosRes.error) throw pedidosRes.error;
      if (notasRes.error) throw notasRes.error;

      const depositos = depositosRes.data ?? [];
      const idsDep = new Set(depositos.map((d) => d.id));
      const notas = (notasRes.data ?? []).filter(
        (n) =>
          n.filial_id === filial!.id ||
          (n.deposito_id ? idsDep.has(n.deposito_id) : false) ||
          (n.depositos as { filial_id: string | null } | null)?.filial_id === filial!.id,
      );

      const estoques =
        depositos.length > 0
          ? ((
              await supabase
                .from("estoques")
                .select("quantidade, custo_medio")
                .in(
                  "deposito_id",
                  depositos.map((d) => d.id),
                )
            ).data ?? [])
          : [];

      return { depositos, pedidos: pedidosRes.data ?? [], notas, estoques };
    },
  });

  const resumo = useMemo(() => {
    const pedidos = data?.pedidos ?? [];
    const itens = pedidos.flatMap((p) => (p.pedido_itens ?? []) as ItemPedido[]);
    const receita = itens.reduce((s, i) => s + Number(i.total), 0);
    const custo = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario), 0);
    const notas = (data?.notas ?? []).filter((n) => n.situacao !== "cancelada");
    const estoque = (data?.estoques ?? []).reduce(
      (s, e) => s + Number(e.quantidade) * Number(e.custo_medio),
      0,
    );
    return {
      receita,
      custo,
      lucro: receita - custo,
      margem: receita > 0 ? ((receita - custo) / receita) * 100 : 0,
      pedidos: pedidos.length,
      notas,
      notasValor: notas.reduce((s, n) => s + Number(n.valor_total), 0),
      pendentes: notas.filter((n) => n.situacao !== "autorizada").length,
      estoque,
    };
  }, [data]);

  const porMes = useMemo(() => {
    const mapa = new Map<string, { mes: string; receita: number; custo: number }>();
    for (const p of data?.pedidos ?? []) {
      const mes = String(p.created_at).slice(0, 7);
      const atual = mapa.get(mes) ?? { mes, receita: 0, custo: 0 };
      for (const i of (p.pedido_itens ?? []) as ItemPedido[]) {
        atual.receita += Number(i.total);
        atual.custo += Number(i.quantidade) * Number(i.custo_unitario);
      }
      mapa.set(mes, atual);
    }
    return [...mapa.values()]
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((m) => ({ ...m, rotulo: rotuloMes(m.mes), lucro: m.receita - m.custo }));
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Painel da filial extra"
        description="Vendas, custo, lucro e notas só desta loja — o painel principal continua como está."
        actions={
          <div className="flex flex-wrap gap-2">
            {filiais.length > 1 && (
              <Select value={filial?.id ?? ""} onValueChange={setFilialId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Loja" />
                </SelectTrigger>
                <SelectContent>
                  {filiais.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/filial-extra">Montar a filial</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/balanco-fiscal">Balanço fiscal</Link>
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
        <p className="text-xs text-muted-foreground sm:pb-2">
          Mesmo período do painel principal e do balanço fiscal.
        </p>
      </div>

      {!filial ? (
        <EmptyState
          title="Nenhuma loja cadastrada"
          description="Crie a filial extra para acompanhar as vendas dela aqui."
          action={
            <Button asChild>
              <Link to="/filial-extra">Criar filial extra</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{filial.nome}</Badge>
            <span className="text-sm text-muted-foreground">
              {(data?.depositos ?? []).map((d) => d.nome).join(" · ") || "sem depósito próprio"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Vendas no período"
              value={brl(resumo.receita)}
              hint={`${resumo.pedidos} pedido(s)`}
              icon={Building2}
            />
            <StatCard
              label="Custo das mercadorias"
              value={brl(resumo.custo)}
              hint="Custo de aquisição do depósito desta loja"
              icon={Coins}
              tone="warning"
            />
            <StatCard
              label="Lucro"
              value={brl(resumo.lucro)}
              hint={`Margem ${num(resumo.margem, 1)}%`}
              icon={TrendingUp}
              tone="success"
            />
            <StatCard
              label="Notas emitidas"
              value={String(resumo.notas.length)}
              hint={`${brl(resumo.notasValor)} · ${resumo.pendentes} sem autorização`}
              icon={FileText}
              tone="accent"
            />
          </div>

          <div className="panel mt-4 p-4">
            <h2 className="font-display text-sm font-semibold">Receita, custo e lucro por mês</h2>
            {porMes.length === 0 ? (
              <EmptyState
                className="mt-4 border-0 shadow-none"
                title="Nenhuma venda desta loja no período"
                description="Amplie o período ou registre pedidos com o depósito desta filial."
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
                    <Bar
                      dataKey="receita"
                      name="Receita"
                      fill="var(--chart-1)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar dataKey="custo" name="Custo" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lucro" name="Lucro" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="panel mt-4 overflow-x-auto">
            <div className="border-b border-border px-4 py-3">
              <p className="font-display text-sm font-semibold">Notas fiscais desta loja</p>
              <p className="text-xs text-muted-foreground">
                Estoque a custo nesta loja: {brl(resumo.estoque)}
              </p>
            </div>
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
            ) : resumo.notas.length === 0 ? (
              <EmptyState
                title="Nenhuma nota desta loja no período"
                description="As notas geradas a partir de pedidos do depósito desta filial aparecem aqui."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nota</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Enviada em</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumo.notas.map((n) => {
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
                        <TableCell>
                          {(n.clientes as { nome: string } | null)?.nome ?? "—"}
                        </TableCell>
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
        </>
      )}
    </div>
  );
}
