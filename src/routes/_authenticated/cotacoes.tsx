import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, ShoppingCart, Trophy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/cotacoes")({
  head: () => ({
    meta: [
      { title: "Cotações de compra — Ze Obra" },
      {
        name: "description",
        content:
          "Compare os preços dos fornecedores e gere o pedido de compra com o custo atualizado do produto.",
      },
      { property: "og:title", content: "Cotações de compra — Ze Obra" },
      { property: "og:description", content: "Comparativo de fornecedores e geração do pedido de compra." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cotacoes,
});

type Cotacao = {
  id: string;
  fornecedor_id: string;
  valor_total: number;
  prazo_entrega_dias: number | null;
  condicao_pagamento: string | null;
  observacao: string | null;
  escolhida: boolean;
  fornecedores: { nome_fantasia: string | null; razao_social: string } | null;
};

type CompraItem = {
  produto_id: string;
  quantidade: number;
  unidade: string;
  custo_unitario: number;
  total: number;
  produtos: { descricao: string; codigo_interno: string; custo: number } | null;
};

const nomeFornecedor = (f: Cotacao["fornecedores"]) =>
  f?.nome_fantasia?.trim() || f?.razao_social || "—";

function Cotacoes() {
  const queryClient = useQueryClient();
  const { data: sessao } = useSessionData();
  const tenantId = sessao?.profile?.tenant_id ?? null;
  const [compraId, setCompraId] = useState("");
  const [novaAberta, setNovaAberta] = useState(false);
  const [fornecedorId, setFornecedorId] = useState("");
  const [valor, setValor] = useState("");
  const [prazo, setPrazo] = useState("");
  const [condicao, setCondicao] = useState("");
  const [obs, setObs] = useState("");

  const { data: compras = [], isLoading } = useQuery({
    queryKey: ["compras-cotacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select(
          "id, numero, situacao, subtotal, total, created_at, compra_itens(produto_id, quantidade, unidade, custo_unitario, total, produtos(descricao, codigo_interno, custo)), compra_cotacoes(id, fornecedor_id, valor_total, prazo_entrega_dias, condicao_pagamento, observacao, escolhida, fornecedores(nome_fantasia, razao_social))",
        )
        .in("situacao", ["rascunho", "cotacao"])
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("id, razao_social, nome_fantasia")
        .eq("ativo", true)
        .order("razao_social");
      if (error) throw error;
      return data;
    },
  });

  const compraAtual = useMemo(
    () => compras.find((c) => c.id === compraId) ?? compras[0],
    [compras, compraId],
  );

  const itens = (compraAtual?.compra_itens ?? []) as unknown as CompraItem[];
  const cotacoes = ((compraAtual?.compra_cotacoes ?? []) as unknown as Cotacao[])
    .slice()
    .sort((a, b) => Number(a.valor_total) - Number(b.valor_total));
  const melhor = cotacoes[0];
  const baseItens = itens.reduce((s, i) => s + Number(i.total), 0);

  const registrar = useMutation({
    mutationFn: async () => {
      if (!compraAtual) throw new Error("Escolha a compra");
      if (!fornecedorId) throw new Error("Escolha o fornecedor");
      if (!tenantId) throw new Error("Usuário sem empresa vinculada");
      const v = Number(valor.replace(",", "."));
      if (!(v > 0)) throw new Error("Informe o valor total da proposta");
      const { error } = await supabase.from("compra_cotacoes").insert({
        tenant_id: tenantId,
        compra_id: compraAtual.id,
        fornecedor_id: fornecedorId,
        valor_total: v,
        prazo_entrega_dias: prazo ? Number(prazo) : null,
        condicao_pagamento: condicao || null,
        observacao: obs || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proposta registrada.");
      setNovaAberta(false);
      setFornecedorId("");
      setValor("");
      setPrazo("");
      setCondicao("");
      setObs("");
      void queryClient.invalidateQueries({ queryKey: ["compras-cotacao"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aplicar = useMutation({
    mutationFn: async (cotacaoId: string) => {
      const { error } = await supabase.rpc("compra_aplicar_cotacao", { p_cotacao_id: cotacaoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido de compra gerado e custo dos produtos atualizado.");
      setCompraId("");
      void queryClient.invalidateQueries({ queryKey: ["compras-cotacao"] });
      void queryClient.invalidateQueries({ queryKey: ["compras"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Cotações de compra"
        description="Compare as propostas dos fornecedores e gere o pedido de compra com o custo já atualizado."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/compras">Pedidos de compra</Link>
            </Button>
            <Button onClick={() => setNovaAberta(true)} disabled={!compraAtual}>
              <Plus className="size-4" /> Nova proposta
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Compras em cotação" value={String(compras.length)} icon={ShoppingCart} />
        <StatCard
          label="Propostas nesta compra"
          value={String(cotacoes.length)}
          icon={Trophy}
          tone={cotacoes.length > 1 ? "accent" : "default"}
        />
        <StatCard
          label="Melhor proposta"
          value={melhor ? brl(Number(melhor.valor_total)) : "—"}
          hint={melhor ? nomeFornecedor(melhor.fornecedores) : "Registre uma proposta"}
          tone={melhor ? "success" : "default"}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : compras.length === 0 ? (
        <EmptyState
          title="Nenhuma compra em cotação."
          description="Crie um pedido de compra ou use a sugestão pelo estoque mínimo para começar a cotar."
          action={
            <Button asChild>
              <Link to="/compras">Ir para compras</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="panel mb-4 p-3">
            <Label>Compra</Label>
            <Select value={compraAtual?.id ?? ""} onValueChange={setCompraId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {compras.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    #{String(c.numero).padStart(4, "0")} —{" "}
                    {((c.compra_itens as unknown as CompraItem[]) ?? []).length} produto(s) ·{" "}
                    {brl(Number(c.total))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="panel mb-5 p-4">
            <h2 className="mb-3 font-display text-lg font-semibold">Comparativo de fornecedores</h2>
            {cotacoes.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Nenhuma proposta registrada para esta compra. Clique em “Nova proposta”.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Valor total</TableHead>
                      <TableHead className="text-right">Diferença</TableHead>
                      <TableHead>Prazo</TableHead>
                      <TableHead>Pagamento</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cotacoes.map((q, idx) => {
                      const diff = Number(q.valor_total) - Number(melhor?.valor_total ?? 0);
                      const pct =
                        melhor && Number(melhor.valor_total) > 0
                          ? (diff / Number(melhor.valor_total)) * 100
                          : 0;
                      return (
                        <TableRow key={q.id}>
                          <TableCell>
                            <p className="font-medium">{nomeFornecedor(q.fornecedores)}</p>
                            {idx === 0 && (
                              <Badge className="mt-1 bg-success/15 text-success">Melhor preço</Badge>
                            )}
                            {q.escolhida && (
                              <Badge className="ml-1 mt-1 bg-primary/15 text-primary">Escolhida</Badge>
                            )}
                            {q.observacao && (
                              <p className="mt-1 text-xs text-muted-foreground">{q.observacao}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-numeric font-medium">
                            {brl(Number(q.valor_total))}
                          </TableCell>
                          <TableCell className="text-right text-numeric text-sm">
                            {idx === 0 ? (
                              <span className="text-success">—</span>
                            ) : (
                              <span className="text-destructive">
                                +{brl(diff)} ({num(pct)}%)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {q.prazo_entrega_dias ? `${q.prazo_entrega_dias} dia(s)` : "—"}
                          </TableCell>
                          <TableCell className="text-sm">{q.condicao_pagamento ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() => aplicar.mutate(q.id)}
                              disabled={aplicar.isPending}
                            >
                              <Check className="size-4" /> Escolher e gerar pedido
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

          <div className="panel p-4">
            <h2 className="mb-1 font-display text-lg font-semibold">Custo por produto</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              A coluna “Custo na proposta” mostra como ficará o custo de cada produto se a melhor
              proposta for escolhida.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Custo atual</TableHead>
                    <TableHead className="text-right">Custo na proposta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((i) => {
                    const fator =
                      melhor && baseItens > 0 ? Number(melhor.valor_total) / baseItens : 1;
                    const novo = Number(i.custo_unitario) * fator;
                    const atual = Number(i.produtos?.custo ?? 0);
                    return (
                      <TableRow key={i.produto_id}>
                        <TableCell>
                          <p className="font-medium">{i.produtos?.descricao ?? "—"}</p>
                          <p className="text-xs text-muted-foreground text-numeric">
                            {i.produtos?.codigo_interno ?? ""}
                          </p>
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(i.quantidade)} {i.unidade}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{brl(atual)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          <span className={novo > atual && atual > 0 ? "text-destructive" : "text-success"}>
                            {brl(novo)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova proposta de fornecedor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Fornecedor</Label>
              <Select value={fornecedorId} onValueChange={setFornecedorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome_fantasia?.trim() || f.razao_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor total</Label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <Label>Prazo de entrega (dias)</Label>
              <Input value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="7" />
            </div>
            <div className="sm:col-span-2">
              <Label>Condição de pagamento</Label>
              <Input
                value={condicao}
                onChange={(e) => setCondicao(e.target.value)}
                placeholder="30/60 dias"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Observação</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => registrar.mutate()} disabled={registrar.isPending}>
              Registrar proposta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
