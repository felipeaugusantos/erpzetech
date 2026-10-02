import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { CodigoPessoa } from "@/components/app/CodigoPessoa";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { situacoesPedido, corSituacao, labelSituacao } from "@/lib/pedido";

export const Route = createFileRoute("/_authenticated/pedidos/")({
  head: () => ({
    meta: [
      { title: "Pedidos — ERP Ze Tech" },
      {
        name: "description",
        content: "Pedidos com separação, conferência e entrega acompanhados por timeline.",
      },
      { property: "og:title", content: "Pedidos — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Do pagamento à entrega: acompanhe cada etapa do pedido da loja.",
      },
    ],
  }),
  component: Pedidos,
});

type Item = {
  produto_id: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  /** Texto digitado da quantidade, permitindo fração com vírgula (ex.: 0,500). */
  qtdTexto: string;
  preco_unitario: number;
  desconto: number;
};

/** Aceita vírgula e até 3 casas decimais. */
function parseQtd(valor: string) {
  const n = Number(valor.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}

function Pedidos() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");

  const { data, isLoading } = useQuery({
    queryKey: ["pedidos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pedidos")
        .select("*, clientes(nome), obras(nome), depositos(nome)")
        .order("numero", { ascending: false });
      return data ?? [];
    },
  });

  /* ---------- novo pedido ---------- */
  const [open, setOpen] = useState(false);
  const [clienteId, setClienteId] = useState("");
  const [obraId, setObraId] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [condicao, setCondicao] = useState("");
  const [desconto, setDesconto] = useState("0");
  const [frete, setFrete] = useState("0");
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<Item[]>([]);
  const [produtoBusca, setProdutoBusca] = useState("");
  const [codVendedor, setCodVendedor] = useState("");
  const [vendedorId, setVendedorId] = useState<string | null>(null);
  const [codProfissional, setCodProfissional] = useState("");
  const [profissionalId, setProfissionalId] = useState<string | null>(null);

  const { data: base } = useQuery({
    queryKey: ["pedido-novo-base"],
    enabled: open,
    queryFn: async () => {
      const [cli, obr, prod, dep, vend, prof] = await Promise.all([
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .eq("ativo", true)
          .order("nome"),
        supabase.from("obras").select("id, nome, cliente_id").order("nome"),
        supabase
          .from("produtos")
          .select("id, codigo_interno, codigo_barras, descricao, unidade, preco_venda")
          .eq("ativo", true)
          .order("descricao"),
        supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("profiles").select("id, nome, codigo").eq("ativo", true).order("nome"),
        supabase.from("profissionais").select("id, nome, codigo").eq("ativo", true).order("nome"),
      ]);
      return {
        clientes: cli.data ?? [],
        obras: obr.data ?? [],
        produtos: prod.data ?? [],
        depositos: dep.data ?? [],
        vendedores: vend.data ?? [],
        profissionais: prof.data ?? [],
      };
    },
  });

  const obrasCliente = useMemo(
    () => (base?.obras ?? []).filter((o) => o.cliente_id === clienteId),
    [base, clienteId],
  );

  const produtosFiltrados = useMemo(() => {
    const t = produtoBusca.trim().toLowerCase();
    const lista = base?.produtos ?? [];
    if (!t) return lista.slice(0, 8);
    return lista
      .filter((p) =>
        [p.descricao, p.codigo_interno, p.codigo_barras]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(t)),
      )
      .slice(0, 8);
  }, [base, produtoBusca]);

  const subtotalNovo = itens.reduce(
    (s, i) => s + (i.quantidade * i.preco_unitario - i.desconto),
    0,
  );
  const totalNovo = Math.max(0, subtotalNovo - Number(desconto || 0) + Number(frete || 0));

  function limpar() {
    setClienteId("");
    setObraId("");
    setDepositoId("");
    setPrevisao("");
    setCondicao("");
    setDesconto("0");
    setFrete("0");
    setObservacoes("");
    setItens([]);
    setProdutoBusca("");
    setCodVendedor("");
    setVendedorId(null);
    setCodProfissional("");
    setProfissionalId(null);
  }

  const criar = useMutation({
    mutationFn: async () => {
      if (!clienteId) throw new Error("Escolha o cliente");
      if (!depositoId) throw new Error("Escolha o depósito de saída");
      if (itens.length === 0) throw new Error("Inclua pelo menos um produto");
      if (itens.some((i) => i.quantidade <= 0))
        throw new Error("Informe a quantidade de cada item");
      const { data: pedidoId, error } = await supabase.rpc("criar_pedido_direto", {
        p_cliente_id: clienteId,
        p_deposito_id: depositoId,
        p_itens: itens.map((i) => ({
          produto_id: i.produto_id,
          quantidade: i.quantidade,
          unidade: i.unidade,
          preco_unitario: i.preco_unitario,
          desconto: i.desconto,
        })),
        p_desconto: Number(desconto || 0),
        p_frete: Number(frete || 0),
        ...(obraId ? { p_obra_id: obraId } : {}),
        ...(condicao ? { p_condicao_pagamento: condicao } : {}),
        ...(previsao ? { p_previsao_entrega: previsao } : {}),
        ...(vendedorId ? { p_vendedor_id: vendedorId } : {}),
        ...(profissionalId ? { p_profissional_id: profissionalId } : {}),
        ...(observacoes ? { p_observacoes: observacoes } : {}),
      });
      if (error) throw error;
      return pedidoId as string;
    },
    onSuccess: (id) => {
      toast.success("Pedido criado", { description: "Estoque reservado no depósito escolhido." });
      setOpen(false);
      limpar();
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      navigate({ to: "/pedidos/$id", params: { id } });
    },
    onError: (e: Error) => toast.error("Erro ao criar pedido", { description: e.message }),
  });

  /* ---------- converter orçamento(s) em pedido ---------- */
  const [openConv, setOpenConv] = useState(false);
  const [convCliente, setConvCliente] = useState("");
  const [convDeposito, setConvDeposito] = useState("");
  const [convSelecao, setConvSelecao] = useState<string[]>([]);

  const { data: convBase } = useQuery({
    queryKey: ["orcamentos-para-pedido"],
    enabled: openConv,
    queryFn: async () => {
      const [orcRes, pedRes, linkRes, depRes] = await Promise.all([
        supabase
          .from("orcamentos")
          .select("id, numero, total, validade, cliente_id, clientes(nome)")
          .eq("situacao", "aprovado")
          .order("numero"),
        supabase.from("pedidos").select("orcamento_id, situacao"),
        supabase.from("pedido_orcamentos").select("orcamento_id, pedidos(situacao)"),
        supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      const usados = new Set<string>();
      for (const p of pedRes.data ?? []) {
        if (p.orcamento_id && p.situacao !== "cancelado") usados.add(p.orcamento_id);
      }
      for (const l of linkRes.data ?? []) {
        const s = (l.pedidos as unknown as { situacao: string } | null)?.situacao;
        if (s && s !== "cancelado") usados.add(l.orcamento_id);
      }
      return {
        orcamentos: (orcRes.data ?? []).filter((o) => !usados.has(o.id)),
        depositos: depRes.data ?? [],
      };
    },
  });

  const convClientes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const o of convBase?.orcamentos ?? []) {
      const nome = (o.clientes as unknown as { nome: string } | null)?.nome ?? "Cliente";
      if (o.cliente_id) mapa.set(o.cliente_id, nome);
    }
    return [...mapa.entries()].map(([id, nome]) => ({ id, nome }));
  }, [convBase]);

  const convOrcamentos = useMemo(
    () => (convBase?.orcamentos ?? []).filter((o) => o.cliente_id === convCliente),
    [convBase, convCliente],
  );

  const convTotal = convOrcamentos
    .filter((o) => convSelecao.includes(o.id))
    .reduce((s, o) => s + Number(o.total), 0);

  const converter = useMutation({
    mutationFn: async () => {
      if (convSelecao.length === 0) throw new Error("Escolha pelo menos um orçamento");
      if (!convDeposito) throw new Error("Escolha o depósito de saída");
      const { data: pedidoId, error } = await supabase.rpc("converter_orcamentos_em_pedido", {
        p_orcamento_ids: convSelecao,
        p_deposito_id: convDeposito,
      });
      if (error) throw error;
      return pedidoId as string;
    },
    onSuccess: (id) => {
      toast.success(
        convSelecao.length > 1
          ? `${convSelecao.length} orçamentos viraram um pedido`
          : "Orçamento convertido em pedido",
        { description: "Estoque reservado no depósito escolhido." },
      );
      setOpenConv(false);
      setConvCliente("");
      setConvDeposito("");
      setConvSelecao([]);
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      navigate({ to: "/pedidos/$id", params: { id } });
    },
    onError: (e: Error) => toast.error("Não foi possível converter", { description: e.message }),
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data ?? []).filter((p) => {
      if (filtro !== "todos" && p.situacao !== filtro) return false;
      if (!termo) return true;
      const cliente = (p.clientes as unknown as { nome: string } | null)?.nome ?? "";
      return [String(p.numero), cliente].some((v) => v.toLowerCase().includes(termo));
    });
  }, [data, busca, filtro]);

  const totais = useMemo(() => {
    const l = data ?? [];
    const emAberto = l.filter((p) => !["entregue", "concluido", "cancelado"].includes(p.situacao));
    const valor = emAberto.reduce((s, p) => s + Number(p.total), 0);
    const separacao = l.filter((p) =>
      ["separacao", "separado", "conferencia"].includes(p.situacao),
    );
    const entrega = l.filter((p) => ["pronto_entrega", "em_rota"].includes(p.situacao));
    return {
      total: l.length,
      emAberto: emAberto.length,
      valor,
      separacao: separacao.length,
      entrega: entrega.length,
    };
  }, [data]);

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Fluxo completo: pagamento, separação, conferência, expedição e entrega."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setOpenConv(true)}>
              <FileText className="mr-2 size-4" />
              Converter orçamento
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 size-4" />
              Criar pedido
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pedidos" value={num(totais.total)} />
        <StatCard label="Em andamento" value={num(totais.emAberto)} />
        <StatCard label="Em separação / conferência" value={num(totais.separacao)} />
        <StatCard label="Valor em andamento" value={brl(totais.valor)} />
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
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as situações</SelectItem>
            {situacoesPedido.map((s) => (
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
            title="Nenhum pedido encontrado."
            description="Crie o pedido direto aqui ou aprove um orçamento do cliente."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setOpen(true)}>Criar pedido</Button>
                <Button asChild variant="outline">
                  <Link to="/orcamentos">Ir para orçamentos</Link>
                </Button>
              </div>
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
                  <TableHead>Depósito</TableHead>
                  <TableHead>Previsão</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">
                      #{String(p.numero).padStart(4, "0")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {(p.clientes as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(p.obras as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(p.depositos as unknown as { nome: string } | null)?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{dateBR(p.previsao_entrega)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {brl(Number(p.total))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium ${corSituacao(p.situacao)}`}
                      >
                        {labelSituacao(p.situacao)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/pedidos/$id" params={{ id: p.id }}>
                          Abrir
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* NOVO PEDIDO */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar pedido</DialogTitle>
            <DialogDescription>
              Pedido direto, sem orçamento: ao salvar, o estoque já é reservado no depósito
              escolhido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Cliente (digite o nome)</Label>
                <ClienteCombobox
                  clientes={base?.clientes ?? []}
                  value={clienteId}
                  onChange={(v) => {
                    setClienteId(v);
                    setObraId("");
                  }}
                />
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
                <Label>Depósito de saída</Label>
                <Select value={depositoId} onValueChange={setDepositoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o depósito" />
                  </SelectTrigger>
                  <SelectContent>
                    {(base?.depositos ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                              qtdTexto: "1",
                              preco_unitario: Number(p.preco_venda ?? 0),
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
                        <span className="font-semibold">{brl(Number(p.preco_venda ?? 0))}</span>
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
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({i.unidade})
                            </span>
                          </TableCell>
                          <TableCell>
                            <Input
                              inputMode="decimal"
                              aria-label={`Quantidade em ${i.unidade}`}
                              value={i.qtdTexto}
                              onChange={(e) => {
                                const texto = e.target.value.replace(/[^0-9.,]/g, "");
                                setItens((prev) =>
                                  prev.map((x, j) =>
                                    j === idx
                                      ? { ...x, qtdTexto: texto, quantidade: parseQtd(texto) }
                                      : x,
                                  ),
                                );
                              }}
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
                                    j === idx
                                      ? { ...x, preco_unitario: Number(e.target.value) }
                                      : x,
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

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="ped-prev">Previsão de entrega</Label>
                <Input
                  id="ped-prev"
                  type="date"
                  value={previsao}
                  onChange={(e) => setPrevisao(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ped-cond">Condição de pagamento</Label>
                <Input
                  id="ped-cond"
                  value={condicao}
                  onChange={(e) => setCondicao(e.target.value)}
                  placeholder="Ex.: 30/60 dias"
                />
              </div>
              <div />
              <div>
                <Label htmlFor="ped-desc">Desconto geral (R$)</Label>
                <Input
                  id="ped-desc"
                  type="number"
                  min="0"
                  step="0.01"
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ped-frete">Frete (R$)</Label>
                <Input
                  id="ped-frete"
                  type="number"
                  min="0"
                  step="0.01"
                  value={frete}
                  onChange={(e) => setFrete(e.target.value)}
                />
              </div>
              <div />
              <CodigoPessoa
                id="ped-cod-vendedor"
                label="Código do vendedor"
                codigo={codVendedor}
                onCodigo={setCodVendedor}
                onResolver={setVendedorId}
                pessoas={base?.vendedores ?? []}
              />
              <CodigoPessoa
                id="ped-cod-profissional"
                label="Código do profissional"
                codigo={codProfissional}
                onCodigo={setCodProfissional}
                onResolver={setProfissionalId}
                pessoas={base?.profissionais ?? []}
              />
            </div>

            <div>
              <Label htmlFor="ped-obs">Observações</Label>
              <Textarea
                id="ped-obs"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-6 rounded-lg bg-secondary px-4 py-3 text-sm">
              <span>
                Subtotal <strong className="ml-1">{brl(subtotalNovo)}</strong>
              </span>
              <span>
                Total <strong className="ml-1 text-lg">{brl(totalNovo)}</strong>
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => criar.mutate()}
              disabled={!clienteId || !depositoId || itens.length === 0 || criar.isPending}
            >
              Salvar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openConv} onOpenChange={setOpenConv}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Converter orçamento em pedido</DialogTitle>
            <DialogDescription>
              Escolha o cliente e marque um ou vários orçamentos aprovados. Vários orçamentos do
              mesmo cliente viram um único pedido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Cliente</Label>
              <Select
                value={convCliente}
                onValueChange={(v) => {
                  setConvCliente(v);
                  setConvSelecao([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Cliente com orçamento aprovado" />
                </SelectTrigger>
                <SelectContent>
                  {convClientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {convClientes.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhum orçamento aprovado aguardando conversão.
                </p>
              )}
            </div>

            {convCliente && (
              <div className="rounded-lg border border-border">
                {convOrcamentos.map((o) => {
                  const marcado = convSelecao.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0"
                    >
                      <Checkbox
                        checked={marcado}
                        onCheckedChange={(v) =>
                          setConvSelecao((atual) =>
                            v ? [...atual, o.id] : atual.filter((x) => x !== o.id),
                          )
                        }
                      />
                      <span className="flex-1 text-sm">
                        Orçamento nº {o.numero}
                        {o.validade && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            válido até {dateBR(o.validade)}
                          </span>
                        )}
                      </span>
                      <span className="text-numeric text-sm font-semibold">
                        {brl(Number(o.total))}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div>
              <Label>Depósito de saída</Label>
              <Select value={convDeposito} onValueChange={setConvDeposito}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o depósito" />
                </SelectTrigger>
                <SelectContent>
                  {(convBase?.depositos ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {convSelecao.length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-secondary px-4 py-3 text-sm">
                <span>{convSelecao.length} orçamento(s) selecionado(s)</span>
                <span>
                  Total <strong className="ml-1 text-lg">{brl(convTotal)}</strong>
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenConv(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => converter.mutate()}
              disabled={convSelecao.length === 0 || !convDeposito || converter.isPending}
            >
              Gerar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
