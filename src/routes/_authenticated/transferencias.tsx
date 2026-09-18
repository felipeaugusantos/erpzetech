import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, Truck } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/transferencias")({
  head: () => ({
    meta: [
      { title: "Transferência entre lojas — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Transferência de mercadoria entre lojas e depósitos: envio com baixa no estoque de origem, carga em trânsito, conferência no recebimento e devolução em caso de divergência.",
      },
      { property: "og:title", content: "Transferência entre lojas — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Envio, trânsito e conferência de mercadoria entre lojas e depósitos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Transferencias,
});

const corSituacao: Record<string, string> = {
  rascunho: "bg-secondary text-secondary-foreground",
  em_transito: "bg-info/15 text-info",
  recebida: "bg-success/15 text-success",
  cancelada: "bg-destructive/15 text-destructive",
};

const labelSituacao: Record<string, string> = {
  rascunho: "Rascunho",
  em_transito: "Em trânsito",
  recebida: "Recebida",
  cancelada: "Cancelada",
};

type Produto = {
  id: string;
  descricao: string;
  codigo_interno: string;
  codigo_barras: string | null;
  unidade: string;
};

type Linha = { produto_id: string; descricao: string; unidade: string; qtdTexto: string };

/** Aceita vírgula e arredonda em 3 casas (venda e transferência fracionada). */
function parseQtd(texto: string) {
  const n = Number(String(texto).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function Transferencias() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [observacao, setObservacao] = useState("");
  const [buscaProduto, setBuscaProduto] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [recebido, setRecebido] = useState<Record<string, string>>({});
  const [obsRecebimento, setObsRecebimento] = useState("");

  const { data: base } = useQuery({
    queryKey: ["transferencias-base"],
    queryFn: async () => {
      const [deps, prods] = await Promise.all([
        supabase
          .from("depositos")
          .select("id, nome, filiais(nome)")
          .eq("ativo", true)
          .order("nome"),
        supabase
          .from("produtos")
          .select("id, descricao, codigo_interno, codigo_barras, unidade")
          .eq("ativo", true)
          .order("descricao")
          .limit(2000),
      ]);
      if (deps.error) throw deps.error;
      if (prods.error) throw prods.error;
      return { depositos: deps.data ?? [], produtos: (prods.data ?? []) as Produto[] };
    },
  });

  const { data: lista, isLoading } = useQuery({
    queryKey: ["transferencias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transferencias")
        .select(
          "id, numero, situacao, observacao, valor_total, enviado_em, recebido_em, created_at, deposito_origem_id, deposito_destino_id",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: itens } = useQuery({
    queryKey: ["transferencia-itens", detalhe],
    enabled: Boolean(detalhe),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transferencia_itens")
        .select(
          "id, produto_id, quantidade, quantidade_recebida, custo_unitario, produtos(descricao, codigo_interno, unidade)",
        )
        .eq("transferencia_id", detalhe as string);
      if (error) throw error;
      return data ?? [];
    },
  });

  const nomeDeposito = (id: string | null) => {
    const d = (base?.depositos ?? []).find((x) => x.id === id);
    if (!d) return "—";
    const loja = (d.filiais as unknown as { nome: string } | null)?.nome;
    return loja ? `${loja} · ${d.nome}` : d.nome;
  };

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["transferencias"] });
    qc.invalidateQueries({ queryKey: ["transferencia-itens"] });
    qc.invalidateQueries({ queryKey: ["estoque"] });
    qc.invalidateQueries({ queryKey: ["deposito"] });
    qc.invalidateQueries({ queryKey: ["depositos"] });
    qc.invalidateQueries({ queryKey: ["movimentacoes"] });
    qc.invalidateQueries({ queryKey: ["alertas"] });
  };

  const criar = useMutation({
    mutationFn: async () => {
      if (!origem || !destino) throw new Error("Escolha a loja de origem e a de destino");
      if (origem === destino) throw new Error("A origem e o destino devem ser diferentes");
      const itensEnvio = linhas
        .map((l) => ({ produto_id: l.produto_id, quantidade: parseQtd(l.qtdTexto) }))
        .filter((l) => l.quantidade > 0);
      if (itensEnvio.length === 0) throw new Error("Informe a quantidade de cada produto");
      const { data, error } = await supabase.rpc("transferencia_criar", {
        p_deposito_origem_id: origem,
        p_deposito_destino_id: destino,
        p_itens: itensEnvio,
        ...(observacao.trim() ? { p_observacao: observacao.trim() } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Transferência criada");
      setNovo(false);
      setLinhas([]);
      setObservacao("");
      setDetalhe(id);
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível criar", { description: e.message }),
  });

  const enviar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("transferencia_enviar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mercadoria enviada — estoque baixado na loja de origem");
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível enviar", { description: e.message }),
  });

  const receber = useMutation({
    mutationFn: async (id: string) => {
      const conferidos = (itens ?? [])
        .filter((i) => recebido[i.id] !== undefined && recebido[i.id] !== "")
        .map((i) => ({ id: i.id, quantidade_recebida: parseQtd(recebido[i.id] as string) }));
      const { error } = await supabase.rpc("transferencia_receber", {
        p_id: id,
        ...(conferidos.length > 0 ? { p_itens: conferidos } : {}),
        ...(obsRecebimento.trim() ? { p_observacao: obsRecebimento.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transferência recebida — estoque atualizado na loja de destino");
      setRecebido({});
      setObsRecebimento("");
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível receber", { description: e.message }),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("transferencia_cancelar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transferência cancelada");
      invalidar();
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  const produtosFiltrados = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return (base?.produtos ?? [])
      .filter((p) =>
        [p.descricao, p.codigo_interno, p.codigo_barras]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(termo)),
      )
      .slice(0, 8);
  }, [base, buscaProduto]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (lista ?? []).filter((t) => {
      if (filtro !== "todas" && t.situacao !== filtro) return false;
      if (!termo) return true;
      return [
        String(t.numero),
        nomeDeposito(t.deposito_origem_id),
        nomeDeposito(t.deposito_destino_id),
      ].some((v) => v.toLowerCase().includes(termo));
    });
  }, [lista, busca, filtro, base]);

  const totais = useMemo(() => {
    const l = lista ?? [];
    return {
      total: l.length,
      transito: l.filter((t) => t.situacao === "em_transito").length,
      rascunho: l.filter((t) => t.situacao === "rascunho").length,
      valorTransito: l
        .filter((t) => t.situacao === "em_transito")
        .reduce((s, t) => s + Number(t.valor_total), 0),
    };
  }, [lista]);

  const aberta = (lista ?? []).find((t) => t.id === detalhe) ?? null;

  const adicionar = (p: Produto) => {
    setLinhas((atual) =>
      atual.some((l) => l.produto_id === p.id)
        ? atual
        : [
            ...atual,
            { produto_id: p.id, descricao: p.descricao, unidade: p.unidade, qtdTexto: "1" },
          ],
    );
    setBuscaProduto("");
  };

  return (
    <>
      <PageHeader
        title="Transferência entre lojas"
        description="Envie mercadoria de uma loja para outra: baixa na origem, carga em trânsito e conferência no recebimento."
        actions={
          <Button
            onClick={() => {
              setNovo(true);
              setLinhas([]);
            }}
          >
            <Plus className="mr-2 size-4" />
            Nova transferência
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Transferências" value={num(totais.total)} />
        <StatCard label="Em trânsito" value={num(totais.transito)} />
        <StatCard label="Em rascunho" value={num(totais.rascunho)} />
        <StatCard label="Valor em trânsito" value={brl(totais.valorTransito)} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Número ou loja..."
            className="pl-9"
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            <SelectItem value="rascunho">Rascunho</SelectItem>
            <SelectItem value="em_transito">Em trânsito</SelectItem>
            <SelectItem value="recebida">Recebida</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Carregando...</p>
        ) : filtradas.length === 0 ? (
          <EmptyState
            title="Nenhuma transferência"
            description="Crie uma transferência para mandar mercadoria de uma loja para outra."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Envio</TableHead>
                <TableHead>Recebimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-numeric">
                    #{String(t.numero).padStart(4, "0")}
                  </TableCell>
                  <TableCell>{nomeDeposito(t.deposito_origem_id)}</TableCell>
                  <TableCell>{nomeDeposito(t.deposito_destino_id)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.enviado_em ? dateTimeBR(t.enviado_em) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.recebido_em ? dateTimeBR(t.recebido_em) : "—"}
                  </TableCell>
                  <TableCell className="text-numeric text-right">
                    {brl(Number(t.valor_total))}
                  </TableCell>
                  <TableCell>
                    <Badge className={corSituacao[t.situacao] ?? ""} variant="secondary">
                      {labelSituacao[t.situacao] ?? t.situacao}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDetalhe(t.id);
                        setRecebido({});
                        setObsRecebimento("");
                      }}
                    >
                      Abrir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Nova transferência */}
      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nova transferência entre lojas</DialogTitle>
            <DialogDescription>
              Escolha a loja que envia, a que recebe e os produtos. O estoque só sai quando você
              enviar a carga.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Loja / depósito de origem</Label>
                <Select value={origem} onValueChange={setOrigem}>
                  <SelectTrigger>
                    <SelectValue placeholder="De onde sai a mercadoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {(base?.depositos ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {nomeDeposito(d.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Loja / depósito de destino</Label>
                <Select value={destino} onValueChange={setDestino}>
                  <SelectTrigger>
                    <SelectValue placeholder="Para onde vai a mercadoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {(base?.depositos ?? [])
                      .filter((d) => d.id !== origem)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {nomeDeposito(d.id)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Produto</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={buscaProduto}
                  onChange={(e) => setBuscaProduto(e.target.value)}
                  placeholder="Nome, código interno ou código de barras"
                  className="pl-9"
                />
              </div>
              {produtosFiltrados.length > 0 && (
                <div className="mt-2 rounded-lg border border-border">
                  {produtosFiltrados.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => adicionar(p)}
                      className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-secondary"
                    >
                      <span>{p.descricao}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.codigo_interno} · {p.unidade}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {linhas.length > 0 && (
              <div className="rounded-lg border border-border">
                {linhas.map((l, idx) => (
                  <div
                    key={l.produto_id}
                    className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
                  >
                    <span className="flex-1 text-sm">{l.descricao}</span>
                    <Input
                      value={l.qtdTexto}
                      inputMode="decimal"
                      onChange={(e) =>
                        setLinhas((atual) =>
                          atual.map((x, i) =>
                            i === idx ? { ...x, qtdTexto: e.target.value } : x,
                          ),
                        )
                      }
                      className="w-28 text-right"
                    />
                    <span className="w-14 text-xs text-muted-foreground">{l.unidade}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <Label>Observação</Label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Motivo da transferência, responsável pelo transporte..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => criar.mutate()}
              disabled={!origem || !destino || linhas.length === 0 || criar.isPending}
            >
              Criar transferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhe / conferência */}
      <Dialog open={Boolean(detalhe)} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Transferência #{aberta ? String(aberta.numero).padStart(4, "0") : ""}
            </DialogTitle>
            <DialogDescription>
              {aberta
                ? `${nomeDeposito(aberta.deposito_origem_id)} → ${nomeDeposito(aberta.deposito_destino_id)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {aberta && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={corSituacao[aberta.situacao] ?? ""} variant="secondary">
                  {labelSituacao[aberta.situacao] ?? aberta.situacao}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Valor: <strong className="text-foreground">{brl(Number(aberta.valor_total))}</strong>
                </span>
                {aberta.observacao && (
                  <span className="text-sm text-muted-foreground">{aberta.observacao}</span>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Enviado</TableHead>
                    <TableHead className="text-right">
                      {aberta.situacao === "em_transito" ? "Conferido" : "Recebido"}
                    </TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(itens ?? []).map((i) => {
                    const p = i.produtos as unknown as {
                      descricao: string;
                      codigo_interno: string;
                      unidade: string;
                    } | null;
                    return (
                      <TableRow key={i.id}>
                        <TableCell>
                          <div>{p?.descricao ?? "—"}</div>
                          <div className="text-numeric text-xs text-muted-foreground">
                            {p?.codigo_interno}
                          </div>
                        </TableCell>
                        <TableCell className="text-numeric text-right">
                          {num(Number(i.quantidade))} {p?.unidade}
                        </TableCell>
                        <TableCell className="text-right">
                          {aberta.situacao === "em_transito" ? (
                            <Input
                              value={recebido[i.id] ?? String(i.quantidade)}
                              inputMode="decimal"
                              onChange={(e) =>
                                setRecebido((atual) => ({ ...atual, [i.id]: e.target.value }))
                              }
                              className="ml-auto w-28 text-right"
                            />
                          ) : i.quantidade_recebida === null ? (
                            "—"
                          ) : (
                            `${num(Number(i.quantidade_recebida))} ${p?.unidade ?? ""}`
                          )}
                        </TableCell>
                        <TableCell className="text-numeric text-right">
                          {brl(Number(i.custo_unitario))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {aberta.situacao === "em_transito" && (
                <div>
                  <Label>Observação do recebimento</Label>
                  <Textarea
                    value={obsRecebimento}
                    onChange={(e) => setObsRecebimento(e.target.value)}
                    placeholder="Anote divergências, avarias ou quem recebeu a carga"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    O que faltar volta ao estoque da loja de origem como divergência.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {aberta?.situacao === "rascunho" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => cancelar.mutate(aberta.id)}
                  disabled={cancelar.isPending}
                >
                  Cancelar transferência
                </Button>
                <Button onClick={() => enviar.mutate(aberta.id)} disabled={enviar.isPending}>
                  <Truck className="mr-2 size-4" />
                  Enviar mercadoria
                </Button>
              </>
            )}
            {aberta?.situacao === "em_transito" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => cancelar.mutate(aberta.id)}
                  disabled={cancelar.isPending}
                >
                  Cancelar e devolver
                </Button>
                <Button onClick={() => receber.mutate(aberta.id)} disabled={receber.isPending}>
                  Receber no destino
                </Button>
              </>
            )}
            {(aberta?.situacao === "recebida" || aberta?.situacao === "cancelada") && (
              <Button variant="outline" onClick={() => setDetalhe(null)}>
                Fechar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
