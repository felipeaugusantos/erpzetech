import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Barcode, Minus, Plus, Printer, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateTimeBR, num } from "@/lib/format";
import { formasPagamento, hojeISO, labelForma, somaDias } from "@/lib/financeiro";
import type { FormaPagamento } from "@/lib/financeiro";
import { CupomFiscal, type CupomDados } from "@/components/app/CupomFiscal";
import { InstalarApp } from "@/components/app/InstalarApp";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/pdv")({
  head: () => ({
    meta: [
      { title: "PDV — venda rápida — Ze Obra" },
      {
        name: "description",
        content:
          "Venda de balcão com leitura de código de barras, cupom impresso na hora, baixa de estoque no depósito e lançamento automático no caixa.",
      },
      { property: "og:title", content: "PDV — venda rápida — Ze Obra" },
      {
        property: "og:description",
        content: "Passe o código de barras, receba o pagamento, imprima o cupom e emita a nota.",
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
  /** Texto digitado, para permitir venda fracionada com vírgula (ex.: 0,500). */
  qtdTexto: string;
  disponivel: number;
};

/** Aceita vírgula e até 3 casas decimais (venda fracionada). */
function parseQtd(valor: string) {
  const n = Number(valor.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}

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
  const [pagamentoAberto, setPagamentoAberto] = useState(false);
  const [cupom, setCupom] = useState<(CupomDados & { pedidoId: string }) | null>(null);

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
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .eq("ativo", true)
          .order("nome")
          .limit(1000),
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
        return atual.map((l) => {
          if (l.produto_id !== p.id) return l;
          const q = Math.round((l.quantidade + quantidade) * 1000) / 1000;
          return { ...l, quantidade: q, qtdTexto: String(q).replace(".", ",") };
        });
      return [
        ...atual,
        {
          produto_id: p.id,
          descricao: p.descricao,
          unidade: p.unidade_venda ?? p.unidade ?? "UN",
          preco: Number(p.preco_venda ?? 0),
          quantidade,
          qtdTexto: String(quantidade).replace(".", ","),
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
  const recebidoNum = Number(recebido.replace(",", ".")) || 0;
  const troco = Math.max(recebidoNum - total, 0);
  const aPrazo = forma === "crediario" || forma === "boleto";

  const semEstoque = linhas.filter(
    (l) => l.quantidade > (disponivelPorProduto.get(l.produto_id) ?? 0),
  );

  const alterarQtd = (id: string, fn: (q: number) => number) =>
    setLinhas((a) =>
      a.map((x) => {
        if (x.produto_id !== id) return x;
        const q = Math.round(fn(x.quantidade) * 1000) / 1000;
        return { ...x, quantidade: q, qtdTexto: String(q).replace(".", ",") };
      }),
    );
  const alterarPreco = (id: string, valor: string) =>
    setLinhas((a) =>
      a.map((x) =>
        x.produto_id === id ? { ...x, preco: Number(valor.replace(",", ".")) || 0 } : x,
      ),
    );

  const nomeDeposito = depositos.find((d) => d.id === depositoId)?.nome ?? "—";
  const nomeCliente =
    clienteId === "balcao"
      ? "Consumidor final (balcão)"
      : (clientes.find((c) => c.id === clienteId)?.nome ?? "—");

  const finalizar = useMutation({
    mutationFn: async () => {
      if (!depositoId) throw new Error("Escolha o depósito de saída da mercadoria");
      if (linhas.length === 0) throw new Error("Inclua pelo menos um produto");
      if (linhas.some((l) => l.quantidade <= 0))
        throw new Error("Informe a quantidade de cada item (pode ser fracionada, ex.: 0,5)");
      if (!aPrazo && !caixaAberto) throw new Error("Abra o caixa antes de vender no PDV");
      const { data, error } = await supabase.rpc("pdv_venda", {
        p_deposito_id: depositoId,
        p_itens: linhas.map((l) => ({
          produto_id: l.produto_id,
          quantidade: l.quantidade,
          preco_unitario: l.preco,
        })),
        p_forma: forma as FormaPagamento,
        ...(clienteId === "balcao" ? {} : { p_cliente_id: clienteId }),
        p_desconto: descontoNum,
        p_parcelas: Math.max(Number(parcelas) || 1, 1),
        ...(aPrazo ? { p_primeiro_vencimento: vencimento } : {}),
      });
      if (error) throw error;
      const pedidoId = data as string;
      const { data: pedido } = await supabase
        .from("pedidos")
        .select("numero, created_at, clientes(nome)")
        .eq("id", pedidoId)
        .maybeSingle();
      return { pedidoId, pedido };
    },
    onSuccess: ({ pedidoId, pedido }) => {
      toast.success("Venda concluída", {
        description: aPrazo
          ? "Parcelas lançadas em contas a receber."
          : "Lançada no caixa, com baixa de estoque e comissão do vendedor.",
      });
      setCupom({
        pedidoId,
        numero: String(pedido?.numero ?? "—").padStart(4, "0"),
        emitidoEm: dateTimeBR(pedido?.created_at ?? new Date().toISOString()),
        loja: session?.empresa?.nome_fantasia ?? session?.empresa?.razao_social ?? "Ze Obra",
        deposito: nomeDeposito,
        cliente:
          (pedido?.clientes as { nome: string } | null)?.nome ?? nomeCliente,
        vendedor: session?.profile?.nome ?? session?.user.email ?? "—",
        itens: linhas.map((l) => ({
          descricao: l.descricao,
          unidade: l.unidade,
          quantidade: l.quantidade,
          preco: l.preco,
        })),
        subtotal,
        desconto: descontoNum,
        total,
        forma,
        parcelas: aPrazo ? Math.max(Number(parcelas) || 1, 1) : 1,
        recebido: aPrazo ? 0 : recebidoNum,
        troco: aPrazo ? 0 : troco,
        nfe: null,
      });
      setPagamentoAberto(false);
      setLinhas([]);
      setDesconto("0");
      setRecebido("");
      setClienteId("balcao");
      void qc.invalidateQueries();
      buscaRef.current?.focus();
    },
    onError: (e: Error) => toast.error("Não foi possível finalizar", { description: e.message }),
  });

  /** Nota fiscal do mesmo atendimento, gerada a partir do pedido da venda. */
  const emitirNota = useMutation({
    mutationFn: async (pedidoId: string) => {
      const { data, error } = await supabase.rpc("gerar_nfe", { p_pedido_id: pedidoId });
      if (error) throw error;
      const nfeId = data as string;
      const { data: nota } = await supabase
        .from("nfe")
        .select("numero, serie, situacao, chave, pendencias")
        .eq("id", nfeId)
        .maybeSingle();
      return nota;
    },
    onSuccess: (nota) => {
      setCupom((c) =>
        c
          ? {
              ...c,
              nfe: {
                numero: nota?.numero ? String(nota.numero) : null,
                serie: nota?.serie ? String(nota.serie) : null,
                situacao: String(nota?.situacao ?? "rascunho"),
                chave: nota?.chave ?? null,
              },
            }
          : c,
      );
      const pendencias = (nota?.pendencias ?? []) as string[];
      toast.success("Nota fiscal gerada", {
        description:
          pendencias.length > 0
            ? `${pendencias.length} pendência(s) a resolver antes de enviar à Receita.`
            : "Pronta para envio à Receita na tela de notas fiscais.",
      });
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Não foi possível gerar a nota", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="PDV — venda rápida"
        description="Passe o código de barras, escolha a forma de pagamento e finalize. Cupom na hora, baixa de estoque, caixa e comissão automáticos."
        actions={
          <>
            <Badge variant={caixaAberto ? "default" : "destructive"}>
              {caixaAberto ? "Caixa aberto" : "Caixa fechado"}
            </Badge>
            <InstalarApp />
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

      <div className="grid gap-6 pb-40 lg:grid-cols-[1.6fr_1fr] lg:pb-0">
        <div>
          <div className="panel mb-4 space-y-3 p-3 sm:p-4">
            <div>
              <Label className="text-xs">Código de barras ou nome do produto</Label>
              <div className="relative mt-1">
                <Barcode className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={buscaRef}
                  autoFocus
                  autoComplete="off"
                  enterKeyHint="done"
                  className="h-14 pl-10 text-base"
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
                        className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-secondary"
                        onClick={() => adicionar(p)}
                      >
                        <Plus className="size-4 shrink-0 text-primary" />
                        <span className="flex-1 truncate">{p.descricao}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          {num(disponivelPorProduto.get(p.id) ?? 0, 2)} disp.
                        </span>
                        <span className="text-numeric">{brl(Number(p.preco_venda ?? 0))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Depósito de saída</Label>
                <Select value={depositoId} onValueChange={setDepositoId}>
                  <SelectTrigger className="mt-1 h-11">
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
                <Label className="text-xs">Cliente (digite o nome)</Label>
                <ClienteCombobox
                  className="mt-1 h-11"
                  clientes={clientes}
                  value={clienteId}
                  onChange={setClienteId}
                  balcaoValue="balcao"
                />
              </div>
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
            <ul className="space-y-2">
              {linhas.map((l) => {
                const disp = disponivelPorProduto.get(l.produto_id) ?? 0;
                return (
                  <li key={l.produto_id} className="panel p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.unidade} · {num(disp, 2)} disponível
                          {l.quantidade > disp && (
                            <span className="ml-1 font-semibold text-destructive">
                              sem saldo suficiente
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-numeric font-semibold">{brl(l.quantidade * l.preco)}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() =>
                            setLinhas((a) => a.filter((x) => x.produto_id !== l.produto_id))
                          }
                          aria-label="Remover item"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-10"
                          onClick={() =>
                            alterarQtd(l.produto_id, (q) => Math.max(q - 1, 0.001))
                          }
                        >
                          <Minus className="size-4" />
                        </Button>
                        <Input
                          className="h-10 w-24 text-center text-base"
                          inputMode="decimal"
                          aria-label={`Quantidade em ${l.unidade}`}
                          value={l.qtdTexto}
                          onChange={(e) => {
                            const texto = e.target.value.replace(/[^0-9.,]/g, "");
                            setLinhas((a) =>
                              a.map((x) =>
                                x.produto_id === l.produto_id
                                  ? { ...x, qtdTexto: texto, quantidade: parseQtd(texto) }
                                  : x,
                              ),
                            );
                          }}
                        />
                        <span className="text-xs text-muted-foreground">{l.unidade}</span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-10"
                          onClick={() => alterarQtd(l.produto_id, (q) => q + 1)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Preço</Label>
                        <Input
                          className="h-10 w-28 text-right text-numeric"
                          inputMode="decimal"
                          value={String(l.preco)}
                          onChange={(e) => alterarPreco(l.produto_id, e.target.value)}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Resumo e pagamento: coluna no computador, painel fixo no celular. */}
        <div className="hidden space-y-4 lg:block">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Itens" value={String(linhas.length)} icon={ShoppingCart} />
            <StatCard label="Total da venda" value={brl(total)} icon={Wallet} tone="accent" />
          </div>
          <div className="panel space-y-4 p-4">
            <PagamentoCampos
              desconto={desconto}
              setDesconto={setDesconto}
              forma={forma}
              setForma={setForma}
              aPrazo={aPrazo}
              parcelas={parcelas}
              setParcelas={setParcelas}
              vencimento={vencimento}
              setVencimento={setVencimento}
              recebido={recebido}
              setRecebido={setRecebido}
              troco={troco}
              subtotal={subtotal}
              descontoNum={descontoNum}
              total={total}
            />
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

      {/* Barra fixa do celular com total, troco e botão de pagamento. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card p-3 shadow-raised lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {linhas.length} item(ns) · {labelForma(forma)}
            </p>
            <p className="font-display text-2xl font-bold text-numeric">{brl(total)}</p>
            {!aPrazo && recebidoNum > 0 && (
              <p className="text-sm">
                Troco: <span className="text-numeric font-semibold">{brl(troco)}</span>
              </p>
            )}
          </div>
          <Button
            size="lg"
            className="h-14 flex-1"
            disabled={linhas.length === 0}
            onClick={() => setPagamentoAberto(true)}
          >
            Pagamento
          </Button>
        </div>
      </div>

      {/* Pagamento no celular */}
      <Dialog open={pagamentoAberto} onOpenChange={setPagamentoAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pagamento · {brl(total)}</DialogTitle>
          </DialogHeader>
          <PagamentoCampos
            desconto={desconto}
            setDesconto={setDesconto}
            forma={forma}
            setForma={setForma}
            aPrazo={aPrazo}
            parcelas={parcelas}
            setParcelas={setParcelas}
            vencimento={vencimento}
            setVencimento={setVencimento}
            recebido={recebido}
            setRecebido={setRecebido}
            troco={troco}
            subtotal={subtotal}
            descontoNum={descontoNum}
            total={total}
            atalhosRecebido
          />
          {semEstoque.length > 0 && (
            <p className="text-xs text-destructive">
              {semEstoque.length} item(ns) sem saldo suficiente neste depósito.
            </p>
          )}
          <DialogFooter>
            <Button
              size="lg"
              className="h-14 w-full"
              disabled={finalizar.isPending || linhas.length === 0}
              onClick={() => finalizar.mutate()}
            >
              Finalizar venda · {brl(total)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cupom da venda concluída */}
      <Dialog open={!!cupom} onOpenChange={(o) => !o && setCupom(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cupom da venda</DialogTitle>
          </DialogHeader>
          {cupom && <CupomFiscal dados={cupom} />}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => window.print()}>
              <Printer className="mr-2 size-4" /> Imprimir cupom
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={emitirNota.isPending || !!cupom?.nfe}
              onClick={() => cupom && emitirNota.mutate(cupom.pedidoId)}
            >
              {cupom?.nfe ? "Nota gerada" : "Emitir NF-e desta venda"}
            </Button>
            {cupom?.nfe && (
              <Button variant="outline" className="w-full sm:w-auto" asChild>
                <Link to="/nfe">Ver notas fiscais</Link>
              </Button>
            )}
            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setCupom(null)}>
              Nova venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type CamposProps = {
  desconto: string;
  setDesconto: (v: string) => void;
  forma: string;
  setForma: (v: string) => void;
  aPrazo: boolean;
  parcelas: string;
  setParcelas: (v: string) => void;
  vencimento: string;
  setVencimento: (v: string) => void;
  recebido: string;
  setRecebido: (v: string) => void;
  troco: number;
  subtotal: number;
  descontoNum: number;
  total: number;
  atalhosRecebido?: boolean;
};

function PagamentoCampos(p: CamposProps) {
  const atalhos = [p.total, 50, 100, 200];
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Desconto (R$)</Label>
        <Input
          className="mt-1 h-11"
          inputMode="decimal"
          value={p.desconto}
          onChange={(e) => p.setDesconto(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Forma de pagamento</Label>
        <Select value={p.forma} onValueChange={p.setForma}>
          <SelectTrigger className="mt-1 h-11">
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

      {p.aPrazo ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Parcelas</Label>
            <Input
              className="mt-1 h-11"
              inputMode="numeric"
              value={p.parcelas}
              onChange={(e) => p.setParcelas(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">1º vencimento</Label>
            <Input
              type="date"
              className="mt-1 h-11"
              value={p.vencimento}
              onChange={(e) => p.setVencimento(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Em {labelForma(p.forma)} a venda vai para contas a receber, sem entrada no caixa.
          </p>
        </div>
      ) : (
        <div>
          <Label className="text-xs">Valor recebido (R$)</Label>
          <Input
            className="mt-1 h-12 text-right text-lg text-numeric"
            inputMode="decimal"
            value={p.recebido}
            onChange={(e) => p.setRecebido(e.target.value)}
          />
          {p.atalhosRecebido && (
            <div className="mt-2 flex flex-wrap gap-2">
              {atalhos.map((v, i) => (
                <Button
                  key={`${v}-${i}`}
                  size="sm"
                  variant="outline"
                  onClick={() => p.setRecebido(v.toFixed(2))}
                >
                  {i === 0 ? `Valor exato ${brl(v)}` : brl(v)}
                </Button>
              ))}
            </div>
          )}
          <div className="mt-2 rounded-md bg-secondary p-3">
            <p className="text-xs text-secondary-foreground">Troco</p>
            <p className="font-display text-2xl font-bold text-numeric">{brl(p.troco)}</p>
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="text-numeric">{brl(p.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Desconto</span>
          <span className="text-numeric">{brl(p.descontoNum)}</span>
        </div>
        <div className="flex justify-between font-display text-lg font-bold">
          <span>Total</span>
          <span className="text-numeric">{brl(p.total)}</span>
        </div>
      </div>
    </div>
  );
}
