import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FileText, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
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

export const Route = createFileRoute("/_authenticated/orcamentos")({
  head: () => ({
    meta: [
      { title: "Orçamentos — Ze Obra" },
      {
        name: "description",
        content: "Orçamentos de balcão com aprovação e conversão em pedido.",
      },
      { property: "og:title", content: "Orçamentos — Ze Obra" },
      {
        property: "og:description",
        content: "Monte orçamentos rápidos, aprove e gere o pedido com reserva de estoque.",
      },
    ],
  }),
  component: Orcamentos,
});

const situacoes = [
  { value: "rascunho", label: "Rascunho" },
  { value: "enviado", label: "Enviado" },
  { value: "em_negociacao", label: "Em negociação" },
  { value: "aprovado", label: "Aprovado" },
  { value: "rejeitado", label: "Rejeitado" },
  { value: "expirado", label: "Expirado" },
];

const cores: Record<string, string> = {
  rascunho: "bg-secondary text-secondary-foreground",
  enviado: "bg-info/15 text-info",
  em_negociacao: "bg-warning/20 text-warning-foreground",
  aprovado: "bg-success/15 text-success",
  rejeitado: "bg-destructive/15 text-destructive",
  expirado: "bg-muted text-muted-foreground",
};

type Item = {
  produto_id: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
};

function hoje(diasFrente = 0) {
  const d = new Date();
  d.setDate(d.getDate() + diasFrente);
  return d.toISOString().slice(0, 10);
}

function Orcamentos() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSessionData();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [open, setOpen] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [converter, setConverter] = useState<string | null>(null);
  const [depositoId, setDepositoId] = useState("");

  const [clienteId, setClienteId] = useState("");
  const [obraId, setObraId] = useState("");
  const [validade, setValidade] = useState(hoje(7));
  const [condicao, setCondicao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [desconto, setDesconto] = useState("0");
  const [frete, setFrete] = useState("0");
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<Item[]>([]);
  const [produtoBusca, setProdutoBusca] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["orcamentos"],
    queryFn: async () => {
      const [orcamentos, clientes, obras, produtos, depositos] = await Promise.all([
        supabase
          .from("orcamentos")
          .select("*, clientes(nome), obras(nome)")
          .order("numero", { ascending: false }),
        supabase.from("clientes").select("id, nome, desconto_maximo").eq("ativo", true).order("nome"),
        supabase.from("obras").select("id, nome, cliente_id").order("nome"),
        supabase
          .from("produtos")
          .select("id, codigo_interno, codigo_barras, descricao, unidade, preco_venda")
          .eq("ativo", true)
          .order("descricao"),
        supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      return {
        orcamentos: orcamentos.data ?? [],
        clientes: clientes.data ?? [],
        obras: obras.data ?? [],
        produtos: produtos.data ?? [],
        depositos: depositos.data ?? [],
      };
    },
  });

  const { data: itensDetalhe } = useQuery({
    queryKey: ["orcamento-itens", detalhe],
    enabled: !!detalhe,
    queryFn: async () => {
      const { data } = await supabase
        .from("orcamento_itens")
        .select("*, produtos(descricao, codigo_interno)")
        .eq("orcamento_id", detalhe as string);
      return data ?? [];
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data?.orcamentos ?? []).filter((o) => {
      if (filtro !== "todos" && o.situacao !== filtro) return false;
      if (!termo) return true;
      const cliente = (o.clientes as unknown as { nome: string } | null)?.nome ?? "";
      return [String(o.numero), cliente].some((v) => v.toLowerCase().includes(termo));
    });
  }, [data, busca, filtro]);

  const produtosFiltrados = useMemo(() => {
    const t = produtoBusca.trim().toLowerCase();
    const base = data?.produtos ?? [];
    if (!t) return base.slice(0, 8);
    return base
      .filter((p) =>
        [p.descricao, p.codigo_interno, p.codigo_barras]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(t)),
      )
      .slice(0, 8);
  }, [data, produtoBusca]);

  const obrasCliente = useMemo(
    () => (data?.obras ?? []).filter((o) => o.cliente_id === clienteId),
    [data, clienteId],
  );

  const subtotal = itens.reduce(
    (s, i) => s + (i.quantidade * i.preco_unitario - i.desconto),
    0,
  );
  const total = Math.max(0, subtotal - Number(desconto || 0) + Number(frete || 0));

  function limpar() {
    setClienteId("");
    setObraId("");
    setValidade(hoje(7));
    setCondicao("");
    setPrazo("");
    setDesconto("0");
    setFrete("0");
    setObservacoes("");
    setItens([]);
    setProdutoBusca("");
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const { data: orc, error } = await supabase
        .from("orcamentos")
        .insert({
          tenant_id: session?.profile?.tenant_id as string,
          empresa_id: session?.profile?.empresa_id ?? null,
          filial_id: session?.profile?.filial_id ?? null,
          cliente_id: clienteId,
          obra_id: obraId || null,
          vendedor_id: session?.user.id ?? null,
          situacao: "rascunho",
          validade: validade || null,
          condicao_pagamento: condicao || null,
          prazo_entrega: prazo || null,
          desconto: Number(desconto || 0),
          frete: Number(frete || 0),
          observacoes: observacoes || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: e2 } = await supabase.from("orcamento_itens").insert(
        itens.map((i) => ({
          tenant_id: session?.profile?.tenant_id as string,
          orcamento_id: orc.id,
          produto_id: i.produto_id,
          quantidade: i.quantidade,
          unidade: i.unidade,
          preco_unitario: i.preco_unitario,
          desconto: i.desconto,
          total: i.quantidade * i.preco_unitario - i.desconto,
        })),
      );
      if (e2) throw e2;

      const { error: e3 } = await supabase.rpc("recalcular_orcamento", { p_id: orc.id });
      if (e3) throw e3;
    },
    onSuccess: () => {
      toast.success("Orçamento criado");
      setOpen(false);
      limpar();
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const mudarSituacao = useMutation({
    mutationFn: async ({ id, situacao }: { id: string; situacao: string }) => {
      const patch: Record<string, unknown> = { situacao };
      if (situacao === "aprovado") {
        patch['aprovado_em'] = new Date().toISOString();
        patch['aprovado_por'] = session?.user.id ?? null;
      }
      const { error } = await supabase
        .from("orcamentos")
        .update(patch as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada");
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível atualizar", { description: e.message }),
  });

  const gerarPedido = useMutation({
    mutationFn: async () => {
      const { data: pedidoId, error } = await supabase.rpc("converter_orcamento_em_pedido", {
        p_orcamento_id: converter as string,
        p_deposito_id: depositoId,
      });
      if (error) throw error;
      return pedidoId as unknown as string;
    },
    onSuccess: (pedidoId) => {
      toast.success("Pedido gerado com reserva de estoque");
      setConverter(null);
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      navigate({ to: "/pedidos/$id", params: { id: pedidoId } });
    },
    onError: (e: Error) => toast.error("Não foi possível gerar o pedido", { description: e.message }),
  });

  const totais = useMemo(() => {
    const l = data?.orcamentos ?? [];
    const abertos = l.filter((o) =>
      ["rascunho", "enviado", "em_negociacao"].includes(o.situacao),
    );
    const aprovados = l.filter((o) => o.situacao === "aprovado");
    const valorAberto = abertos.reduce((s, o) => s + Number(o.total), 0);
    const ticket = l.length ? l.reduce((s, o) => s + Number(o.total), 0) / l.length : 0;
    return { total: l.length, abertos: abertos.length, aprovados: aprovados.length, valorAberto, ticket };
  }, [data]);

  const orcamentoAtual = (data?.orcamentos ?? []).find((o) => o.id === detalhe);

  return (
    <>
      <PageHeader
        title="Orçamentos"
        description="Monte o orçamento no balcão, aprove e gere o pedido com reserva automática de estoque."
        actions={
          <Button
            onClick={() => {
              limpar();
              setOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" /> Novo orçamento
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orçamentos" value={num(totais.total)} />
        <StatCard label="Em aberto" value={num(totais.abertos)} />
        <StatCard label="Aprovados" value={num(totais.aprovados)} />
        <StatCard label="Valor em aberto" value={brl(totais.valorAberto)} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Número ou cliente…"
            className="pl-8"
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as situações</SelectItem>
            {situacoes.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="panel h-64 animate-pulse" />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum orçamento encontrado."
            description="Crie um orçamento para o cliente e envie por WhatsApp ou PDF."
            action={
              <Button
                onClick={() => {
                  limpar();
                  setOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" /> Novo orçamento
              </Button>
            }
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Obra</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-sm">
                      #{String(o.numero).padStart(4, "0")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {(o.clientes as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(o.obras as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{dateBR(o.validade)}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(Number(o.total))}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium ${cores[o.situacao] ?? "bg-secondary"}`}
                      >
                        {situacoes.find((s) => s.value === o.situacao)?.label ?? o.situacao}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Ver itens"
                          onClick={() => setDetalhe(o.id)}
                        >
                          <FileText className="size-4" />
                        </Button>
                        {["rascunho", "enviado", "em_negociacao"].includes(o.situacao) && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Aprovar"
                              onClick={() => mudarSituacao.mutate({ id: o.id, situacao: "aprovado" })}
                            >
                              <Check className="size-4 text-success" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Rejeitar"
                              onClick={() => mudarSituacao.mutate({ id: o.id, situacao: "rejeitado" })}
                            >
                              <X className="size-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        {o.situacao === "aprovado" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setConverter(o.id);
                              setDepositoId(data?.depositos[0]?.id ?? "");
                            }}
                          >
                            Gerar pedido <ArrowRight className="ml-1 size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* NOVO ORÇAMENTO */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo orçamento</DialogTitle>
            <DialogDescription>
              Busque o cliente, adicione os produtos e o total é calculado automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Cliente</Label>
                <Select
                  value={clienteId}
                  onValueChange={(v) => {
                    setClienteId(v);
                    setObraId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.clientes ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Obra (opcional)</Label>
                <Select value={obraId} onValueChange={setObraId} disabled={!clienteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem obra" />
                  </SelectTrigger>
                  <SelectContent>
                    {obrasCliente.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="orc-val">Validade</Label>
                <Input
                  id="orc-val"
                  type="date"
                  value={validade}
                  onChange={(e) => setValidade(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <Label>Produtos</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={produtoBusca}
                  onChange={(e) => setProdutoBusca(e.target.value)}
                  placeholder="Código, código de barras ou descrição…"
                  className="pl-8"
                />
              </div>
              {produtoBusca && (
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {produtosFiltrados.map((p) => (
                    <li key={p.id}>
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setItens((prev) => [
                            ...prev,
                            {
                              produto_id: p.id,
                              descricao: p.descricao,
                              unidade: p.unidade,
                              quantidade: 1,
                              preco_unitario: Number(p.preco_venda),
                              desconto: 0,
                            },
                          ]);
                          setProdutoBusca("");
                        }}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.codigo_interno}
                        </span>
                        <span className="flex-1 truncate">{p.descricao}</span>
                        <span className="text-xs text-muted-foreground">{p.unidade}</span>
                        <span className="font-semibold">{brl(Number(p.preco_venda))}</span>
                      </button>
                    </li>
                  ))}
                  {produtosFiltrados.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum produto encontrado.
                    </li>
                  )}
                </ul>
              )}

              {itens.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="w-28">Qtd</TableHead>
                        <TableHead className="w-32">Preço</TableHead>
                        <TableHead className="w-28">Desc. R$</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itens.map((i, idx) => (
                        <TableRow key={`${i.produto_id}-${idx}`}>
                          <TableCell className="text-sm">
                            {i.descricao}
                            <span className="ml-1 text-xs text-muted-foreground">({i.unidade})</span>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={i.quantidade}
                              onChange={(e) =>
                                setItens((prev) =>
                                  prev.map((x, j) =>
                                    j === idx ? { ...x, quantidade: Number(e.target.value) } : x,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={i.preco_unitario}
                              onChange={(e) =>
                                setItens((prev) =>
                                  prev.map((x, j) =>
                                    j === idx ? { ...x, preco_unitario: Number(e.target.value) } : x,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={i.desconto}
                              onChange={(e) =>
                                setItens((prev) =>
                                  prev.map((x, j) =>
                                    j === idx ? { ...x, desconto: Number(e.target.value) } : x,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {brl(i.quantidade * i.preco_unitario - i.desconto)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Remover item"
                              onClick={() => setItens((prev) => prev.filter((_, j) => j !== idx))}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="orc-cond">Condição de pagamento</Label>
                <Input
                  id="orc-cond"
                  value={condicao}
                  onChange={(e) => setCondicao(e.target.value)}
                  placeholder="Ex.: 30/60 dias"
                />
              </div>
              <div>
                <Label htmlFor="orc-prazo">Prazo de entrega</Label>
                <Input
                  id="orc-prazo"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  placeholder="Ex.: 3 dias úteis"
                />
              </div>
              <div>
                <Label htmlFor="orc-desc">Desconto geral (R$)</Label>
                <Input
                  id="orc-desc"
                  type="number"
                  min="0"
                  step="0.01"
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="orc-frete">Frete (R$)</Label>
                <Input
                  id="orc-frete"
                  type="number"
                  min="0"
                  step="0.01"
                  value={frete}
                  onChange={(e) => setFrete(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="orc-obs">Observações</Label>
              <Textarea
                id="orc-obs"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-6 rounded-lg bg-secondary px-4 py-3 text-sm">
              <span>
                Subtotal <strong className="ml-1">{brl(subtotal)}</strong>
              </span>
              <span>
                Total <strong className="ml-1 text-lg">{brl(total)}</strong>
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvar.mutate()}
              disabled={!clienteId || itens.length === 0 || salvar.isPending}
            >
              Salvar orçamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DETALHE */}
      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Orçamento #{String(orcamentoAtual?.numero ?? "").padStart(4, "0")}
            </DialogTitle>
            <DialogDescription>
              {(orcamentoAtual?.clientes as unknown as { nome: string } | null)?.nome} ·{" "}
              {situacoes.find((s) => s.value === orcamentoAtual?.situacao)?.label}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(itensDetalhe ?? []).map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-sm">
                    {(i.produtos as unknown as { descricao: string } | null)?.descricao}
                  </TableCell>
                  <TableCell className="text-right">
                    {num(Number(i.quantidade))} {i.unidade}
                  </TableCell>
                  <TableCell className="text-right">{brl(Number(i.preco_unitario))}</TableCell>
                  <TableCell className="text-right font-semibold">{brl(Number(i.total))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end gap-6 text-sm">
            <span>
              Frete <strong className="ml-1">{brl(Number(orcamentoAtual?.frete ?? 0))}</strong>
            </span>
            <span>
              Desconto <strong className="ml-1">{brl(Number(orcamentoAtual?.desconto ?? 0))}</strong>
            </span>
            <span>
              Total <strong className="ml-1 text-lg">{brl(Number(orcamentoAtual?.total ?? 0))}</strong>
            </span>
          </div>
          <DialogFooter>
            {orcamentoAtual && ["rascunho", "enviado", "em_negociacao"].includes(orcamentoAtual.situacao) && (
              <Select
                onValueChange={(v) => mudarSituacao.mutate({ id: orcamentoAtual.id, situacao: v })}
              >
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Alterar situação" />
                </SelectTrigger>
                <SelectContent>
                  {situacoes
                    .filter((s) => s.value !== orcamentoAtual.situacao)
                    .map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONVERTER EM PEDIDO */}
      <Dialog open={!!converter} onOpenChange={(v) => !v && setConverter(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar pedido</DialogTitle>
            <DialogDescription>
              O estoque dos produtos será reservado no depósito escolhido.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Depósito</Label>
            <Select value={depositoId} onValueChange={setDepositoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o depósito" />
              </SelectTrigger>
              <SelectContent>
                {(data?.depositos ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConverter(null)}>
              Cancelar
            </Button>
            <Button onClick={() => gerarPedido.mutate()} disabled={!depositoId || gerarPedido.isPending}>
              Gerar pedido e reservar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
