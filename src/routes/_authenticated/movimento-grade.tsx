import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Boxes, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR, num } from "@/lib/format";
import { ordemTamanho } from "@/lib/personalizacao";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/movimento-grade")({
  head: () => ({
    meta: [
      { title: "Movimento por tamanho — EZRA ERP" },
      {
        name: "description",
        content: "Entradas, baixas da produção, devoluções e ajustes de estoque por numeração.",
      },
      { property: "og:title", content: "Movimento por tamanho — EZRA ERP" },
      { property: "og:description", content: "Histórico de estoque por grade de tamanhos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MovimentoGrade,
});

const ORIGENS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  compra: { label: "Entrada de nota", variant: "default" },
  producao: { label: "Baixa na produção", variant: "destructive" },
  cancelamento: { label: "Volta por cancelamento", variant: "secondary" },
  ajuste: { label: "Ajuste manual", variant: "outline" },
  outro: { label: "Outro", variant: "outline" },
};

function hojeMenos(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function MovimentoGrade() {
  const [inicio, setInicio] = useState(hojeMenos(30));
  const [fim, setFim] = useState(hojeMenos(0));
  const [origem, setOrigem] = useState("todas");
  const [tamanho, setTamanho] = useState("todos");
  const [busca, setBusca] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["movimento-grade", inicio, fim],
    queryFn: async () => {
      const ate = new Date(`${fim}T00:00:00`);
      ate.setDate(ate.getDate() + 1);
      const { data, error } = await supabase
        .from("estoque_grade_movimentos")
        .select(
          "id, tamanho, quantidade, saldo_apos, origem, documento, created_at, produtos(descricao, codigo_interno), depositos(nome)",
        )
        .gte("created_at", new Date(`${inicio}T00:00:00`).toISOString())
        .lt("created_at", ate.toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });

  const tamanhos = useMemo(
    () =>
      [...new Set(data.map((m) => m.tamanho))].sort((a, b) => ordemTamanho(a) - ordemTamanho(b)),
    [data],
  );

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return data.filter(
      (m) =>
        (origem === "todas" || m.origem === origem) &&
        (tamanho === "todos" || m.tamanho === tamanho) &&
        (!q ||
          (m.produtos?.descricao ?? "").toLowerCase().includes(q) ||
          (m.produtos?.codigo_interno ?? "").toLowerCase().includes(q) ||
          (m.documento ?? "").toLowerCase().includes(q)),
    );
  }, [data, origem, tamanho, busca]);

  const entradas = linhas
    .filter((m) => Number(m.quantidade) > 0)
    .reduce((s, m) => s + Number(m.quantidade), 0);
  const saidas = linhas
    .filter((m) => Number(m.quantidade) < 0)
    .reduce((s, m) => s - Number(m.quantidade), 0);

  const resumo = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linhas)
      if (l.origem === "producao") m.set(l.tamanho, (m.get(l.tamanho) ?? 0) - Number(l.quantidade));
    return [...m.entries()].sort((a, b) => ordemTamanho(a[0]) - ordemTamanho(b[0]));
  }, [linhas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movimento por tamanho"
        description="Tudo que entrou e saiu de cada numeração: notas de compra, baixas da produção, cancelamentos e ajustes."
      />

      <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="mg-ini">De</Label>
          <Input
            id="mg-ini"
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mg-fim">Até</Label>
          <Input id="mg-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={origem} onValueChange={setOrigem}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos</SelectItem>
              {Object.entries(ORIGENS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Tamanho</Label>
          <Select value={tamanho} onValueChange={setTamanho}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {tamanhos.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mg-busca">Produto ou documento</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="mg-busca"
              className="pl-8"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Ex.: tira slim, Pedido 12"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Entradas (pares)"
          value={num(entradas)}
          icon={ArrowUpCircle}
          tone="success"
        />
        <StatCard label="Saídas (pares)" value={num(saidas)} icon={ArrowDownCircle} tone="danger" />
        <StatCard label="Movimentos" value={String(linhas.length)} icon={Boxes} />
      </div>

      {resumo.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold">Baixado na produção por tamanho</h2>
          <div className="flex flex-wrap gap-2">
            {resumo.map(([t, q]) => (
              <div key={t} className="rounded-md border px-3 py-2 text-center">
                <div className="text-xs text-muted-foreground">{t}</div>
                <div className="font-semibold">{num(q)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhum movimento no período"
          description="Mude as datas ou os filtros."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Depósito</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Saldo depois</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((m) => {
                const o = ORIGENS[m.origem] ?? { label: "Outro", variant: "outline" as const };
                const q = Number(m.quantidade);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{dateTimeBR(m.created_at)}</TableCell>
                    <TableCell>
                      {m.produtos?.codigo_interno ? (
                        <span className="text-muted-foreground">
                          {m.produtos.codigo_interno} ·{" "}
                        </span>
                      ) : null}
                      {m.produtos?.descricao ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{m.tamanho}</TableCell>
                    <TableCell>
                      <Badge variant={o.variant}>{o.label}</Badge>
                    </TableCell>
                    <TableCell>{m.documento ?? "—"}</TableCell>
                    <TableCell>{m.depositos?.nome ?? "—"}</TableCell>
                    <TableCell
                      className={`text-right font-semibold ${q < 0 ? "text-destructive" : "text-primary"}`}
                    >
                      {q > 0 ? "+" : ""}
                      {num(q)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.saldo_apos === 0 && m.documento && m.origem !== "ajuste"
                        ? "—"
                        : num(Number(m.saldo_apos))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
