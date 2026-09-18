import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, dateTimeBR } from "@/lib/format";
import { labelForma } from "@/lib/financeiro";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  tipo: "pagamento" | "credito";
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
  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ["historico-titulo", tipo, titulo?.id],
    enabled: Boolean(titulo),
    queryFn: async (): Promise<Lancamento[]> => {
      const coluna = tipo === "receber" ? "conta_receber_id" : "conta_pagar_id";
      const { data: baixas, error } = await supabase
        .from("financeiro_baixas")
        .select("id, valor, forma_pagamento, data_baixa, observacao, created_at, caixas(numero)")
        .eq(coluna, titulo!.id)
        .order("created_at");
      if (error) throw error;

      const lista: Lancamento[] = (baixas ?? []).map((b) => {
        const caixa = (b.caixas as { numero: number } | null)?.numero;
        return {
          chave: `b-${b.id}`,
          data: b.data_baixa,
          quando: b.created_at,
          valor: Number(b.valor),
          forma: labelForma(b.forma_pagamento),
          descricao: [b.observacao, caixa ? `caixa nº ${caixa}` : null]
            .filter(Boolean)
            .join(" · "),
          tipo: "pagamento",
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
            descricao: [
              (a.profissionais as { nome: string } | null)?.nome,
              a.observacao,
            ]
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
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.descricao || "—"}
                      </TableCell>
                      <TableCell className="text-right text-numeric text-success">
                        {brl(l.valor)}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(restante > 0 ? restante : 0)}
                        {restante <= 0 && (
                          <p className="text-xs text-muted-foreground">quitado</p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Os lançamentos do histórico nunca são apagados nem alterados — cada pagamento parcial fica
          registrado com data, forma e quem recebeu.
        </p>
      </DialogContent>
    </Dialog>
  );
}
