import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Coins, ListChecks, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR, num } from "@/lib/format";
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

export const Route = createFileRoute("/_authenticated/inventarios")({
  head: () => ({
    meta: [
      { title: "Balanço de estoque — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Contagem de estoque por depósito: quantidade do sistema, quantidade contada, diferença em unidades e em reais, com ajuste automático no histórico.",
      },
      { property: "og:title", content: "Balanço de estoque — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Contagem por depósito com diferença em unidades e em reais.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Inventarios,
});

type ItemProduto = {
  descricao: string;
  codigo_interno: string;
  codigo_barras: string | null;
  unidade: string;
  localizacao: string | null;
};

const corSituacao: Record<string, string> = {
  contando: "bg-info/15 text-info",
  aplicado: "bg-success/15 text-success",
  cancelado: "bg-secondary text-secondary-foreground",
};

const labelSituacao: Record<string, string> = {
  contando: "Em contagem",
  aplicado: "Aplicado",
  cancelado: "Cancelado",
};

function Inventarios() {
  const qc = useQueryClient();
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState({ aberto: false, deposito_id: "", descricao: "" });
  const [contagens, setContagens] = useState<Record<string, string>>({});

  const { data: depositos } = useQuery({
    queryKey: ["depositos-inventario"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: lista, isLoading } = useQuery({
    queryKey: ["inventarios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventarios")
        .select("id, descricao, situacao, observacao, aplicado_em, created_at, depositos(nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const inventarioId = abertoId ?? lista?.find((i) => i.situacao === "contando")?.id ?? null;
  const inventario = lista?.find((i) => i.id === inventarioId) ?? null;

  const { data: itens } = useQuery({
    queryKey: ["inventario-itens", inventarioId],
    enabled: Boolean(inventarioId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventario_itens")
        .select(
          "id, produto_id, quantidade_sistema, quantidade_contada, custo_unitario, observacao, produtos(descricao, codigo_interno, codigo_barras, unidade, localizacao)",
        )
        .eq("inventario_id", inventarioId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (itens ?? [])
      .map((it) => {
        const p = it.produtos as unknown as ItemProduto;
        const contadaSalva = it.quantidade_contada === null ? null : Number(it.quantidade_contada);
        const rascunho = contagens[it.id];
        const contada =
          rascunho !== undefined && rascunho !== ""
            ? Number(rascunho.replace(",", "."))
            : contadaSalva;
        const sistema = Number(it.quantidade_sistema);
        const diferenca = contada === null || Number.isNaN(contada) ? null : contada - sistema;
        const custo = Number(it.custo_unitario);
        return {
          it,
          p,
          sistema,
          contada,
          contadaSalva,
          custo,
          diferenca,
          valorDiferenca: diferenca === null ? 0 : diferenca * custo,
        };
      })
      .filter((l) => {
        if (!l.p) return false;
        if (!termo) return true;
        return [l.p.descricao, l.p.codigo_interno, l.p.codigo_barras, l.p.localizacao]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(termo));
      })
      .sort((a, b) => a.p.descricao.localeCompare(b.p.descricao));
  }, [itens, busca, contagens]);

  const resumo = useMemo(() => {
    const todos = (itens ?? []).map((it) => {
      const contada = it.quantidade_contada === null ? null : Number(it.quantidade_contada);
      const dif = contada === null ? null : contada - Number(it.quantidade_sistema);
      return { dif, valor: dif === null ? 0 : dif * Number(it.custo_unitario) };
    });
    const contados = todos.filter((x) => x.dif !== null);
    const divergentes = contados.filter((x) => Number(x.dif) !== 0);
    return {
      total: todos.length,
      contados: contados.length,
      divergentes: divergentes.length,
      sobra: divergentes.filter((x) => Number(x.dif) > 0).reduce((s, x) => s + x.valor, 0),
      falta: divergentes.filter((x) => Number(x.dif) < 0).reduce((s, x) => s + x.valor, 0),
    };
  }, [itens]);

  const invalidar = () => {
    for (const key of [
      "inventarios",
      "inventario-itens",
      "estoque",
      "estoque-movimentos",
      "deposito",
      "depositos",
      "movimentacoes",
      "balanco-fiscal",
      "dashboard",
      "alertas",
    ])
      qc.invalidateQueries({ queryKey: [key] });
  };

  const abrirContagem = useMutation({
    mutationFn: async () => {
      if (!novo.deposito_id) throw new Error("Escolha o depósito");
      const { data, error } = await supabase.rpc("inventario_abrir", {
        p_deposito_id: novo.deposito_id,
        ...(novo.descricao ? { p_descricao: novo.descricao } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Contagem aberta com o saldo atual do depósito");
      setNovo({ aberto: false, deposito_id: "", descricao: "" });
      setContagens({});
      setAbertoId(id);
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível abrir", { description: e.message }),
  });

  const salvarItem = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: string }) => {
      const contada = valor === "" ? null : Number(valor.replace(",", "."));
      if (contada !== null && Number.isNaN(contada)) throw new Error("Quantidade inválida");
      const { error } = await supabase.rpc("inventario_contar", {
        p_item_id: id,
        // limpar a contagem manda vazio de propósito — o item volta a "não contado"
        p_contada: contada as unknown as number,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      setContagens((c) => {
        const { [v.id]: _omit, ...resto } = c;
        return resto;
      });
      qc.invalidateQueries({ queryKey: ["inventario-itens", inventarioId] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível salvar a contagem", { description: e.message }),
  });

  const aplicar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("inventario_aplicar", {
        p_inventario_id: inventarioId!,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      toast.success(
        n > 0
          ? `Balanço aplicado — ${n} produto(s) ajustado(s)`
          : "Balanço aplicado sem diferenças",
      );
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível aplicar", { description: e.message }),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("inventario_cancelar", {
        p_inventario_id: inventarioId!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contagem cancelada");
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  const emContagem = inventario?.situacao === "contando";

  return (
    <div>
      <PageHeader
        title="Balanço de estoque"
        description="Conte o depósito produto por produto: o sistema mostra a diferença em unidades e em reais e aplica os ajustes no histórico."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setNovo({ ...novo, aberto: true })}>
              Nova contagem
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/estoque-movimentos">Entradas e saídas</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/movimentacoes">Histórico</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="panel p-4">
          <h2 className="font-display text-sm font-semibold">Contagens</h2>
          {isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
          ) : (lista ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhuma contagem ainda. Abra a primeira pelo botão “Nova contagem”.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(lista ?? []).map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAbertoId(i.id);
                      setContagens({});
                    }}
                    className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                      i.id === inventarioId ? "border-primary bg-primary/5" : "hover:bg-muted/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {(i.depositos as unknown as { nome: string } | null)?.nome ?? "Depósito"}
                      </span>
                      <Badge className={corSituacao[i.situacao] ?? "bg-secondary"}>
                        {labelSituacao[i.situacao] ?? i.situacao}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {i.descricao ? `${i.descricao} · ` : ""}
                      {dateTimeBR(i.created_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {!inventario ? (
            <EmptyState
              title="Escolha ou abra uma contagem"
              description="A contagem fotografa o saldo atual do depósito e compara com o que você contar na prateleira."
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Produtos contados"
                  value={`${num(resumo.contados, 0)} / ${num(resumo.total, 0)}`}
                  icon={ListChecks}
                />
                <StatCard
                  label="Com diferença"
                  value={num(resumo.divergentes, 0)}
                  icon={ClipboardCheck}
                  tone="warning"
                />
                <StatCard
                  label="Sobra em valor"
                  value={brl(resumo.sobra)}
                  icon={Coins}
                  tone="success"
                />
                <StatCard
                  label="Falta em valor"
                  value={brl(Math.abs(resumo.falta))}
                  icon={Coins}
                  tone="accent"
                />
              </div>

              <div className="panel mt-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-sm font-semibold">
                      {(inventario.depositos as unknown as { nome: string } | null)?.nome ??
                        "Depósito"}
                      {inventario.descricao ? ` — ${inventario.descricao}` : ""}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {emContagem
                        ? "Digite a quantidade contada; ela é salva ao sair do campo."
                        : inventario.situacao === "aplicado"
                          ? `Aplicado em ${dateTimeBR(inventario.aplicado_em)} — os ajustes estão no histórico.`
                          : "Contagem cancelada — nada foi ajustado."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative sm:w-64">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Produto, código, localização…"
                        className="pl-8"
                      />
                    </div>
                    {emContagem && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => aplicar.mutate()}
                          disabled={aplicar.isPending || resumo.contados === 0}
                        >
                          {aplicar.isPending ? "Aplicando…" : "Aplicar balanço"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelar.mutate()}
                          disabled={cancelar.isPending}
                        >
                          Cancelar contagem
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {linhas.length === 0 ? (
                  <EmptyState
                    className="mt-4 border-0 shadow-none"
                    title="Nenhum produto nesta contagem"
                    description="Este depósito não tinha saldo de produtos ativos quando a contagem foi aberta."
                  />
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead>Localização</TableHead>
                          <TableHead className="text-right">Sistema</TableHead>
                          <TableHead className="text-right">Contado</TableHead>
                          <TableHead className="text-right">Diferença</TableHead>
                          <TableHead className="text-right">Custo real</TableHead>
                          <TableHead className="text-right">Diferença em R$</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linhas.map((l) => (
                          <TableRow key={l.it.id}>
                            <TableCell>
                              <div className="font-medium">{l.p.descricao}</div>
                              <div className="text-numeric text-xs text-muted-foreground">
                                {l.p.codigo_interno} · {l.p.unidade}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {l.p.localizacao ?? "—"}
                            </TableCell>
                            <TableCell className="text-numeric text-right">
                              {num(l.sistema)}
                            </TableCell>
                            <TableCell className="text-right">
                              {emContagem ? (
                                <Input
                                  inputMode="decimal"
                                  className="ml-auto h-9 w-28 text-right"
                                  value={
                                    contagens[l.it.id] ??
                                    (l.contadaSalva === null ? "" : String(l.contadaSalva))
                                  }
                                  onChange={(e) =>
                                    setContagens((c) => ({ ...c, [l.it.id]: e.target.value }))
                                  }
                                  onBlur={(e) => {
                                    const valor = e.target.value;
                                    const anterior =
                                      l.contadaSalva === null ? "" : String(l.contadaSalva);
                                    if (valor !== anterior)
                                      salvarItem.mutate({ id: l.it.id, valor });
                                  }}
                                  placeholder="—"
                                />
                              ) : (
                                <span className="text-numeric">
                                  {l.contadaSalva === null ? "não contado" : num(l.contadaSalva)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-numeric text-right font-medium ${
                                l.diferenca === null
                                  ? "text-muted-foreground"
                                  : l.diferenca < 0
                                    ? "text-destructive"
                                    : l.diferenca > 0
                                      ? "text-success"
                                      : ""
                              }`}
                            >
                              {l.diferenca === null
                                ? "—"
                                : `${l.diferenca > 0 ? "+" : ""}${num(l.diferenca)}`}
                            </TableCell>
                            <TableCell className="text-numeric text-right">
                              {brl(l.custo)}
                            </TableCell>
                            <TableCell
                              className={`text-numeric text-right ${
                                l.valorDiferenca < 0 ? "text-destructive" : ""
                              }`}
                            >
                              {l.diferenca === null ? "—" : brl(l.valorDiferenca)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={novo.aberto} onOpenChange={(v) => setNovo({ ...novo, aberto: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova contagem de estoque</DialogTitle>
            <DialogDescription>
              O saldo atual do depósito é fotografado agora; nada muda no estoque até você aplicar o
              balanço.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Depósito</Label>
              <Select
                value={novo.deposito_id}
                onValueChange={(v) => setNovo({ ...novo, deposito_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o depósito" />
                </SelectTrigger>
                <SelectContent>
                  {(depositos ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={novo.descricao}
                onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
                placeholder="Ex.: balanço de setembro"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo({ ...novo, aberto: false })}>
              Cancelar
            </Button>
            <Button onClick={() => abrirContagem.mutate()} disabled={abrirContagem.isPending}>
              {abrirContagem.isPending ? "Abrindo…" : "Abrir contagem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
