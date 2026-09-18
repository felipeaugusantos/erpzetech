import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Truck, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, dateTimeBR, num } from "@/lib/format";
import { corSituacao, labelSituacao, proximas } from "@/lib/pedido";
import { corConta, formasPagamento, hojeISO, labelConta, labelForma } from "@/lib/financeiro";
import { PageHeader } from "@/components/app/PageHeader";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/pedidos/$id")({
  head: () => ({
    meta: [
      { title: "Pedido — Ze Obra" },
      {
        name: "description",
        content: "Detalhe do pedido: itens, separação, conferência, entregas e histórico.",
      },
      { property: "og:title", content: "Pedido — Ze Obra" },
      {
        property: "og:description",
        content: "Acompanhe separação, conferência e entregas parciais do pedido.",
      },
    ],
  }),
  component: PedidoDetalhe,
});

function PedidoDetalhe() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const [separado, setSeparado] = useState<Record<string, string>>({});
  const [conferido, setConferido] = useState<Record<string, string>>({});
  const [divergencias, setDivergencias] = useState<Record<string, string>>({});
  const [entregaOpen, setEntregaOpen] = useState(false);
  const [entregaQtd, setEntregaQtd] = useState<Record<string, string>>({});
  const [recebedor, setRecebedor] = useState("");
  const [obsEntrega, setObsEntrega] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [contasOpen, setContasOpen] = useState(false);
  const [parcelasReceber, setParcelasReceber] = useState("1");
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hojeISO());
  const [formaReceber, setFormaReceber] = useState("pix");
  const queryClient = qc;

  const { data, isLoading } = useQuery({
    queryKey: ["pedido", id],
    queryFn: async () => {
      const [pedido, itens, historico, entregas] = await Promise.all([
        supabase
          .from("pedidos")
          .select("*, clientes(id, nome, telefone, limite_credito), obras(nome, endereco, numero, bairro, cidade), depositos(nome)")
          .eq("id", id)
          .single(),
        supabase
          .from("pedido_itens")
          .select("*, produtos(descricao, codigo_interno, localizacao)")
          .eq("pedido_id", id)
          .order("created_at"),
        supabase
          .from("pedido_historico")
          .select("*")
          .eq("pedido_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("entregas")
          .select("*, entrega_itens(quantidade, produtos(descricao))")
          .eq("pedido_id", id)
          .order("created_at", { ascending: false }),
      ]);
      return {
        pedido: pedido.data,
        itens: itens.data ?? [],
        historico: historico.data ?? [],
        entregas: entregas.data ?? [],
      };
    },
  });

  const pedido = data?.pedido;
  const itens = data?.itens ?? [];
  const clienteRel = pedido?.clientes as unknown as
    | { id: string; nome: string; telefone: string | null; limite_credito: number | null }
    | null;

  const { data: financeiro } = useQuery({
    queryKey: ["pedido-financeiro", id, clienteRel?.id ?? ""],
    enabled: !!pedido,
    queryFn: async () => {
      const [contas, doCliente] = await Promise.all([
        supabase
          .from("contas_receber")
          .select("id, numero, parcela, parcelas, vencimento, valor, valor_recebido, situacao")
          .eq("pedido_id", id)
          .order("parcela"),
        clienteRel?.id
          ? supabase
              .from("contas_receber")
              .select("valor, valor_recebido, vencimento")
              .eq("cliente_id", clienteRel.id)
              .in("situacao", ["aberto", "parcial"])
          : Promise.resolve({ data: [] as { valor: number; valor_recebido: number; vencimento: string }[] }),
      ]);
      const abertas = doCliente.data ?? [];
      const usado = abertas.reduce((s, c) => s + Number(c.valor) - Number(c.valor_recebido), 0);
      return { contas: contas.data ?? [], usado };
    },
  });

  const contasPedido = financeiro?.contas ?? [];
  const limiteCliente = Number(clienteRel?.limite_credito ?? 0);
  const usadoCliente = financeiro?.usado ?? 0;
  const disponivelCliente = limiteCliente - usadoCliente;

  const gerarContas = useMutation({
    mutationFn: async () => {
      const n = Math.max(1, Number(parcelasReceber || 1));
      if (
        formaReceber === "crediario" &&
        limiteCliente > 0 &&
        Number(pedido?.total ?? 0) > disponivelCliente
      ) {
        const { error: eAut } = await supabase.rpc("solicitar_autorizacao_credito", {
          p_cliente_id: clienteRel?.id ?? "",
          p_valor: Number(pedido?.total ?? 0),
          p_pedido_id: id,
          p_motivo: "Crediário acima do limite disponível do cliente",
        });
        if (eAut) throw eAut;
        throw new Error(
          "Valor acima do limite de crédito. Solicitação enviada para autorização do gestor.",
        );
      }
      const { error } = await supabase.rpc("gerar_contas_receber", {
        p_pedido_id: id,
        p_parcelas: n,
        p_primeiro_vencimento: primeiroVencimento,
        p_forma: formaReceber as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contas a receber geradas.");
      setContasOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["pedido-financeiro"] });
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    setSeparado(
      Object.fromEntries(itens.map((i) => [i.id, String(Number(i.quantidade_separada))])),
    );
    setConferido(
      Object.fromEntries(itens.map((i) => [i.id, String(Number(i.quantidade_conferida))])),
    );
    setDivergencias(Object.fromEntries(itens.map((i) => [i.id, i.divergencia ?? ""])));
    setEntregaQtd(
      Object.fromEntries(
        itens.map((i) => [
          i.id,
          String(Number(i.quantidade) - Number(i.quantidade_entregue)),
        ]),
      ),
    );
  }, [data]);

  const avancar = useMutation({
    mutationFn: async ({ situacao, observacao }: { situacao: string; observacao?: string }) => {
      const { error } = await supabase.rpc("pedido_avancar_status", {
        p_pedido_id: id,
        p_situacao: situacao as never,
        ...(observacao ? { p_observacao: observacao } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada");
      setCancelOpen(false);
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["pedido", id] });
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      qc.invalidateQueries({ queryKey: ["estoque"] });
    },
    onError: (e: Error) => toast.error("Não foi possível avançar", { description: e.message }),
  });

  const salvarSeparacao = useMutation({
    mutationFn: async () => {
      for (const i of itens) {
        const q = Number(separado[i.id] ?? 0);
        if (q === Number(i.quantidade_separada)) continue;
        const { error } = await supabase
          .from("pedido_itens")
          .update({ quantidade_separada: q })
          .eq("id", i.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Separação salva");
      qc.invalidateQueries({ queryKey: ["pedido", id] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar separação", { description: e.message }),
  });

  const salvarConferencia = useMutation({
    mutationFn: async () => {
      for (const i of itens) {
        const q = Number(conferido[i.id] ?? 0);
        const d = (divergencias[i.id] ?? "").trim();
        if (q === Number(i.quantidade_conferida) && d === (i.divergencia ?? "")) continue;
        const { error } = await supabase
          .from("pedido_itens")
          .update({ quantidade_conferida: q, divergencia: d || null })
          .eq("id", i.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Conferência salva");
      qc.invalidateQueries({ queryKey: ["pedido", id] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar conferência", { description: e.message }),
  });

  const registrarEntrega = useMutation({
    mutationFn: async () => {
      const payload = itens
        .map((i) => ({ pedido_item_id: i.id, quantidade: Number(entregaQtd[i.id] ?? 0) }))
        .filter((x) => x.quantidade > 0);
      if (payload.length === 0) throw new Error("Informe a quantidade entregue de pelo menos um item");
      const { error } = await supabase.rpc("pedido_registrar_entrega", {
        p_pedido_id: id,
        p_itens: payload as never,
        ...(recebedor ? { p_recebedor: recebedor } : {}),
        ...(obsEntrega ? { p_observacao: obsEntrega } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega registrada");
      setEntregaOpen(false);
      setRecebedor("");
      setObsEntrega("");
      qc.invalidateQueries({ queryKey: ["pedido", id] });
      qc.invalidateQueries({ queryKey: ["pedidos"] });
      qc.invalidateQueries({ queryKey: ["estoque"] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const resumo = useMemo(() => {
    const pedidoQtd = itens.reduce((s, i) => s + Number(i.quantidade), 0);
    const entregue = itens.reduce((s, i) => s + Number(i.quantidade_entregue), 0);
    return { pedidoQtd, entregue, pendente: pedidoQtd - entregue };
  }, [itens]);

  if (isLoading) return <div className="panel h-96 animate-pulse" />;
  if (!pedido)
    return (
      <div className="panel p-8 text-center">
        <p className="font-semibold">Pedido não encontrado.</p>
        <Button asChild className="mt-3">
          <Link to="/pedidos">Voltar para pedidos</Link>
        </Button>
      </div>
    );

  const cliente = pedido.clientes as unknown as { nome: string; telefone: string | null } | null;
  const obra = pedido.obras as unknown as {
    nome: string;
    endereco: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
  } | null;
  const emSeparacao = pedido.situacao === "separacao";
  const emConferencia = pedido.situacao === "conferencia";
  const podeEntregar = ["pronto_entrega", "em_rota"].includes(pedido.situacao);

  return (
    <>
      <PageHeader
        title={`Pedido #${String(pedido.numero).padStart(4, "0")}`}
        description={`${cliente?.nome ?? ""}${obra ? ` · ${obra.nome}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/pedidos">
                <ArrowLeft className="mr-2 size-4" /> Pedidos
              </Link>
            </Button>
            {contasPedido.length === 0 && pedido.situacao !== "cancelado" && (
              <Button variant="secondary" onClick={() => setContasOpen(true)}>
                <Wallet className="mr-2 size-4" /> Gerar contas a receber
              </Button>
            )}
            {podeEntregar && (
              <Button onClick={() => setEntregaOpen(true)}>
                <Truck className="mr-2 size-4" /> Registrar entrega
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-md px-2.5 py-1 text-sm font-semibold ${corSituacao(pedido.situacao)}`}
              >
                {labelSituacao(pedido.situacao)}
              </span>
              <span className="text-sm text-muted-foreground">
                Depósito: {(pedido.depositos as unknown as { nome: string } | null)?.nome ?? "—"}
              </span>
              <span className="text-sm text-muted-foreground">
                Previsão: {dateBR(pedido.previsao_entrega)}
              </span>
              <span className="ml-auto font-display text-xl font-bold">
                {brl(Number(pedido.total))}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {proximas(pedido.situacao).map((s) =>
                s === "cancelado" ? (
                  <Button
                    key={s}
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancelar pedido
                  </Button>
                ) : (
                  <Button
                    key={s}
                    variant={s === "separacao" || s === "concluido" ? "default" : "secondary"}
                    disabled={avancar.isPending}
                    onClick={() => avancar.mutate({ situacao: s })}
                  >
                    {labelSituacao(s)}
                  </Button>
                ),
              )}
            </div>
          </div>

          <div className="panel overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="font-display font-semibold">Itens do pedido</p>
              <p className="text-xs text-muted-foreground">
                Pedido {num(resumo.pedidoQtd)} · Entregue {num(resumo.entregue)} · Pendente{" "}
                {num(resumo.pendente)}
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead className="text-right">Pedido</TableHead>
                  <TableHead className="w-28">Separado</TableHead>
                  <TableHead className="w-28">Conferido</TableHead>
                  <TableHead className="text-right">Entregue</TableHead>
                  <TableHead className="text-right">Pendente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((i) => {
                  const prod = i.produtos as unknown as {
                    descricao: string;
                    codigo_interno: string;
                    localizacao: string | null;
                  } | null;
                  const pendente = Number(i.quantidade) - Number(i.quantidade_entregue);
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">
                        <p className="font-medium">{prod?.descricao}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {prod?.codigo_interno}
                        </p>
                        {i.divergencia && (
                          <p className="mt-1 text-xs text-destructive">
                            Divergência: {i.divergencia}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {prod?.localizacao ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {num(Number(i.quantidade))} {i.unidade}
                      </TableCell>
                      <TableCell>
                        {emSeparacao ? (
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            value={separado[i.id] ?? ""}
                            onChange={(e) =>
                              setSeparado((p) => ({ ...p, [i.id]: e.target.value }))
                            }
                          />
                        ) : (
                          num(Number(i.quantidade_separada))
                        )}
                      </TableCell>
                      <TableCell>
                        {emConferencia ? (
                          <div className="space-y-1">
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={conferido[i.id] ?? ""}
                              onChange={(e) =>
                                setConferido((p) => ({ ...p, [i.id]: e.target.value }))
                              }
                            />
                            <Input
                              placeholder="Divergência"
                              value={divergencias[i.id] ?? ""}
                              onChange={(e) =>
                                setDivergencias((p) => ({ ...p, [i.id]: e.target.value }))
                              }
                            />
                          </div>
                        ) : (
                          num(Number(i.quantidade_conferida))
                        )}
                      </TableCell>
                      <TableCell className="text-right">{num(Number(i.quantidade_entregue))}</TableCell>
                      <TableCell className="text-right">
                        {pendente > 0 ? (
                          <span className="font-medium text-warning-foreground">{num(pendente)}</span>
                        ) : (
                          <span className="text-success">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {brl(Number(i.total))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(emSeparacao || emConferencia) && (
              <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                {emSeparacao && (
                  <Button onClick={() => salvarSeparacao.mutate()} disabled={salvarSeparacao.isPending}>
                    Salvar separação
                  </Button>
                )}
                {emConferencia && (
                  <Button
                    onClick={() => salvarConferencia.mutate()}
                    disabled={salvarConferencia.isPending}
                  >
                    Salvar conferência
                  </Button>
                )}
              </div>
            )}
          </div>

          {contasPedido.length > 0 && (
            <div className="panel p-4">
              <p className="font-display font-semibold">Parcelas a receber</p>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parcela</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Forma</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contasPedido.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-numeric">
                          {c.parcela}/{c.parcelas}
                        </TableCell>
                        <TableCell className="text-sm">{dateBR(c.vencimento)}</TableCell>
                        <TableCell className="text-sm">{labelForma(formaReceber)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(c.valor))}
                        </TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(Number(c.valor_recebido))}
                        </TableCell>
                        <TableCell>
                          <Badge className={corConta(c.situacao, c.vencimento)}>
                            {labelConta(c.situacao, c.vencimento)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {(data?.entregas ?? []).length > 0 && (
            <div className="panel p-4">
              <p className="font-display font-semibold">Entregas registradas</p>
              <ul className="mt-3 space-y-3">
                {(data?.entregas ?? []).map((e) => (
                  <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        Entrega #{String(e.numero).padStart(4, "0")}
                      </span>
                      <span className="text-muted-foreground">{dateTimeBR(e.data_entrega)}</span>
                      {e.recebedor && (
                        <span className="text-muted-foreground">Recebido por {e.recebedor}</span>
                      )}
                    </div>
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {((e.entrega_itens ?? []) as unknown as {
                        quantidade: number;
                        produtos: { descricao: string } | null;
                      }[]).map((ei, idx) => (
                        <li key={idx}>
                          {num(Number(ei.quantidade))} × {ei.produtos?.descricao}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="panel p-4 text-sm">
            <p className="font-display font-semibold">Cliente e entrega</p>
            <p className="mt-2 font-medium">{cliente?.nome}</p>
            <p className="text-muted-foreground">{cliente?.telefone ?? "—"}</p>
            {obra && (
              <p className="mt-2 text-muted-foreground">
                {obra.nome}
                <br />
                {[obra.endereco, obra.numero, obra.bairro, obra.cidade].filter(Boolean).join(", ")}
              </p>
            )}
            <div className="mt-3 space-y-1 border-t border-border pt-3">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{brl(Number(pedido.subtotal))}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Desconto</span>
                <span>{brl(Number(pedido.desconto))}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Frete</span>
                <span>{brl(Number(pedido.frete))}</span>
              </p>
              <p className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{brl(Number(pedido.total))}</span>
              </p>
            </div>
          </div>

          <div className="panel p-4">
            <p className="font-display font-semibold">Histórico</p>
            <ol className="mt-3 space-y-3 text-sm">
              {(data?.historico ?? []).map((h) => (
                <li key={h.id} className="border-l-2 border-primary/40 pl-3">
                  <p className="font-medium">{labelSituacao(h.situacao_nova)}</p>
                  <p className="text-xs text-muted-foreground">{dateTimeBR(h.created_at)}</p>
                  {h.observacao && <p className="text-xs text-muted-foreground">{h.observacao}</p>}
                </li>
              ))}
              {(data?.historico ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">Sem movimentos ainda.</li>
              )}
            </ol>
          </div>
        </div>
      </div>

      {/* ENTREGA */}
      <Dialog open={entregaOpen} onOpenChange={setEntregaOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar entrega</DialogTitle>
            <DialogDescription>
              Pode ser parcial: informe a quantidade realmente entregue de cada item.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Pendente</TableHead>
                <TableHead className="w-32">Entregar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((i) => {
                const pendente = Number(i.quantidade) - Number(i.quantidade_entregue);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="text-sm">
                      {(i.produtos as unknown as { descricao: string } | null)?.descricao}
                    </TableCell>
                    <TableCell className="text-right">{num(pendente)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        max={pendente}
                        step="0.001"
                        value={entregaQtd[i.id] ?? ""}
                        onChange={(e) => setEntregaQtd((p) => ({ ...p, [i.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ent-rec">Quem recebeu</Label>
              <Input id="ent-rec" value={recebedor} onChange={(e) => setRecebedor(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ent-obs">Observação</Label>
              <Input id="ent-obs" value={obsEntrega} onChange={(e) => setObsEntrega(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntregaOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => registrarEntrega.mutate()} disabled={registrarEntrega.isPending}>
              Confirmar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCELAMENTO */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pedido</DialogTitle>
            <DialogDescription>
              A reserva de estoque dos itens não entregues será liberada.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="canc-mot">Motivo</Label>
            <Textarea id="canc-mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || avancar.isPending}
              onClick={() => avancar.mutate({ situacao: "cancelado", observacao: motivo })}
            >
              Cancelar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* CONTAS A RECEBER */}
      <Dialog open={contasOpen} onOpenChange={setContasOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar contas a receber</DialogTitle>
            <DialogDescription>
              Total do pedido: {brl(Number(pedido.total))}
              {limiteCliente > 0 &&
                ` · Crédito disponível do cliente: ${brl(disponivelCliente)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="cr-parc">Parcelas</Label>
                <Input
                  id="cr-parc"
                  inputMode="numeric"
                  value={parcelasReceber}
                  onChange={(e) => setParcelasReceber(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cr-venc">1º vencimento</Label>
                <Input
                  id="cr-venc"
                  type="date"
                  value={primeiroVencimento}
                  onChange={(e) => setPrimeiroVencimento(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={formaReceber} onValueChange={setFormaReceber}>
                <SelectTrigger>
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
            {formaReceber === "crediario" &&
              limiteCliente > 0 &&
              Number(pedido.total) > disponivelCliente && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  O valor passa do limite de crédito do cliente. Ao confirmar, será criada uma
                  solicitação de autorização para o gestor liberar.
                </p>
              )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContasOpen(false)}>
              Voltar
            </Button>
            <Button onClick={() => gerarContas.mutate()} disabled={gerarContas.isPending}>
              Gerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>

  );
}
