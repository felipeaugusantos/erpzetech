import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR, dateTimeBR, num } from "@/lib/format";
import {
  corCompra,
  divergencias,
  labelCompra,
  podeReceber,
  proximasCompra,
  somaDias,
  hojeISO,
} from "@/lib/financeiro";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/compras/$id")({
  head: () => ({
    meta: [
      { title: "Pedido de compra — Ze Obra" },
      { name: "description", content: "Itens, cotações e recebimento do pedido de compra." },
      { property: "og:title", content: "Pedido de compra — Ze Obra" },
      { property: "og:description", content: "Acompanhe a compra do pedido ao recebimento." },
    ],
  }),
  component: CompraDetalhe,
});

type RecebItem = {
  compra_item_id: string;
  quantidade: string;
  custo_unitario: string;
  divergencia: string;
  divergencia_obs: string;
};

function CompraDetalhe() {
  const { id } = Route.useParams();
  const { data: session } = useSessionData();
  const tenantId = session?.profile?.tenant_id ?? null;
  const queryClient = useQueryClient();

  const [buscaProduto, setBuscaProduto] = useState("");
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cotacaoAberta, setCotacaoAberta] = useState(false);
  const [cotForn, setCotForn] = useState("");
  const [cotValor, setCotValor] = useState("");
  const [cotPrazo, setCotPrazo] = useState("");
  const [cotCondicao, setCotCondicao] = useState("");
  const [cotObs, setCotObs] = useState("");
  const [recebAberto, setRecebAberto] = useState(false);
  const [documento, setDocumento] = useState("");
  const [gerarConta, setGerarConta] = useState("sim");
  const [vencimento, setVencimento] = useState(somaDias(hojeISO(), 28));
  const [parcelas, setParcelas] = useState("1");
  const [recebItens, setRecebItens] = useState<RecebItem[]>([]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["compra", id] });
    void queryClient.invalidateQueries({ queryKey: ["compra-itens", id] });
    void queryClient.invalidateQueries({ queryKey: ["compra-cotacoes", id] });
    void queryClient.invalidateQueries({ queryKey: ["compra-recebimentos", id] });
    void queryClient.invalidateQueries({ queryKey: ["compras"] });
  };

  const { data: compra, isLoading } = useQuery({
    queryKey: ["compra", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("*, fornecedores(razao_social), depositos(nome)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["compra-itens", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compra_itens")
        .select("*, produtos(codigo_interno, descricao, unidade)")
        .eq("compra_id", id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: cotacoes = [] } = useQuery({
    queryKey: ["compra-cotacoes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compra_cotacoes")
        .select("*, fornecedores(razao_social)")
        .eq("compra_id", id)
        .order("valor_total");
      if (error) throw error;
      return data;
    },
  });

  const { data: recebimentos = [] } = useQuery({
    queryKey: ["compra-recebimentos", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compra_recebimentos")
        .select(
          "*, compra_recebimento_itens(quantidade, custo_unitario, divergencia, divergencia_obs, produtos(codigo_interno, descricao))",
        )
        .eq("compra_id", id)
        .order("data_recebimento", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("id, razao_social")
        .eq("ativo", true)
        .order("razao_social");
      if (error) throw error;
      return data;
    },
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-busca-compra", buscaProduto],
    enabled: buscaProduto.trim().length >= 2,
    queryFn: async () => {
      const t = buscaProduto.trim();
      const { data, error } = await supabase
        .from("produtos")
        .select("id, codigo_interno, descricao, unidade, custo")
        .eq("ativo", true)
        .or(`descricao.ilike.%${t}%,codigo_interno.ilike.%${t}%,codigo_barras.ilike.%${t}%`)
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  const editavel = compra ? ["rascunho", "cotacao"].includes(compra.situacao) : false;

  const adicionar = useMutation({
    mutationFn: async (produto: {
      id: string;
      unidade: string;
      custo: number;
      descricao: string;
    }) => {
      if (!tenantId) throw new Error("Usuário sem empresa vinculada");
      const { error } = await supabase.from("compra_itens").insert({
        tenant_id: tenantId,
        compra_id: id,
        produto_id: produto.id,
        quantidade: 1,
        unidade: produto.unidade,
        custo_unitario: produto.custo,
        total: Number(produto.custo),
      });
      if (error) throw error;
      const { error: e2 } = await supabase.rpc("recalcular_compra", { p_id: id });
      if (e2) throw e2;
    },
    onSuccess: () => {
      setBuscaProduto("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizarItem = useMutation({
    mutationFn: async (p: { itemId: string; quantidade: number; custo: number }) => {
      const { error } = await supabase
        .from("compra_itens")
        .update({
          quantidade: p.quantidade,
          custo_unitario: p.custo,
          total: Number((p.quantidade * p.custo).toFixed(2)),
        })
        .eq("id", p.itemId);
      if (error) throw error;
      const { error: e2 } = await supabase.rpc("recalcular_compra", { p_id: id });
      if (e2) throw e2;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const removerItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from("compra_itens").delete().eq("id", itemId);
      if (error) throw error;
      const { error: e2 } = await supabase.rpc("recalcular_compra", { p_id: id });
      if (e2) throw e2;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const definirFornecedor = useMutation({
    mutationFn: async (fornecedorId: string) => {
      const { error } = await supabase
        .from("compras")
        .update({ fornecedor_id: fornecedorId })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const avancar = useMutation({
    mutationFn: async (p: { situacao: string; observacao?: string }) => {
      const { error } = await supabase.rpc("compra_avancar_status", {
        p_compra_id: id,
        p_situacao: p.situacao as never,
        ...(p.observacao ? { p_observacao: p.observacao } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada.");
      setCancelarAberto(false);
      setMotivo("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criarCotacao = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Usuário sem empresa vinculada");
      if (!cotForn) throw new Error("Selecione o fornecedor da cotação");
      const { error } = await supabase.from("compra_cotacoes").insert({
        tenant_id: tenantId,
        compra_id: id,
        fornecedor_id: cotForn,
        valor_total: Number(cotValor.replace(",", ".") || 0),
        prazo_entrega_dias: cotPrazo ? Number(cotPrazo) : null,
        condicao_pagamento: cotCondicao || null,
        observacao: cotObs || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cotação registrada.");
      setCotacaoAberta(false);
      setCotForn("");
      setCotValor("");
      setCotPrazo("");
      setCotCondicao("");
      setCotObs("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const escolherCotacao = useMutation({
    mutationFn: async (cotacaoId: string) => {
      const { error } = await supabase.rpc("compra_escolher_cotacao", { p_cotacao_id: cotacaoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cotação escolhida.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const receber = useMutation({
    mutationFn: async () => {
      const payload = recebItens
        .filter((i) => Number(i.quantidade.replace(",", ".") || 0) > 0)
        .map((i) => ({
          compra_item_id: i.compra_item_id,
          quantidade: Number(i.quantidade.replace(",", ".")),
          custo_unitario: Number(i.custo_unitario.replace(",", ".") || 0),
          divergencia: i.divergencia,
          divergencia_obs: i.divergencia_obs,
        }));
      if (payload.length === 0) throw new Error("Informe a quantidade recebida de algum item");
      const { error } = await supabase.rpc("receber_compra", {
        p_compra_id: id,
        p_itens: payload,
        p_documento: documento || "",
        p_observacao: "",
        p_gerar_conta: gerarConta === "sim",
        p_vencimento: vencimento,
        p_parcelas: Number(parcelas || 1),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recebimento registrado e estoque atualizado.");
      setRecebAberto(false);
      setDocumento("");
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["contas-pagar"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendentes = useMemo(
    () =>
      itens.filter(
        (i) => Number(i.quantidade) - Number(i.quantidade_recebida) > 0.001,
      ),
    [itens],
  );

  function abrirRecebimento() {
    setRecebItens(
      pendentes.map((i) => ({
        compra_item_id: i.id,
        quantidade: String(Number(i.quantidade) - Number(i.quantidade_recebida)),
        custo_unitario: String(Number(i.custo_unitario)),
        divergencia: "",
        divergencia_obs: "",
      })),
    );
    setRecebAberto(true);
  }

  if (isLoading) return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!compra)
    return (
      <EmptyState
        title="Compra não encontrada."
        action={
          <Button asChild>
            <Link to="/compras">Voltar para compras</Link>
          </Button>
        }
      />
    );

  const proximas = proximasCompra(compra.situacao).filter((s) => s !== "cancelado");

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/compras">
          <ArrowLeft className="size-4" /> Compras
        </Link>
      </Button>

      <PageHeader
        title={`Compra nº ${compra.numero}`}
        description={`${(compra.fornecedores as { razao_social: string } | null)?.razao_social ?? "Fornecedor não definido"} · entrada em ${(compra.depositos as { nome: string } | null)?.nome ?? "—"}`}
        actions={
          <>
            {proximas.map((s) => (
              <Button key={s} onClick={() => avancar.mutate({ situacao: s })}>
                {labelCompra(s)}
              </Button>
            ))}
            {podeReceber(compra.situacao) && (
              <Button variant="outline" onClick={abrirRecebimento}>
                <PackageCheck className="size-4" /> Registrar recebimento
              </Button>
            )}
            {!["recebido", "cancelado"].includes(compra.situacao) && (
              <Button variant="outline" onClick={() => setCancelarAberto(true)}>
                Cancelar compra
              </Button>
            )}
          </>
        }
      />

      <div className="panel mb-5 flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={corCompra(compra.situacao)}>{labelCompra(compra.situacao)}</Badge>
          <span className="text-sm text-muted-foreground">
            Previsão: {dateBR(compra.previsao_entrega)}
          </span>
          {compra.condicao_pagamento && (
            <span className="text-sm text-muted-foreground">
              Pagamento: {compra.condicao_pagamento}
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="font-display text-2xl font-bold text-numeric">{brl(Number(compra.total))}</p>
        </div>
      </div>

      {editavel && (
        <div className="panel mb-5 p-4">
          <Label>Fornecedor</Label>
          <Select
            value={compra.fornecedor_id ?? ""}
            onValueChange={(v) => definirFornecedor.mutate(v)}
          >
            <SelectTrigger className="mt-1 max-w-md">
              <SelectValue placeholder="Selecionar fornecedor" />
            </SelectTrigger>
            <SelectContent>
              {fornecedores.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.razao_social}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="panel mb-5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Itens</h2>
          {editavel && (
            <div className="relative min-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar produto por código ou descrição"
                value={buscaProduto}
                onChange={(e) => setBuscaProduto(e.target.value)}
              />
              {produtos.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                  {produtos.map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                      onClick={() =>
                        adicionar.mutate({
                          id: p.id,
                          unidade: p.unidade,
                          custo: Number(p.custo),
                          descricao: p.descricao,
                        })
                      }
                    >
                      <span className="truncate">
                        <span className="text-numeric text-xs text-muted-foreground">
                          {p.codigo_interno}
                        </span>{" "}
                        {p.descricao}
                      </span>
                      <span className="text-numeric text-xs">{brl(Number(p.custo))}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {itens.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum item nesta compra. {editavel ? "Busque um produto acima." : ""}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-28 text-right">Quantidade</TableHead>
                  <TableHead className="w-28 text-right">Custo</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  {editavel && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((i) => {
                  const prod = i.produtos as {
                    codigo_interno: string;
                    descricao: string;
                    unidade: string;
                  } | null;
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <p className="font-medium">{prod?.descricao ?? "—"}</p>
                        <p className="text-numeric text-xs text-muted-foreground">
                          {prod?.codigo_interno} · {i.unidade ?? prod?.unidade}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        {editavel ? (
                          <Input
                            className="ml-auto w-24 text-right"
                            defaultValue={String(Number(i.quantidade))}
                            onBlur={(e) =>
                              atualizarItem.mutate({
                                itemId: i.id,
                                quantidade: Number(e.target.value.replace(",", ".") || 0),
                                custo: Number(i.custo_unitario),
                              })
                            }
                          />
                        ) : (
                          <span className="text-numeric">{num(Number(i.quantidade), 3)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editavel ? (
                          <Input
                            className="ml-auto w-24 text-right"
                            defaultValue={String(Number(i.custo_unitario))}
                            onBlur={(e) =>
                              atualizarItem.mutate({
                                itemId: i.id,
                                quantidade: Number(i.quantidade),
                                custo: Number(e.target.value.replace(",", ".") || 0),
                              })
                            }
                          />
                        ) : (
                          <span className="text-numeric">{brl(Number(i.custo_unitario))}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(i.total))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(Number(i.quantidade_recebida), 3)}
                      </TableCell>
                      {editavel && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removerItem.mutate(i.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="panel mb-5 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Cotações</h2>
          {editavel && (
            <Button variant="outline" size="sm" onClick={() => setCotacaoAberta(true)}>
              <Plus className="size-4" /> Nova cotação
            </Button>
          )}
        </div>
        {cotacoes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhuma cotação registrada.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Prazo</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cotacoes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {(c.fornecedores as { razao_social: string } | null)?.razao_social}
                    {c.escolhida && (
                      <Badge className="ml-2 bg-success/15 text-success">Escolhida</Badge>
                    )}
                    {c.observacao && (
                      <p className="text-xs text-muted-foreground">{c.observacao}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(c.valor_total))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {c.prazo_entrega_dias ?? 0} d
                  </TableCell>
                  <TableCell className="text-sm">{c.condicao_pagamento ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {!c.escolhida && editavel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => escolherCotacao.mutate(c.id)}
                      >
                        Escolher
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Recebimentos</h2>
        {recebimentos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum recebimento registrado.
          </p>
        ) : (
          <div className="space-y-3">
            {recebimentos.map((r) => (
              <div key={r.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Recebimento nº {r.numero} {r.documento ? `· NF ${r.documento}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateTimeBR(r.data_recebimento)}
                  </p>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {(
                    (r.compra_recebimento_itens ?? []) as {
                      quantidade: number;
                      custo_unitario: number;
                      divergencia: string | null;
                      divergencia_obs: string | null;
                      produtos: { codigo_interno: string; descricao: string } | null;
                    }[]
                  ).map((it, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-2">
                      <span className="text-numeric">{num(Number(it.quantidade), 3)}</span>
                      <span>{it.produtos?.descricao}</span>
                      <span className="text-xs text-muted-foreground">
                        {brl(Number(it.custo_unitario))}
                      </span>
                      {it.divergencia && (
                        <Badge className="bg-destructive/15 text-destructive">
                          {divergencias.find((d) => d.value === it.divergencia)?.label ??
                            it.divergencia}
                          {it.divergencia_obs ? ` — ${it.divergencia_obs}` : ""}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={cotacaoAberta} onOpenChange={setCotacaoAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova cotação</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Fornecedor</Label>
              <Select value={cotForn} onValueChange={setCotForn}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.razao_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Valor total</Label>
                <Input value={cotValor} onChange={(e) => setCotValor(e.target.value)} />
              </div>
              <div>
                <Label>Prazo de entrega (dias)</Label>
                <Input
                  inputMode="numeric"
                  value={cotPrazo}
                  onChange={(e) => setCotPrazo(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Condição de pagamento</Label>
              <Input value={cotCondicao} onChange={(e) => setCotCondicao(e.target.value)} />
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea value={cotObs} onChange={(e) => setCotObs(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCotacaoAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criarCotacao.mutate()} disabled={criarCotacao.isPending}>
              Salvar cotação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recebAberto} onOpenChange={setRecebAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Nota fiscal / documento</Label>
                <Input value={documento} onChange={(e) => setDocumento(e.target.value)} />
              </div>
              <div>
                <Label>Gerar conta a pagar</Label>
                <Select value={gerarConta} onValueChange={setGerarConta}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {gerarConta === "sim" && (
                <>
                  <div>
                    <Label>Primeiro vencimento</Label>
                    <Input
                      type="date"
                      value={vencimento}
                      onChange={(e) => setVencimento(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Parcelas</Label>
                    <Input
                      inputMode="numeric"
                      value={parcelas}
                      onChange={(e) => setParcelas(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="w-24 text-right">Receber</TableHead>
                    <TableHead className="w-24 text-right">Custo</TableHead>
                    <TableHead className="w-56">Divergência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recebItens.map((r, idx) => {
                    const item = pendentes.find((p) => p.id === r.compra_item_id);
                    const prod = item?.produtos as
                      | { codigo_interno: string; descricao: string }
                      | null
                      | undefined;
                    return (
                      <TableRow key={r.compra_item_id}>
                        <TableCell>
                          <p className="text-sm font-medium">{prod?.descricao}</p>
                          <p className="text-numeric text-xs text-muted-foreground">
                            Pendente:{" "}
                            {num(
                              Number(item?.quantidade ?? 0) -
                                Number(item?.quantidade_recebida ?? 0),
                              3,
                            )}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-20 text-right"
                            value={r.quantidade}
                            onChange={(e) => {
                              const copia = [...recebItens];
                              copia[idx] = { ...r, quantidade: e.target.value };
                              setRecebItens(copia);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-20 text-right"
                            value={r.custo_unitario}
                            onChange={(e) => {
                              const copia = [...recebItens];
                              copia[idx] = { ...r, custo_unitario: e.target.value };
                              setRecebItens(copia);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.divergencia || "nenhuma"}
                            onValueChange={(v) => {
                              const copia = [...recebItens];
                              copia[idx] = { ...r, divergencia: v === "nenhuma" ? "" : v };
                              setRecebItens(copia);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="nenhuma">Sem divergência</SelectItem>
                              {divergencias.map((d) => (
                                <SelectItem key={d.value} value={d.value}>
                                  {d.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {r.divergencia && (
                            <Input
                              className="mt-1"
                              placeholder="Observação da divergência"
                              value={r.divergencia_obs}
                              onChange={(e) => {
                                const copia = [...recebItens];
                                copia[idx] = { ...r, divergencia_obs: e.target.value };
                                setRecebItens(copia);
                              }}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Itens marcados como “produto errado” não entram no estoque, mas ficam registrados na
              conferência do recebimento.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecebAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => receber.mutate()} disabled={receber.isPending}>
              Confirmar recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelarAberto} onOpenChange={setCancelarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar compra</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Motivo do cancelamento</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelarAberto(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => avancar.mutate({ situacao: "cancelado", observacao: motivo })}
            >
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
