import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateTimeBR } from "@/lib/format";
import { PageHeader, EmptyState, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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

export const Route = createFileRoute("/_authenticated/credito")({
  head: () => ({
    meta: [
      { title: "Crédito de clientes — ERP Ze Tech" },
      {
        name: "description",
        content: "Limites de crédito, clientes acima do limite e autorizações do gestor.",
      },
      { property: "og:title", content: "Crédito de clientes — ERP Ze Tech" },
      { property: "og:description", content: "Aprovação de vendas acima do limite de crédito." },
    ],
  }),
  component: Credito,
});

function Credito() {
  const queryClient = useQueryClient();
  const [decisaoAberta, setDecisaoAberta] = useState(false);
  const [autorizacaoId, setAutorizacaoId] = useState("");
  const [aprovar, setAprovar] = useState(true);
  const [observacao, setObservacao] = useState("");

  const { data: autorizacoes = [], isLoading } = useQuery({
    queryKey: ["credito-autorizacoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credito_autorizacoes")
        .select("*, clientes(nome, limite_credito), pedidos(numero)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["credito-clientes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, limite_credito")
        .eq("ativo", true)
        .gt("limite_credito", 0)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: emAberto = [] } = useQuery({
    queryKey: ["credito-saldos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_receber")
        .select("cliente_id, valor, valor_recebido, vencimento, situacao")
        .in("situacao", ["aberto", "parcial"]);
      if (error) throw error;
      return data;
    },
  });

  const { data: pedidosCrediario = [] } = useQuery({
    queryKey: ["credito-pedidos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedidos")
        .select(
          "id, numero, total, situacao, created_at, cliente_id, clientes(nome, limite_credito)",
        )
        .eq("forma_pagamento", "crediario")
        .not("situacao", "in", "(cancelado,concluido)")
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const hoje = new Date().toISOString().slice(0, 10);
  const saldoPor = new Map<string, { usado: number; vencido: number }>();
  for (const c of emAberto) {
    if (!c.cliente_id) continue;
    const saldo = Number(c.valor) - Number(c.valor_recebido);
    const atual = saldoPor.get(c.cliente_id) ?? { usado: 0, vencido: 0 };
    atual.usado += saldo;
    if (c.vencimento < hoje) atual.vencido += saldo;
    saldoPor.set(c.cliente_id, atual);
  }

  const linhas = clientes.map((c) => {
    const s = saldoPor.get(c.id) ?? { usado: 0, vencido: 0 };
    const limite = Number(c.limite_credito ?? 0);
    return { ...c, limite, usado: s.usado, vencido: s.vencido, disponivel: limite - s.usado };
  });

  const pendentes = autorizacoes.filter((a) => a.situacao === "pendente");
  const acimaLimite = linhas.filter((l) => l.disponivel < 0);
  const comVencidas = linhas.filter((l) => l.vencido > 0);

  /** Pedidos no crediário em que o valor passa do limite disponível do cliente. */
  const pedidosAcima = pedidosCrediario
    .map((p) => {
      const cli = p.clientes as unknown as { nome: string; limite_credito: number | null } | null;
      const limite = Number(cli?.limite_credito ?? 0);
      const usado = saldoPor.get(p.cliente_id ?? "")?.usado ?? 0;
      const total = Number(p.total);
      const excedente = usado + total - limite;
      const autorizacao = autorizacoes.find(
        (a) => a.pedido_id === p.id && a.situacao === "pendente",
      );
      return { ...p, cliente: cli?.nome ?? "—", limite, usado, total, excedente, autorizacao };
    })
    .filter((p) => p.limite > 0 && p.excedente > 0);

  const solicitar = useMutation({
    mutationFn: async (p: { cliente_id: string; id: string; total: number }) => {
      const { error } = await supabase.rpc("solicitar_autorizacao_credito", {
        p_cliente_id: p.cliente_id,
        p_valor: p.total,
        p_pedido_id: p.id,
        p_motivo: "Pedido acima do limite de crédito",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Autorização solicitada ao gestor.");
      void queryClient.invalidateQueries({ queryKey: ["credito-autorizacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decidir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("decidir_autorizacao_credito", {
        p_id: autorizacaoId,
        p_aprovar: aprovar,
        p_observacao: observacao,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(aprovar ? "Autorização aprovada." : "Autorização negada.");
      setDecisaoAberta(false);
      setObservacao("");
      void queryClient.invalidateQueries({ queryKey: ["credito-autorizacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Crédito de clientes"
        description="Limite, saldo utilizado e autorizações de venda acima do limite."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Autorizações pendentes"
          value={String(pendentes.length)}
          tone={pendentes.length > 0 ? "warning" : "default"}
          icon={ShieldCheck}
        />
        <StatCard
          label="Clientes acima do limite"
          value={String(acimaLimite.length)}
          tone={acimaLimite.length > 0 ? "danger" : "default"}
          icon={AlertTriangle}
        />
        <StatCard
          label="Clientes com contas vencidas"
          value={String(comVencidas.length)}
          hint={brl(comVencidas.reduce((s, c) => s + c.vencido, 0))}
          icon={Users}
        />
      </div>

      <div className="panel mb-5 p-4">
        <h2 className="mb-1 font-display text-lg font-semibold">Pedidos acima do limite</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Vendas no crediário em que o valor passa do crédito disponível do cliente.
        </p>
        {pedidosAcima.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum pedido acima do limite.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Limite</TableHead>
                  <TableHead className="text-right">Excedente</TableHead>
                  <TableHead className="text-right">Decisão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidosAcima.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-numeric">
                      #{String(p.numero).padStart(4, "0")}
                    </TableCell>
                    <TableCell>{p.cliente}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(p.total)}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(p.limite)}</TableCell>
                    <TableCell className="text-right text-numeric font-semibold text-destructive">
                      {brl(p.excedente)}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.autorizacao ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAutorizacaoId(p.autorizacao!.id);
                              setAprovar(true);
                              setDecisaoAberta(true);
                            }}
                          >
                            Aprovar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAutorizacaoId(p.autorizacao!.id);
                              setAprovar(false);
                              setDecisaoAberta(true);
                            }}
                          >
                            Recusar
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={solicitar.isPending || !p.cliente_id}
                          onClick={() =>
                            solicitar.mutate({
                              cliente_id: p.cliente_id as string,
                              id: p.id,
                              total: p.total,
                            })
                          }
                        >
                          Pedir autorização
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="panel mb-5 p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Autorizações</h2>
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">Carregando…</p>
        ) : autorizacoes.length === 0 ? (
          <EmptyState
            title="Nenhuma autorização registrada."
            description="Quando uma venda passar do limite do cliente, a solicitação aparece aqui para o gestor decidir."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Solicitado em</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {autorizacoes.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{dateTimeBR(a.created_at)}</TableCell>
                    <TableCell>{(a.clientes as { nome: string } | null)?.nome ?? "—"}</TableCell>
                    <TableCell className="text-numeric">
                      {(a.pedidos as { numero: number } | null)?.numero ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {brl(Number(a.valor))}
                    </TableCell>
                    <TableCell className="text-sm">{a.motivo ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          a.situacao === "pendente"
                            ? "bg-warning/15 text-warning-foreground"
                            : a.situacao === "aprovada"
                              ? "bg-success/15 text-success"
                              : "bg-destructive/15 text-destructive"
                        }
                      >
                        {a.situacao}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {a.situacao === "pendente" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAutorizacaoId(a.id);
                              setAprovar(true);
                              setDecisaoAberta(true);
                            }}
                          >
                            Aprovar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAutorizacaoId(a.id);
                              setAprovar(false);
                              setDecisaoAberta(true);
                            }}
                          >
                            Negar
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Limites por cliente</h2>
        {linhas.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum cliente com limite de crédito cadastrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Limite</TableHead>
                  <TableHead className="text-right">Utilizado</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.nome}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(l.limite)}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(l.usado)}</TableCell>
                    <TableCell className="text-right text-numeric">
                      <span className={l.disponivel < 0 ? "font-semibold text-destructive" : ""}>
                        {brl(l.disponivel)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {l.vencido > 0 ? (
                        <span className="font-semibold text-destructive">{brl(l.vencido)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          l.vencido > 0 || l.disponivel < 0
                            ? "bg-destructive/15 text-destructive"
                            : "bg-success/15 text-success"
                        }
                      >
                        {l.vencido > 0
                          ? "Inadimplente"
                          : l.disponivel < 0
                            ? "Acima do limite"
                            : "Regular"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={decisaoAberta} onOpenChange={setDecisaoAberta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{aprovar ? "Aprovar autorização" : "Negar autorização"}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Observação</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              placeholder="Registre o motivo da decisão"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisaoAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => decidir.mutate()} disabled={decidir.isPending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
