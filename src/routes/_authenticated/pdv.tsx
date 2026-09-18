import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Barcode, Minus, Plus, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import { formasPagamento, hojeISO, labelForma, somaDias } from "@/lib/financeiro";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/pdv")({
  head: () => ({
    meta: [
      { title: "PDV — venda rápida — Ze Obra" },
      {
        name: "description",
        content:
          "Venda de balcão com leitura de código de barras, baixa de estoque no depósito e lançamento automático no caixa.",
      },
      { property: "og:title", content: "PDV — venda rápida — Ze Obra" },
      {
        property: "og:description",
        content: "Passe o código de barras, receba o pagamento e a venda entra no caixa na hora.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Pdv,
});

type Linha = {
  produto_id: string;
  descricao: string;
  unidade: string;
  preco: number;
  quantidade: number;
  disponivel: number;
};

function Pdv() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const buscaRef = useRef<HTMLInputElement>(null);

  const [depositoId, setDepositoId] = useState("");
  const [clienteId, setClienteId] = useState("balcao");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState("0");
  const [forma, setForma] = useState("dinheiro");
  const [parcelas, setParcelas] = useState("1");
  const [vencimento, setVencimento] = useState(somaDias(hojeISO(), 30));
  const [recebido, setRecebido] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["pdv-base"],
    queryFn: async () => {
      const [depRes, prodRes, cliRes, caixaRes] = await Promise.all([
        supabase.from("depositos").select("id, nome, filial_id").eq("ativo", true).order("nome"),
        supabase
          .from("produtos")
          .select("id, descricao, codigo_interno, codigo_barras, unidade, unidade_venda, preco_venda")
          .eq("ativo", true)
          .order("descricao"),
        supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome").limit(500),
        supabase.from("caixas").select("id, situacao, valor_abertura").eq("situacao", "aberto"),
      ]);
      return {
        depositos: depRes.data ?? [],
        produtos: prodRes.data ?? [],
        clientes: cliRes.data ?? [],
        caixaAberto: (caixaRes.data ?? [])[0] ?? null,
      };
    },
  });

  const depositos = data?.depositos ?? [];
  const produtos = data?.produtos ?? [];
  const clientes = data?.clientes ?? [];
  const caixaAberto = data?.caixaAberto ?? null;

  useEffect(() => {
    const primeiro = depositos[0];
    if (!depositoId && primeiro) setDepositoId(primeiro.id);
  }, [depositos, depositoId]);

  /** Saldo disponível do depósito escolhido, para não vender o que não tem. */
  const { data: estoque = [] } = useQuery({
    queryKey: ["pdv-estoque", depositoId],
    enabled: !!depositoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estoques")
        .select("produto_id, quantidade, reservado")
        .eq("deposito_id", depositoId);
      if (error) throw error;
      return data;
    },
  });

  const disponivelPorProduto = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of estoque)
      m.set(e.produto_id, Number(e.quantidade) - Number(e.reservado));
    return m;
  }, [estoque]);

  const sugestoes = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return [];
    return produtos
      .filter(
        (p) =>
          p.descricao.toLowerCase().includes(t) ||
          (p.codigo_barras ?? "").toLowerCase().includes(t) ||
          (p.codigo_interno ?? "").toLowerCase().includes(t),
      )
      .slice(0, 8);
  }, [busca, produtos]);

  function adicionar(p: (typeof produtos)[number], quantidade = 1) {
    setLinhas((atual) => {
      const existe = atual.find((l) => l.produto_id === p.id);
      if (existe)
        return atual.map((l) =>
          l.produto_id === p.id ? { ...l, quantidade: l.quantidade + quantidade } : l,
        );
      return [
        ...atual,
        {
          produto_id: p.id,
          descricao: p.descricao,
          unidade: p.unidade_venda ?? p.unidade ?? "UN",
          preco: Number(p.preco_venda ?? 0),
          quantidade,
          disponivel: disponivelPorProduto.get(p.id) ?? 0,
        },
      ];
    });
    setBusca("");
    buscaRef.current?.focus();
  }

  /** Enter no campo: código de barras exato entra direto no carrinho. */
  function onEnterBusca() {
    const t = busca.trim().toLowerCase();
    if (!t) return;
    const exato =
      produtos.find((p) => (p.codigo_barras ?? "").toLowerCase() === t) ??
      produtos.find((p) => (p.codigo_interno ?? "").toLowerCase() === t) ??
      (sugestoes.length === 1 ? sugestoes[0] : null);
    if (exato) adicionar(exato);
    else toast.error("Produto não encontrado", { description: "Confira o código ou busque pelo nome." });
  }

  const subtotal = useMemo(
    () => linhas.reduce((s, l) => s + l.quantidade * l.preco, 0),
    [linhas],
  );
  const descontoNum = Math.max(Number(desconto.replace(",", ".")) || 0, 0);
  const total = Math.max(subtotal - descontoNum, 0);
  const troco = Math.max((Number(recebido.replace(",", ".")) || 0) - total, 0);
  const aPrazo = forma === "crediario" || forma === "boleto";

  const semEstoque = linhas.filter(
    (l) => l.quantidade > (disponivelPorProduto.get(l.produto_id) ?? 0),
  );

  const finalizar = useMutation({
    mutationFn: async () => {
      if (!depositoId) throw new Error("Escolha o depósito de saída da mercadoria");
      if (linhas.length === 0) throw new Error("Inclua pelo menos um produto");
      if (!aPrazo && !caixaAberto) throw new Error("Abra o caixa antes de vender no PDV");
      const { data, error } = await supabase.rpc("pdv_venda", {
        p_deposito_id: depositoId,
        p_itens: linhas.map((l) => ({
          produto_id: l.produto_id,
          quantidade: l.quantidade,
          preco_unitario: l.preco,
        })),
        p_forma: forma,
        p_cliente_id: clienteId === "balcao" ? null : clienteId,
        p_desconto: descontoNum,
        p_parcelas: Math.max(Number(parcelas) || 1, 1),
        p_primeiro_vencimento: aPrazo ? vencimento : null,
        p_observacao: null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Venda concluída", {
        description: aPrazo
          ? "Parcelas lançadas em contas a receber."
          : "Lançada no caixa, com baixa de estoque e comissão do vendedor.",
      });
      setLinhas([]);
      setDesconto("0");
      setRecebido("");
      setClienteId("balcao");
      void qc.invalidateQueries();
      buscaRef.current?.focus();
    },
    onError: (e: Error) => toast.error("Não foi possível finalizar", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="PDV — venda rápida"
        description="Passe o código de barras, escolha a forma de pagamento e finalize. A baixa de estoque, o caixa e a comissão do vendedor entram automaticamente."
        actions={
          <>
            <Badge variant={caixaAberto ? "default" : "destructive"}>
              {caixaAberto ? "Caixa aberto" : "Caixa fechado"}
            </Badge>
            <Button variant="outline" asChild>
              <Link to="/caixa">
                <Wallet className="mr-2 size-4" /> Caixa
              </Link>
            </Button>
          </>
        }
      />

      {!caixaAberto && (
        <div className="panel mb-6 border-destructive/40 bg-destructive/5 p-4 text-sm">
          Nenhum caixa aberto. Vendas à vista exigem caixa aberto — abra o caixa em{" "}
          <Link to="/caixa" className="font-semibold underline">
            Financeiro › Caixa
          </Link>
          . Vendas no crediário ou boleto podem ser feitas mesmo assim.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="panel mb-4 grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <Label>Depósito de saída</Label>
              <Select value={depositoId} onValueChange={setDepositoId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolha o depósito" />
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
              <Label>Cliente (opcional)</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balcao">Consumidor final (balcão)</SelectItem>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Código de barras ou nome do produto</Label>
              <div className="relative mt-1">
                <Barcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={buscaRef}
                  autoFocus
                  className="pl-9"
                  placeholder="Passe o leitor ou digite e aperte Enter…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onEnterBusca();
                    }
                  }}
                />
              </div>
              {sugestoes.length > 0 && (
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {sugestoes.map((p) => (
                    <li key={p.id}>
                      <button
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-secondary"
                        onClick={() => adicionar(p)}
                      >
                        <Plus className="size-4 text-primary" />
                        <span className="flex-1 truncate">{p.descricao}</span>
                        <span className="text-xs text-muted-foreground">
                          {num(disponivelPorProduto.get(p.id) ?? 0, 2)} disp.
                        </span>
                        <span className="text-numeric">{brl(Number(p.preco_venda ?? 0))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="panel h-48 animate-pulse" />
          ) : linhas.length === 0 ? (
            <EmptyState
              title="Nenhum item na venda."
              description="Passe o código de barras do produto ou busque pelo nome para começar o atendimento."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-center">Quantidade</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => {
                    const disp = disponivelPorProduto.get(l.produto_id) ?? 0;
                    return (
                      <TableRow key={l.produto_id}>
                        <TableCell className="text-sm">
                          <span className="font-medium">{l.descricao}</span>
                          <span className="block text-xs text-muted-foreground">
                            {l.unidade} · {num(disp, 2)} disponível
                            {l.quantidade > disp && (
                              <span className="ml-1 text-destructive">sem saldo suficiente</span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-7"
                              onClick={() =>
                                setLinhas((a) =>
                                  a.map((x) =>
                                    x.produto_id === l.produto_id
                                      ? { ...x, quantidade: Math.max(x.quantidade - 1, 1) }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <Minus className="size-3" />
                            </Button>
                            <Input
                              className="h-8 w-20 text-center"
                              inputMode="decimal"
                              value={String(l.quantidade)}
                              onChange={(e) =>
                                setLinhas((a) =>
                                  a.map((x) =>
                                    x.produto_id === l.produto_id
                                      ? {
                                          ...x,
                                          quantidade:
                                            Number(e.target.value.replace(",", ".")) || 0,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-7"
                              onClick={() =>
                                setLinhas((a) =>
                                  a.map((x) =>
                                    x.produto_id === l.produto_id
                                      ? { ...x, quantidade: x.quantidade + 1 }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <Plus className="size-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="h-8 w-28 text-right text-numeric"
                            inputMode="decimal"
                            value={String(l.preco)}
                            onChange={(e) =>
                              setLinhas((a) =>
                                a.map((x) =>
                                  x.produto_id === l.produto_id
                                    ? { ...x, preco: Number(e.target.value.replace(",", ".")) || 0 }
                                    : x,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right text-numeric font-semibold">
                          {brl(l.quantidade * l.preco)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setLinhas((a) => a.filter((x) => x.produto_id !== l.produto_id))
                            }
                            aria-label="Remover item"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Itens" value={String(linhas.length)} icon={ShoppingCart} />
            <StatCard label="Total da venda" value={brl(total)} icon={Wallet} tone="accent" />
          </div>

          <div className="panel space-y-4 p-4">
            <div>
              <Label>Desconto (R$)</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
              />
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={forma} onValueChange={setForma}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formasPagamento.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {aPrazo ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Parcelas</Label>
                  <Input
                    className="mt-1"
                    inputMode="numeric"
                    value={parcelas}
                    onChange={(e) => setParcelas(e.target.value)}
                  />
                </div>
                <div>
                  <Label>1º vencimento</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={vencimento}
                    onChange={(e) => setVencimento(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Em {labelForma(forma)} a venda vai para contas a receber, sem entrada no caixa.
                </p>
              </div>
            ) : (
              <div>
                <Label>Valor recebido (R$)</Label>
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={recebido}
                  onChange={(e) => setRecebido(e.target.value)}
                />
                <p className="mt-1 text-sm">
                  Troco: <span className="text-numeric font-semibold">{brl(troco)}</span>
                </p>
              </div>
            )}

            <div className="space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-numeric">{brl(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Desconto</span>
                <span className="text-numeric">{brl(descontoNum)}</span>
              </div>
              <div className="flex justify-between font-display text-lg font-bold">
                <span>Total</span>
                <span className="text-numeric">{brl(total)}</span>
              </div>
            </div>

            {semEstoque.length > 0 && (
              <p className="text-xs text-destructive">
                {semEstoque.length} item(ns) sem saldo suficiente neste depósito.
              </p>
            )}

            <Button
              className="w-full"
              size="lg"
              disabled={finalizar.isPending || linhas.length === 0}
              onClick={() => finalizar.mutate()}
            >
              Finalizar venda · {brl(total)}
            </Button>
            <p className="text-xs text-muted-foreground">
              Vendedor: {session?.profile?.nome ?? session?.user.email}. A comissão dele é lançada
              sozinha no fechamento da venda.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
