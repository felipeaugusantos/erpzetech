import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Coins, Search, Boxes } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR, num } from "@/lib/format";
import { usePeriodo } from "@/lib/periodo";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/estoque-movimentos")({
  head: () => ({
    meta: [
      { title: "Entradas e saídas de estoque — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Registre entradas e saídas por depósito com custo real, acompanhe o saldo valorizado e leve os valores para o balanço fiscal.",
      },
      { property: "og:title", content: "Entradas e saídas de estoque — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Movimentação de estoque por depósito com custo real e saldo valorizado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EstoqueMovimentos,
});

type ProdutoLinha = {
  descricao: string;
  codigo_interno: string;
  codigo_barras: string | null;
  unidade: string;
  custo: number;
};

const entradas = ["entrada", "transferencia_entrada"];
const saidas = ["saida", "transferencia_saida"];

function EstoqueMovimentos() {
  const qc = useQueryClient();
  const { periodo, setDe, setAte } = usePeriodo();
  const [depositoSel, setDepositoSel] = useState("");
  const [busca, setBusca] = useState("");

  const [form, setForm] = useState({
    aberto: false,
    tipo: "entrada" as "entrada" | "saida",
    produto_id: "",
    quantidade: "",
    custo: "",
    documento: "",
    motivo: "",
  });

  const { data: depositos } = useQuery({
    queryKey: ["depositos-mov"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome, filiais(nome)")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const depositoId = depositoSel || depositos?.[0]?.id || "";

  const { data, isLoading } = useQuery({
    queryKey: ["estoque-movimentos", depositoId, periodo.de, periodo.ate],
    enabled: Boolean(depositoId),
    queryFn: async () => {
      const [saldos, movs] = await Promise.all([
        supabase
          .from("estoques")
          .select(
            "id, quantidade, reservado, custo_medio, produto_id, produtos(descricao, codigo_interno, codigo_barras, unidade, custo)",
          )
          .eq("deposito_id", depositoId),
        supabase
          .from("estoque_movimentacoes")
          .select(
            "id, tipo, produto_id, quantidade, custo_unitario, valor_total, saldo_anterior, saldo_posterior, unidade, documento, motivo, created_at, produtos(descricao, codigo_interno)",
          )
          .eq("deposito_id", depositoId)
          .gte("created_at", `${periodo.de}T00:00:00`)
          .lte("created_at", `${periodo.ate}T23:59:59`)
          .order("created_at", { ascending: false })
          .limit(400),
      ]);
      if (saldos.error) throw saldos.error;
      if (movs.error) throw movs.error;
      return { saldos: saldos.data ?? [], movs: movs.data ?? [] };
    },
  });

  /** Movimentações antigas sem custo gravado usam o custo atual do depósito. */
  const custoDoProduto = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const s of data?.saldos ?? []) {
      const p = s.produtos as unknown as ProdutoLinha | null;
      const custo = Number(s.custo_medio) > 0 ? Number(s.custo_medio) : Number(p?.custo ?? 0);
      mapa.set(s.produto_id, custo);
    }
    return mapa;
  }, [data?.saldos]);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.saldos ?? [])
      .map((s) => {
        const p = s.produtos as unknown as ProdutoLinha;
        const fisico = Number(s.quantidade);
        const reservado = Number(s.reservado);
        const custo = Number(s.custo_medio) > 0 ? Number(s.custo_medio) : Number(p?.custo ?? 0);
        return {
          s,
          p,
          fisico,
          reservado,
          custo,
          disponivel: fisico - reservado,
          valor: fisico * custo,
        };
      })
      .filter((l) => {
        if (!l.p) return false;
        if (!termo) return true;
        return [l.p.descricao, l.p.codigo_interno, l.p.codigo_barras]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(termo));
      })
      .sort((a, b) => a.p.descricao.localeCompare(b.p.descricao));
  }, [data?.saldos, busca]);

  const movs = useMemo(
    () =>
      (data?.movs ?? []).map((m) => {
        const custo =
          Number(m.custo_unitario) > 0
            ? Number(m.custo_unitario)
            : (custoDoProduto.get(String((m as { produto_id?: string }).produto_id ?? "")) ?? 0);
        const valor =
          Number(m.valor_total) > 0 ? Number(m.valor_total) : Number(m.quantidade) * custo;
        return { m, custo, valor };
      }),
    [data?.movs, custoDoProduto],
  );

  const resumo = useMemo(() => {
    const entrada = movs.filter((x) => entradas.includes(x.m.tipo));
    const saida = movs.filter((x) => saidas.includes(x.m.tipo));
    const balanco = movs.filter((x) => x.m.tipo === "inventario" || x.m.tipo === "ajuste");
    return {
      entradaValor: entrada.reduce((s, x) => s + x.valor, 0),
      entradaQtd: entrada.length,
      saidaValor: saida.reduce((s, x) => s + x.valor, 0),
      saidaQtd: saida.length,
      balancoQtd: balanco.length,
      estoqueValor: linhas.reduce((s, l) => s + l.valor, 0),
    };
  }, [movs, linhas]);

  const invalidar = () => {
    for (const key of [
      "estoque-movimentos",
      "estoque",
      "deposito",
      "depositos",
      "movimentacoes",
      "balanco-fiscal",
      "dashboard",
      "alertas",
      "inventarios",
    ])
      qc.invalidateQueries({ queryKey: [key] });
  };

  const registrar = useMutation({
    mutationFn: async () => {
      const quantidade = Number(form.quantidade.replace(",", "."));
      if (!form.produto_id) throw new Error("Escolha o produto");
      if (!(quantidade > 0)) throw new Error("Informe uma quantidade maior que zero");
      const custo = Number(form.custo.replace(",", "."));
      const { error } = await supabase.rpc("registrar_movimentacao", {
        p_produto_id: form.produto_id,
        p_deposito_id: depositoId,
        p_tipo: form.tipo,
        p_quantidade: quantidade,
        ...(form.tipo === "entrada" && custo > 0 ? { p_custo: custo } : {}),
        ...(form.motivo ? { p_motivo: form.motivo } : {}),
        ...(form.documento ? { p_documento: form.documento } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.tipo === "entrada" ? "Entrada registrada" : "Saída registrada");
      setForm({ ...form, aberto: false, quantidade: "", custo: "", documento: "", motivo: "" });
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const abrir = (tipo: "entrada" | "saida") =>
    setForm({
      aberto: true,
      tipo,
      produto_id: "",
      quantidade: "",
      custo: "",
      documento: "",
      motivo: "",
    });

  const produtoEscolhido = linhas.find((l) => l.s.produto_id === form.produto_id);
  const depositoNome = depositos?.find((d) => d.id === depositoId)?.nome ?? "";

  return (
    <div>
      <PageHeader
        title="Entradas e saídas de estoque"
        description="Cada movimento guarda o custo real e o saldo do depósito — os valores alimentam o balanço fiscal."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => abrir("entrada")}>
              Registrar entrada
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("saida")}>
              Registrar saída
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/inventarios">Balanço de estoque</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/balanco-fiscal">Balanço fiscal</Link>
            </Button>
          </div>
        }
      />

      <div className="panel mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <Label className="text-xs">Depósito</Label>
          <Select value={depositoId} onValueChange={setDepositoSel}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha o depósito" />
            </SelectTrigger>
            <SelectContent>
              {(depositos ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                  {(d.filiais as unknown as { nome: string } | null)?.nome
                    ? ` · ${(d.filiais as unknown as { nome: string }).nome}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-40">
          <Label className="text-xs">De</Label>
          <Input type="date" value={periodo.de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="sm:w-40">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={periodo.ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground sm:pb-2">
          Mesmo período do painel e do balanço fiscal.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Entradas no período"
          value={brl(resumo.entradaValor)}
          hint={`${resumo.entradaQtd} movimento(s)`}
          icon={ArrowDownCircle}
          tone="success"
        />
        <StatCard
          label="Saídas no período"
          value={brl(resumo.saidaValor)}
          hint={`${resumo.saidaQtd} movimento(s)`}
          icon={ArrowUpCircle}
          tone="warning"
        />
        <StatCard
          label="Ajustes de balanço"
          value={num(resumo.balancoQtd, 0)}
          hint="Contagens e correções"
          icon={Boxes}
          tone="accent"
        />
        <StatCard
          label="Estoque a custo"
          value={brl(resumo.estoqueValor)}
          hint={depositoNome ? `Saldo atual em ${depositoNome}` : "Saldo atual"}
          icon={Coins}
        />
      </div>

      <div className="panel mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold">Saldo por produto neste depósito</h2>
          <div className="relative sm:w-72">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Produto, código, código de barras…"
              className="pl-8"
            />
          </div>
        </div>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        ) : linhas.length === 0 ? (
          <EmptyState
            className="mt-4 border-0 shadow-none"
            title="Nenhum produto neste depósito"
            description="Registre uma entrada para começar o saldo deste depósito."
          />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Físico</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Custo real</TableHead>
                  <TableHead className="text-right">Valor em estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.s.id}>
                    <TableCell>
                      <div className="font-medium">{l.p.descricao}</div>
                      <div className="text-numeric text-xs text-muted-foreground">
                        {l.p.codigo_interno} · {l.p.unidade}
                      </div>
                    </TableCell>
                    <TableCell className="text-numeric text-right">{num(l.fisico)}</TableCell>
                    <TableCell className="text-numeric text-right">{num(l.reservado)}</TableCell>
                    <TableCell className="text-numeric text-right font-medium">
                      {num(l.disponivel)}
                    </TableCell>
                    <TableCell className="text-numeric text-right">{brl(l.custo)}</TableCell>
                    <TableCell className="text-numeric text-right font-semibold">
                      {brl(l.valor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="panel mt-4 p-4">
        <h2 className="font-display text-sm font-semibold">Movimentos do período</h2>
        {movs.length === 0 ? (
          <EmptyState
            className="mt-4 border-0 shadow-none"
            title="Nenhum movimento no período"
            description="Registre uma entrada ou saída, ou amplie o período."
          />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data / hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Custo real</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Saldo depois</TableHead>
                  <TableHead>Documento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movs.map(({ m, custo, valor }) => {
                  const p = m.produtos as unknown as {
                    descricao: string;
                    codigo_interno: string;
                  } | null;
                  const saida = saidas.includes(m.tipo);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateTimeBR(m.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            saida
                              ? "bg-destructive/15 text-destructive capitalize"
                              : entradas.includes(m.tipo)
                                ? "bg-success/15 text-success capitalize"
                                : "bg-secondary text-secondary-foreground capitalize"
                          }
                        >
                          {m.tipo.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{p?.descricao ?? "—"}</div>
                        <div className="text-numeric text-xs text-muted-foreground">
                          {p?.codigo_interno ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-numeric text-right">
                        {saida ? "−" : ""}
                        {num(m.quantidade)} {m.unidade ?? ""}
                      </TableCell>
                      <TableCell className="text-numeric text-right">{brl(custo)}</TableCell>
                      <TableCell
                        className={`text-numeric text-right font-medium ${saida ? "text-destructive" : ""}`}
                      >
                        {brl(valor)}
                      </TableCell>
                      <TableCell className="text-numeric text-right">
                        {num(m.saldo_posterior)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.documento ?? m.motivo ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={form.aberto} onOpenChange={(v) => setForm({ ...form, aberto: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.tipo === "entrada" ? "Entrada de estoque" : "Saída de estoque"}
            </DialogTitle>
            <DialogDescription>
              {form.tipo === "entrada"
                ? `O custo informado entra na média do depósito ${depositoNome}.`
                : `A saída baixa o saldo disponível do depósito ${depositoNome}, pelo custo real.`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Produto</Label>
              <Select
                value={form.produto_id}
                onValueChange={(v) => setForm({ ...form, produto_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o produto" />
                </SelectTrigger>
                <SelectContent>
                  {linhas.map((l) => (
                    <SelectItem key={l.s.produto_id} value={l.s.produto_id}>
                      {l.p.descricao} · {num(l.disponivel)} {l.p.unidade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {produtoEscolhido && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Disponível {num(produtoEscolhido.disponivel)} {produtoEscolhido.p.unidade} · custo
                  atual {brl(produtoEscolhido.custo)}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Quantidade</Label>
                <Input
                  inputMode="decimal"
                  value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                  placeholder="0"
                />
              </div>
              {form.tipo === "entrada" && (
                <div>
                  <Label className="text-xs">Custo de aquisição (unitário)</Label>
                  <Input
                    inputMode="decimal"
                    value={form.custo}
                    onChange={(e) => setForm({ ...form, custo: e.target.value })}
                    placeholder={produtoEscolhido ? String(produtoEscolhido.custo) : "0,00"}
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">Documento (nota, pedido, romaneio)</Label>
              <Input
                value={form.documento}
                onChange={(e) => setForm({ ...form, documento: e.target.value })}
                placeholder="Opcional"
              />
            </div>

            <div>
              <Label className="text-xs">Motivo</Label>
              <Textarea
                value={form.motivo}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Opcional — fica gravado no histórico"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm({ ...form, aberto: false })}>
              Cancelar
            </Button>
            <Button onClick={() => registrar.mutate()} disabled={registrar.isPending}>
              {registrar.isPending ? "Registrando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
