import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Gauge, Plus, ShoppingCart, Trophy, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, num } from "@/lib/format";
import {
  avaliarPropostas,
  baixarArquivo,
  csvCotacao,
  lerRespostaCotacao,
  type ItemCotacao,
} from "@/lib/cotacao";
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
      { title: "Cotações de compra — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Envie a planilha de cotação ao fornecedor, importe a resposta e gere o pedido de compra com o melhor preço, prazo e condição de pagamento.",
      },
      { property: "og:title", content: "Cotações de compra — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Comparativo de fornecedores, planilha de cotação e geração do pedido de compra.",
      },
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
  id: string;
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
  const [importarPara, setImportarPara] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);

  const { data: compras = [], isLoading } = useQuery({
    queryKey: ["compras-cotacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select(
          "id, numero, situacao, subtotal, total, created_at, compra_itens(id, produto_id, quantidade, unidade, custo_unitario, total, produtos(descricao, codigo_interno, custo)), compra_cotacoes(id, fornecedor_id, valor_total, prazo_entrega_dias, condicao_pagamento, observacao, escolhida, fornecedores(nome_fantasia, razao_social))",
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
  const cotacoes = (compraAtual?.compra_cotacoes ?? []) as unknown as Cotacao[];

  const { data: itensCotados = [] } = useQuery({
    queryKey: ["cotacao-itens", compraAtual?.id],
    enabled: Boolean(compraAtual?.id) && cotacoes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compra_cotacao_itens")
        .select("id, cotacao_id, compra_item_id, produto_id, quantidade, custo_unitario, total")
        .in(
          "cotacao_id",
          cotacoes.map((c) => c.id),
        );
      if (error) throw error;
      return data;
    },
  });

  const respondidosPorCotacao = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of itensCotados) {
      if (Number(i.custo_unitario) > 0)
        mapa.set(i.cotacao_id, (mapa.get(i.cotacao_id) ?? 0) + 1);
    }
    return mapa;
  }, [itensCotados]);

  const avaliadas = useMemo(
    () =>
      avaliarPropostas(
        cotacoes.map((q) => ({
          id: q.id,
          fornecedor: nomeFornecedor(q.fornecedores),
          valor_total: Number(q.valor_total),
          prazo_entrega_dias: q.prazo_entrega_dias,
          condicao_pagamento: q.condicao_pagamento,
          itens_respondidos: respondidosPorCotacao.get(q.id) ?? 0,
        })),
      ),
    [cotacoes, respondidosPorCotacao],
  );

  const recomendada = avaliadas.find((a) => a.recomendada);
  const baseItens = itens.reduce((s, i) => s + Number(i.total), 0);

  const itensPlanilha: ItemCotacao[] = itens.map((i) => ({
    compra_item_id: i.id,
    codigo: i.produtos?.codigo_interno ?? "",
    descricao: i.produtos?.descricao ?? "",
    unidade: i.unidade || "UN",
    quantidade: Number(i.quantidade),
    custo_atual: Number(i.custo_unitario),
  }));

  const exportar = (nomeArquivo: string) => {
    if (itensPlanilha.length === 0) {
      toast.error("Inclua produtos na compra antes de exportar.");
      return;
    }
    baixarArquivo(nomeArquivo, csvCotacao(itensPlanilha));
    toast.success("Planilha gerada. Envie ao fornecedor e depois importe a resposta.");
  };

  const importar = useMutation({
    mutationFn: async ({ cotacaoId, texto }: { cotacaoId: string; texto: string }) => {
      const resposta = lerRespostaCotacao(texto, itensPlanilha);
      if (resposta.itens.length === 0)
        throw new Error("Nenhum preço válido encontrado na planilha importada.");
      const { error } = await supabase.rpc("cotacao_registrar_itens", {
        p_cotacao_id: cotacaoId,
        p_itens: resposta.itens.map((i) => ({
          compra_item_id: i.compra_item_id,
          custo_unitario: i.custo_unitario,
          observacao: i.observacao,
        })),
        ...(resposta.prazo_entrega_dias !== null
          ? { p_prazo_entrega_dias: resposta.prazo_entrega_dias }
          : {}),
        ...(resposta.condicao_pagamento
          ? { p_condicao_pagamento: resposta.condicao_pagamento }
          : {}),
      });
      if (error) throw error;
      return resposta;
    },
    onSuccess: (resposta) => {
      toast.success(
        `${resposta.itens.length} preço(s) importado(s).${
          resposta.ignoradas > 0 ? ` ${resposta.ignoradas} linha(s) sem preço foram ignoradas.` : ""
        }`,
      );
      void queryClient.invalidateQueries({ queryKey: ["compras-cotacao"] });
      void queryClient.invalidateQueries({ queryKey: ["cotacao-itens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registrar = useMutation({
    mutationFn: async () => {
      if (!compraAtual) throw new Error("Escolha a compra");
      if (!fornecedorId) throw new Error("Escolha o fornecedor");
      if (!tenantId) throw new Error("Usuário sem empresa vinculada");
      const v = Number(valor.replace(",", "."));
      const { error } = await supabase.from("compra_cotacoes").insert({
        tenant_id: tenantId,
        compra_id: compraAtual.id,
        fornecedor_id: fornecedorId,
        valor_total: v > 0 ? v : 0,
        prazo_entrega_dias: prazo ? Number(prazo) : null,
        condicao_pagamento: condicao || null,
        observacao: obs || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proposta registrada. Agora importe a planilha do fornecedor.");
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

  const custoNaProposta = (item: CompraItem, cotacaoId?: string) => {
    if (cotacaoId) {
      const encontrado = itensCotados.find(
        (i) => i.cotacao_id === cotacaoId && i.compra_item_id === item.id,
      );
      if (encontrado && Number(encontrado.custo_unitario) > 0)
        return Number(encontrado.custo_unitario);
      const cot = cotacoes.find((c) => c.id === cotacaoId);
      const fator =
        cot && baseItens > 0 && Number(cot.valor_total) > 0
          ? Number(cot.valor_total) / baseItens
          : 1;
      return Number(item.custo_unitario) * fator;
    }
    return Number(item.custo_unitario);
  };

  return (
    <div>
      <PageHeader
        title="Cotações de compra"
        description="Gere a planilha para o fornecedor, importe a resposta com preços e prazos e feche com a melhor proposta."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/giro-estoque">
                <Gauge className="size-4" /> Giro e sugestão
              </Link>
            </Button>
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
          value={recomendada ? brl(recomendada.valor_total) : "—"}
          hint={recomendada ? `${recomendada.fornecedor} · nota ${recomendada.pontos}/100` : "Registre uma proposta"}
          tone={recomendada ? "success" : "default"}
        />
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : compras.length === 0 ? (
        <EmptyState
          title="Nenhuma compra em cotação."
          description="Crie um pedido de compra ou use a sugestão pelo giro de estoque para começar a cotar."
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportar(
                    `cotacao-${String(compraAtual?.numero ?? 0).padStart(4, "0")}.csv`,
                  )
                }
              >
                <Download className="size-4" /> Exportar planilha do pedido
              </Button>
              <p className="self-center text-xs text-muted-foreground">
                Abre no Excel. O fornecedor preenche “preco_unitario”, “prazo_entrega_dias” e
                “condicao_pagamento” e devolve o arquivo.
              </p>
            </div>
          </div>

          <div className="panel mb-5 p-4">
            <h2 className="mb-1 font-display text-lg font-semibold">Comparativo de fornecedores</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              A nota considera preço (70%), prazo de entrega (15%) e prazo de pagamento (15%).
            </p>
            {avaliadas.length === 0 ? (
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
                      <TableHead>Entrega</TableHead>
                      <TableHead>Pagamento</TableHead>
                      <TableHead className="text-right">Nota</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {avaliadas.map((q) => {
                      const original = cotacoes.find((c) => c.id === q.id);
                      const pct =
                        recomendada && recomendada.valor_total > 0
                          ? (q.diferenca / recomendada.valor_total) * 100
                          : 0;
                      return (
                        <TableRow key={q.id} className={q.recomendada ? "bg-success/5" : undefined}>
                          <TableCell>
                            <p className="font-medium">{q.fornecedor}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {q.recomendada && (
                                <Badge className="bg-success/15 text-success">Melhor proposta</Badge>
                              )}
                              {q.melhorPreco && !q.recomendada && (
                                <Badge className="bg-accent/15 text-accent-foreground">
                                  Menor preço
                                </Badge>
                              )}
                              {original?.escolhida && (
                                <Badge className="bg-primary/15 text-primary">Escolhida</Badge>
                              )}
                              {q.itens_respondidos > 0 && (
                                <Badge variant="outline">
                                  {q.itens_respondidos}/{itens.length} itens
                                </Badge>
                              )}
                            </div>
                            {original?.observacao && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {original.observacao}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-numeric font-medium">
                            {q.valor_total > 0 ? brl(q.valor_total) : "aguardando"}
                          </TableCell>
                          <TableCell className="text-right text-numeric text-sm">
                            {q.diferenca <= 0 ? (
                              <span className="text-success">—</span>
                            ) : (
                              <span className="text-destructive">
                                +{brl(q.diferenca)} ({num(pct)}%)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {q.prazo_entrega_dias ? `${q.prazo_entrega_dias} dia(s)` : "—"}
                            {q.melhorPrazoEntrega && (
                              <span className="ml-1 text-xs text-success">mais rápido</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {q.condicao_pagamento ?? "—"}
                            {q.melhorPagamento && q.condicao_pagamento && (
                              <span className="ml-1 text-xs text-success">maior prazo</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-numeric font-medium">
                            {q.pontos}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setImportarPara(q.id);
                                  arquivoRef.current?.click();
                                }}
                                disabled={importar.isPending}
                              >
                                <Upload className="size-4" /> Importar resposta
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => aplicar.mutate(q.id)}
                                disabled={aplicar.isPending || q.valor_total <= 0}
                              >
                                <Check className="size-4" /> Escolher e gerar pedido
                              </Button>
                            </div>
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
            <h2 className="mb-1 font-display text-lg font-semibold">Preço por produto</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Cada coluna mostra o preço que o fornecedor respondeu na planilha; sem resposta item a
              item, o sistema usa o valor total da proposta.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Custo atual</TableHead>
                    {avaliadas.map((q) => (
                      <TableHead key={q.id} className="text-right">
                        {q.fornecedor}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((i) => {
                    const precos = avaliadas.map((q) => custoNaProposta(i, q.id));
                    const menor = precos.filter((p) => p > 0).length
                      ? Math.min(...precos.filter((p) => p > 0))
                      : 0;
                    return (
                      <TableRow key={i.id}>
                        <TableCell>
                          <p className="font-medium">{i.produtos?.descricao ?? "—"}</p>
                          <p className="text-xs text-muted-foreground text-numeric">
                            {i.produtos?.codigo_interno ?? ""}
                          </p>
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {num(i.quantidade)} {i.unidade}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(i.produtos?.custo ?? 0))}
                        </TableCell>
                        {precos.map((p, idx) => (
                          <TableCell key={idx} className="text-right text-numeric">
                            <span className={p > 0 && p === menor ? "font-medium text-success" : ""}>
                              {p > 0 ? brl(p) : "—"}
                            </span>
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <input
        ref={arquivoRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={async (e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (!arquivo || !importarPara) return;
          const texto = await arquivo.text();
          importar.mutate({ cotacaoId: importarPara, texto });
          setImportarPara(null);
        }}
      />

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
              <Label>Valor total (opcional)</Label>
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
          <p className="text-xs text-muted-foreground">
            Deixe o valor em branco se for importar a planilha respondida pelo fornecedor — o sistema
            soma os preços item a item.
          </p>
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
