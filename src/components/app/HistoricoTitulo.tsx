import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, dateTimeBR } from "@/lib/format";
import {
  baixasEstornadas,
  labelForma,
  podeEstornarBaixa,
  valorLiquidoBaixa,
} from "@/lib/financeiro";
import { useSessionData } from "@/hooks/useSessionData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export type TituloHistorico = {
  id: string;
  numero: number | null;
  descricao: string | null;
  valor: number;
  quitado: number;
  vencimento: string;
  pessoa: string;
  parcela?: number | null;
  parcelas?: number | null;
};

type Lancamento = {
  chave: string;
  data: string;
  quando: string;
  valor: number;
  forma: string;
  descricao: string;
  tipo: "pagamento" | "credito" | "estorno";
  /** Só nas baixas de verdade: id para estornar (e se já foi estornada). */
  baixaId?: string | undefined;
  estornada?: boolean;
};

/**
 * Histórico de um título (a receber ou a pagar): cada pagamento parcial ou total,
 * com o saldo restante depois de cada lançamento. O histórico nunca é alterado.
 */
export function HistoricoTitulo({
  tipo,
  titulo,
  onOpenChange,
}: {
  tipo: "receber" | "pagar";
  titulo: TituloHistorico | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: sessao } = useSessionData();
  const podeEstornar = podeEstornarBaixa(sessao?.roles ?? []);
  const [alvo, setAlvo] = useState<Lancamento | null>(null);
  const [motivo, setMotivo] = useState("");

  const estornar = useMutation({
    mutationFn: async () => {
      if (!alvo?.baixaId) return;
      const { error } = await supabase.rpc("baixa_estornar", {
        p_baixa_id: alvo.baixaId,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa estornada: o saldo do título foi reaberto.");
      setAlvo(null);
      setMotivo("");
      for (const chave of [
        "historico-titulo",
        "contas-pagar",
        "contas-receber",
        "caixa-movimentos",
        "extrato-receber",
        "extrato-receber-baixas",
        "fluxo-baixas",
        "fluxo-receber",
        "fluxo-pagar",
        "fluxo-caixa-movimentos",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [chave] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["historico-titulo", tipo, titulo?.id],
    enabled: Boolean(titulo),
    queryFn: async (): Promise<Lancamento[]> => {
      const coluna = tipo === "receber" ? "conta_receber_id" : "conta_pagar_id";
      const { data: baixas, error } = await supabase
        .from("financeiro_baixas")
        .select(
          "id, valor, forma_pagamento, data_baixa, observacao, created_at, estorno_de, motivo_estorno, caixas(numero)",
        )
        .eq(coluna, titulo!.id)
        .order("created_at");
      if (error) throw error;

      const estornadas = baixasEstornadas(baixas ?? []);
      const lista: Lancamento[] = (baixas ?? []).map((b) => {
        const caixa = (b.caixas as { numero: number } | null)?.numero;
        return {
          chave: `b-${b.id}`,
          data: b.data_baixa,
          quando: b.created_at,
          valor: valorLiquidoBaixa(b),
          forma: labelForma(b.forma_pagamento),
          descricao: [b.observacao, caixa ? `caixa nº ${caixa}` : null].filter(Boolean).join(" · "),
          tipo: b.estorno_de ? "estorno" : "pagamento",
          baixaId: b.estorno_de ? undefined : b.id,
          estornada: estornadas.has(b.id),
        };
      });

      if (tipo === "receber") {
        const { data: abatimentos, error: erroAbat } = await supabase
          .from("premiacao_abatimentos")
          .select("id, valor, data, observacao, created_at, profissionais(nome)")
          .eq("conta_receber_id", titulo!.id)
          .order("created_at");
        if (erroAbat) throw erroAbat;
        for (const a of abatimentos ?? []) {
          lista.push({
            chave: `a-${a.id}`,
            data: a.data,
            quando: a.created_at,
            valor: Number(a.valor),
            forma: "Crédito do profissional",
            descricao: [(a.profissionais as { nome: string } | null)?.nome, a.observacao]
              .filter(Boolean)
              .join(" · "),
            tipo: "credito",
          });
        }
      }

      return lista.sort((a, b) => a.quando.localeCompare(b.quando));
    },
  });

  const total = lancamentos.reduce((s, l) => s + l.valor, 0);
  const saldo = titulo ? Number(titulo.valor) - total : 0;
  let acumulado = 0;

  return (
    <Dialog open={Boolean(titulo)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Histórico do título nº {titulo?.numero}
          </DialogTitle>
          <DialogDescription>
            {titulo?.pessoa} · {titulo?.descricao ?? "sem descrição"}
            {titulo?.parcelas && titulo.parcelas > 1
              ? ` · parcela ${titulo.parcela}/${titulo.parcelas}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase text-muted-foreground">Valor do título</p>
            <p className="text-numeric text-lg font-semibold">{brl(Number(titulo?.valor ?? 0))}</p>
            <p className="text-xs text-muted-foreground">
              Vencimento {titulo ? dateBR(titulo.vencimento) : "—"}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase text-muted-foreground">
              {tipo === "receber" ? "Já recebido" : "Já pago"}
            </p>
            <p className="text-numeric text-lg font-semibold text-success">{brl(total)}</p>
            <p className="text-xs text-muted-foreground">
              {lancamentos.length} lançamento(s) no título
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase text-muted-foreground">Saldo restante</p>
            <p className="text-numeric text-lg font-semibold">{brl(saldo)}</p>
            <p className="text-xs text-muted-foreground">
              {saldo <= 0 ? "Título quitado" : "Pagamento parcial em andamento"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando histórico…</p>
        ) : lancamentos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum {tipo === "receber" ? "recebimento" : "pagamento"} lançado neste título até
            agora.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Data</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead className="w-28 text-right">Valor</TableHead>
                  <TableHead className="w-32 text-right">Saldo depois</TableHead>
                  {podeEstornar && <TableHead className="w-28" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lancamentos.map((l) => {
                  acumulado += l.valor;
                  const restante = Number(titulo?.valor ?? 0) - acumulado;
                  return (
                    <TableRow key={l.chave}>
                      <TableCell className="text-sm">
                        {dateBR(l.data)}
                        <p className="text-xs text-muted-foreground">{dateTimeBR(l.quando)}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {l.tipo === "credito" ? (
                          <Badge variant="secondary">{l.forma}</Badge>
                        ) : (
                          l.forma
                        )}
                        {l.tipo === "estorno" && (
                          <Badge variant="destructive" className="ml-2">
                            Estorno
                          </Badge>
                        )}
                        {l.estornada && (
                          <Badge variant="outline" className="ml-2">
                            Estornada
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.descricao || "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right text-numeric ${l.valor < 0 ? "text-destructive" : "text-success"}`}
                      >
                        {brl(l.valor)}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(restante > 0 ? restante : 0)}
                        {restante <= 0 && <p className="text-xs text-muted-foreground">quitado</p>}
                      </TableCell>
                      {podeEstornar && (
                        <TableCell className="text-right">
                          {l.baixaId && !l.estornada && (
                            <Button variant="ghost" size="sm" onClick={() => setAlvo(l)}>
                              <Undo2 className="size-4" /> Estornar
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Os lançamentos do histórico nunca são apagados nem alterados — cada pagamento parcial fica
          registrado com data, forma e quem recebeu. Para corrigir um lançamento errado, use
          “Estornar”: o estorno entra como novo lançamento, com motivo, e reabre o saldo.
        </p>

        <Dialog open={Boolean(alvo)} onOpenChange={(aberto) => !aberto && setAlvo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Estornar lançamento de {alvo ? brl(alvo.valor) : ""}</DialogTitle>
              <DialogDescription>
                O saldo do título é reaberto e, se o dinheiro passou pelo caixa ou pelo banco, o
                lançamento inverso é feito. Não dá para desfazer um estorno.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo do estorno (obrigatório)"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAlvo(null)}>
                Voltar
              </Button>
              <Button
                variant="destructive"
                disabled={motivo.trim().length < 3 || estornar.isPending}
                onClick={() => estornar.mutate()}
              >
                {estornar.isPending ? "Estornando…" : "Confirmar estorno"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
