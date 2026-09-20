import { useMemo, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, PackageOpen, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/devolucoes")({
  validateSearch: (search: Record<string, unknown>) => ({
    pedido: typeof search["pedido"] === "string" ? (search["pedido"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Devoluções de venda — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Devolva itens do pedido com volta ao estoque, abatimento no financeiro e nota fiscal de entrada.",
      },
      { property: "og:title", content: "Devoluções de venda — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Registre a devolução pelo pedido ou com nota fiscal de entrada.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Devolucoes,
});

const hojeISO = () => new Date().toISOString().slice(0, 10);

type ItemForm = { pedido_item_id: string; quantidade: string };

function Devolucoes() {
  const busca0 = useSearch({ from: "/_authenticated/devolucoes" });
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(!!busca0.pedido);
  const [pedidoId, setPedidoId] = useState(busca0.pedido ?? "");
  const [modo, setModo] = useState("pedido");
  const [motivo, setMotivo] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [abater, setAbater] = useState("sim");
  const [itens, setItens] = useState<Record<string, ItemForm>>({});

  const { data: devolucoes = [], isLoading } = useQuery({
    queryKey: ["devolucoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devolucoes")
        .select("*, clientes(nome), pedidos(numero), depositos(nome), devolucao_itens(id)")
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ["pedidos-devolucao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedidos")
        .select("id, numero, total, created_at, deposito_id, clientes(nome)")
        .neq("situacao", "cancelado")
        .order("numero", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: depositos = [] } = useQuery({
    queryKey: ["depositos-devolucao"],
    queryFn: async () => {
      const { data, error } = await supabase.from("depositos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: itensPedido = [] } = useQuery({
    queryKey: ["pedido-itens-devolucao", pedidoId],
    enabled: !!pedidoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedido_itens")
        .select("id, quantidade, unidade, preco_unitario, produtos(descricao, codigo_interno)")
        .eq("pedido_id", pedidoId);
      if (error) throw error;
      return data;
    },
  });

  const { data: jaDevolvidos = [] } = useQuery({
    queryKey: ["devolvidos-do-pedido", pedidoId],
    enabled: !!pedidoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devolucao_itens")
        .select("pedido_item_id, quantidade, devolucoes!inner(pedido_id)")
        .eq("devolucoes.pedido_id", pedidoId);
      if (error) throw error;
      return data;
    },
  });

  const devolvidoPorItem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of jaDevolvidos) {
      if (!d.pedido_item_id) continue;
      m[d.pedido_item_id] = (m[d.pedido_item_id] ?? 0) + Number(d.quantidade ?? 0);
    }
    return m;
  }, [jaDevolvidos]);

  const pedidoEscolhido = pedidos.find((p) => p.id === pedidoId);

  const totalDevolucao = useMemo(
    () =>
      itensPedido.reduce((s, i) => {
        const q = Number((itens[i.id]?.quantidade ?? "0").replace(",", ".") || 0);
        return s + q * Number(i.preco_unitario ?? 0);
      }, 0),
    [itensPedido, itens],
  );

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return devolucoes;
    return devolucoes.filter((d) =>
      [d.clientes?.nome, d.pedidos?.numero, d.numero, d.motivo]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [devolucoes, busca]);

  const limpar = () => {
    setPedidoId("");
    setItens({});
    setMotivo("");
    setDepositoId("");
    setModo("pedido");
    setAbater("sim");
  };

  const registrar = useMutation({
    mutationFn: async () => {
      if (!pedidoId) throw new Error("Escolha o pedido");
      const payload = itensPedido
        .map((i) => ({
          pedido_item_id: i.id,
          quantidade: Number((itens[i.id]?.quantidade ?? "0").replace(",", ".") || 0),
        }))
        .filter((i) => i.quantidade > 0);
      if (payload.length === 0) throw new Error("Informe a quantidade devolvida de pelo menos um item");
      const { error } = await supabase.rpc("devolucao_registrar", {
        p_pedido_id: pedidoId,
        p_itens: payload,
        p_modo: modo,
        p_motivo: motivo || "",
        p_abater_receber: abater === "sim",
        ...(depositoId ? { p_deposito_id: depositoId } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        modo === "nota"
          ? "Devolução registrada com nota fiscal de entrada."
          : "Devolução registrada com base no pedido.",
      );
      setAberto(false);
      limpar();
      void queryClient.invalidateQueries({ queryKey: ["devolucoes"] });
      void queryClient.invalidateQueries({ queryKey: ["estoques"] });
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doMes = devolucoes.filter((d) => String(d.created_at).slice(0, 7) === hojeISO().slice(0, 7));

  return (
    <div>
      <PageHeader
        title="Devoluções de venda"
        description="Devolva itens do pedido: o estoque volta ao depósito, o financeiro é abatido e a nota de entrada é opcional."
        actions={
          <Button
            onClick={() => {
              limpar();
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Nova devolução
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Devoluções" value={String(devolucoes.length)} icon={RotateCcw} />
        <StatCard label="No mês" value={String(doMes.length)} icon={PackageOpen} tone="accent" />
        <StatCard
          label="Valor devolvido"
          value={brl(devolucoes.reduce((s, d) => s + Number(d.valor_total ?? 0), 0))}
          tone="danger"
        />
        <StatCard
          label="Com nota de entrada"
          value={String(devolucoes.filter((d) => d.nfe_id).length)}
          icon={FileText}
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por número, pedido, cliente ou motivo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma devolução registrada."
          description="Escolha o pedido, informe as quantidades devolvidas e o sistema devolve o estoque e abate o financeiro."
          action={
            <Button
              onClick={() => {
                limpar();
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Nova devolução
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Depósito</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Abatido</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-numeric font-semibold">{d.numero}</TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(d.created_at)}</TableCell>
                  <TableCell className="text-numeric">{d.pedidos?.numero ?? "—"}</TableCell>
                  <TableCell>{d.clientes?.nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.depositos?.nome ?? "—"}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {d.devolucao_itens?.length ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(d.valor_total ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(d.valor_abatido ?? 0))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.nfe_id ? "secondary" : "outline"}>
                      {d.nfe_id ? "Nota de entrada" : "Somente pedido"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.motivo ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova devolução</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Pedido</Label>
              <Select
                value={pedidoId}
                onValueChange={(v) => {
                  setPedidoId(v);
                  setItens({});
                  const p = pedidos.find((x) => x.id === v);
                  setDepositoId(p?.deposito_id ?? "");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o pedido" />
                </SelectTrigger>
                <SelectContent>
                  {pedidos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      Nº {p.numero} — {p.clientes?.nome ?? "cliente"} — {brl(Number(p.total ?? 0))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Como registrar</Label>
              <Select value={modo} onValueChange={setModo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pedido">Somente pelo pedido</SelectItem>
                  <SelectItem value="nota">Com nota fiscal de entrada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Depósito que recebe</Label>
              <Select value={depositoId} onValueChange={setDepositoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Depósito do pedido" />
                </SelectTrigger>
                <SelectContent>
                  {depositos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Abater em contas a receber</Label>
              <Select value={abater} onValueChange={setAbater}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sim">Sim, abater os títulos em aberto</SelectItem>
                  <SelectItem value="nao">Não, manter o financeiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Motivo</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Produto avariado, sobra de obra…"
              />
            </div>

            {pedidoEscolhido && (
              <div className="panel overflow-x-auto sm:col-span-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Vendido</TableHead>
                      <TableHead className="text-right">Já devolvido</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="w-32 text-right">Devolver</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itensPedido.map((i) => {
                      const jaDev = devolvidoPorItem[i.id] ?? 0;
                      const disponivel = Number(i.quantidade ?? 0) - jaDev;
                      return (
                        <TableRow key={i.id}>
                          <TableCell>{i.produtos?.descricao ?? "—"}</TableCell>
                          <TableCell className="text-right text-numeric">
                            {Number(i.quantidade ?? 0)} {i.unidade ?? ""}
                          </TableCell>
                          <TableCell className="text-right text-numeric text-muted-foreground">
                            {jaDev}
                          </TableCell>
                          <TableCell className="text-right text-numeric">
                            {brl(Number(i.preco_unitario ?? 0))}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              className="text-right"
                              disabled={disponivel <= 0}
                              value={itens[i.id]?.quantidade ?? ""}
                              placeholder={disponivel <= 0 ? "devolvido" : `até ${disponivel}`}
                              onChange={(e) =>
                                setItens({
                                  ...itens,
                                  [i.id]: { pedido_item_id: i.id, quantidade: e.target.value },
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="rounded-md border border-border p-3 text-sm sm:col-span-2">
              <div className="flex justify-between font-semibold">
                <span>Total da devolução</span>
                <span className="text-numeric">{brl(totalDevolucao)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => registrar.mutate()} disabled={registrar.isPending}>
              Registrar devolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
