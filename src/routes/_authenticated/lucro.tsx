import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins, HandCoins, Percent, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { rotuloMes, usePeriodo } from "@/lib/periodo";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/lucro")({
  head: () => ({
    meta: [
      { title: "Relatório de lucro — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Custo de aquisição, margem e lucro por produto, por depósito e por período nas vendas da loja.",
      },
      { property: "og:title", content: "Relatório de lucro — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Lucro e margem por produto, depósito e período no ERP Ze Tech.",
      },
    ],
  }),
  component: Lucro,
});

function Lucro() {
  const { periodo, setDe, setAte } = usePeriodo();
  const de = periodo.de;
  const ate = periodo.ate;
  const [deposito, setDeposito] = useState("todos");
  const [agrupar, setAgrupar] = useState<"produto" | "deposito" | "periodo">("produto");

  const { data: depositos } = useQuery({
    queryKey: ["depositos-lucro"],
    queryFn: async () => {
      const { data, error } = await supabase.from("depositos").select("id, nome").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["lucro", de, ate, deposito],
    queryFn: async () => {
      let q = supabase
        .from("pedidos")
        .select(
          "id, numero, created_at, situacao, deposito_id, depositos(nome), pedido_itens(quantidade, preco_unitario, custo_unitario, desconto, total, produto_id, produtos(descricao, codigo_interno, unidade))",
        )
        .neq("situacao", "cancelado")
        .gte("created_at", `${de}T00:00:00`)
        .lte("created_at", `${ate}T23:59:59`);
      if (deposito !== "todos") q = q.eq("deposito_id", deposito);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhas = useMemo(() => {
    type L = {
      chave: string;
      nome: string;
      detalhe: string;
      qtd: number;
      receita: number;
      custo: number;
    };
    const mapa = new Map<string, L>();
    for (const p of data ?? []) {
      const dep = (p.depositos as { nome: string } | null)?.nome ?? "—";
      for (const i of (p.pedido_itens ?? []) as Array<{
        quantidade: number;
        custo_unitario: number;
        total: number;
        produto_id: string;
        produtos: { descricao: string; codigo_interno: string; unidade: string } | null;
      }>) {
        const mes = String(p.created_at).slice(0, 7);
        const chave = agrupar === "produto" ? i.produto_id : agrupar === "deposito" ? dep : mes;
        const nome =
          agrupar === "produto"
            ? (i.produtos?.descricao ?? "produto removido")
            : agrupar === "deposito"
              ? dep
              : mes.split("-").reverse().join("/");
        const detalhe =
          agrupar === "produto"
            ? (i.produtos?.codigo_interno ?? "")
            : agrupar === "deposito"
              ? "depósito"
              : "mês";
        const atual = mapa.get(chave) ?? { chave, nome, detalhe, qtd: 0, receita: 0, custo: 0 };
        atual.qtd += Number(i.quantidade);
        atual.receita += Number(i.total);
        atual.custo += Number(i.quantidade) * Number(i.custo_unitario);
        mapa.set(chave, atual);
      }
    }
    return [...mapa.values()]
      .map((l) => ({
        ...l,
        lucro: l.receita - l.custo,
        margem: l.receita > 0 ? ((l.receita - l.custo) / l.receita) * 100 : 0,
      }))
      .sort((a, b) => b.lucro - a.lucro);
  }, [data, agrupar]);

  const totais = useMemo(() => {
    const receita = linhas.reduce((s, l) => s + l.receita, 0);
    const custo = linhas.reduce((s, l) => s + l.custo, 0);
    return {
      receita,
      custo,
      lucro: receita - custo,
      margem: receita > 0 ? ((receita - custo) / receita) * 100 : 0,
    };
  }, [linhas]);

  const porMes = useMemo(() => {
    const mapa = new Map<string, { mes: string; receita: number; custo: number }>();
    for (const p of data ?? []) {
      const mes = String(p.created_at).slice(0, 7);
      for (const i of (p.pedido_itens ?? []) as Array<{
        quantidade: number;
        custo_unitario: number;
        total: number;
      }>) {
        const atual = mapa.get(mes) ?? { mes, receita: 0, custo: 0 };
        atual.receita += Number(i.total);
        atual.custo += Number(i.quantidade) * Number(i.custo_unitario);
        mapa.set(mes, atual);
      }
    }
    return [...mapa.values()]
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((m) => ({
        nome: rotuloMes(m.mes),
        receita: Math.round(m.receita),
        custo: Math.round(m.custo),
        lucro: Math.round(m.receita - m.custo),
        margem: m.receita > 0 ? ((m.receita - m.custo) / m.receita) * 100 : 0,
      }));
  }, [data]);

  const grafico = linhas.slice(0, 10).map((l) => ({
    nome: l.nome.length > 18 ? `${l.nome.slice(0, 18)}…` : l.nome,
    lucro: Math.round(l.lucro),
  }));

  return (
    <div>
      <PageHeader
        title="Relatório de lucro"
        description="Custo de aquisição, margem e lucro por produto, por depósito e por período."
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label>De</Label>
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">Mesmo período do dashboard.</p>
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div>
          <Label>Depósito</Label>
          <Select value={deposito} onValueChange={setDeposito}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os depósitos</SelectItem>
              {(depositos ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Agrupar por</Label>
          <Select value={agrupar} onValueChange={(v) => setAgrupar(v as typeof agrupar)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="produto">Produto</SelectItem>
              <SelectItem value="deposito">Depósito</SelectItem>
              <SelectItem value="periodo">Período (mês)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Receita das vendas"
          value={brl(totais.receita)}
          icon={Coins}
          tone="accent"
        />
        <StatCard
          label="Custo de aquisição"
          value={brl(totais.custo)}
          icon={HandCoins}
          tone="warning"
        />
        <StatCard label="Lucro bruto" value={brl(totais.lucro)} icon={TrendingUp} tone="success" />
        <StatCard label="Margem média" value={`${num(totais.margem, 1)}%`} icon={Percent} />
      </div>

      {porMes.length > 0 && (
        <div className="panel mt-4 p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">
            Receita, custo e lucro por mês
          </h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={porMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => brl(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="receita"
                  name="Receita"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="custo"
                  name="Custo"
                  stroke="var(--chart-4)"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="lucro"
                  name="Lucro"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Lucro</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porMes.map((m) => (
                  <TableRow key={m.nome}>
                    <TableCell>{m.nome}</TableCell>
                    <TableCell className="text-numeric text-right">{brl(m.receita)}</TableCell>
                    <TableCell className="text-numeric text-right">{brl(m.custo)}</TableCell>
                    <TableCell
                      className={`text-numeric text-right font-semibold ${
                        m.lucro >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {brl(m.lucro)}
                    </TableCell>
                    <TableCell className="text-numeric text-right">{num(m.margem, 1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {grafico.length > 0 && (
        <div className="panel mt-4 p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Maiores lucros</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="nome"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-20}
                  height={50}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => brl(Number(v))} />
                <Bar dataKey="lucro" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="panel mt-4 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        ) : linhas.length === 0 ? (
          <EmptyState
            title="Nenhuma venda no período"
            description="Ajuste as datas ou o depósito para ver o lucro."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {agrupar === "produto" ? "Produto" : agrupar === "deposito" ? "Depósito" : "Mês"}
                </TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead className="text-right">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell>
                    {l.nome}
                    {l.detalhe && agrupar === "produto" && (
                      <span className="block text-xs text-muted-foreground">{l.detalhe}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-numeric text-right">{num(l.qtd, 2)}</TableCell>
                  <TableCell className="text-numeric text-right">{brl(l.receita)}</TableCell>
                  <TableCell className="text-numeric text-right">{brl(l.custo)}</TableCell>
                  <TableCell
                    className={`text-numeric text-right font-semibold ${
                      l.lucro >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {brl(l.lucro)}
                  </TableCell>
                  <TableCell className="text-numeric text-right">{num(l.margem, 1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
