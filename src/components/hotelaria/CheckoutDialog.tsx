import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl, dateBR } from "@/lib/format";
import { formasPagamento } from "@/lib/financeiro";
import { textoNoites } from "@/lib/hotelaria";
import { hsDb, hsRpc, linhas } from "@/lib/hotelaria-api";
import type { HsCaixa, Hotel, PreviaCheckout, ResultadoCheckout } from "@/lib/hotelaria-tipos";

export type QuartoParaCheckout = {
  reserva_uh_id: string;
  reserva_id: string;
  reserva_numero: number;
  titular: string;
  uh: string | null;
};

type Linha = { forma: string; valor: string };

// crediário não é aceito na conta do hóspede
const FORMAS = formasPagamento.filter((f) => f.value !== "crediario");
const centavos = (v: number) => Math.round(v * 100);

/**
 * Check-out: mostra o que será cobrado (prévia calculada pelo banco), pede os pagamentos de cada conta com saldo (ou a devolução do crédito) e
 * confirma. Em reserva de vários quartos o pagamento é feito no último quarto a sair.
 */
export function CheckoutDialog({
  hotel,
  quarto,
  onFechar,
  aoConcluir,
}: {
  hotel: Hotel;
  quarto: QuartoParaCheckout | null;
  onFechar: () => void;
  aoConcluir?: () => void;
}) {
  const qc = useQueryClient();
  const [caixaId, setCaixaId] = useState("");
  const [linhasPorConta, setLinhasPorConta] = useState<Record<string, Linha[]>>({});
  const [resultado, setResultado] = useState<ResultadoCheckout | null>(null);

  const previa = useQuery({
    queryKey: ["hotel-checkout-previa", quarto?.reserva_uh_id],
    enabled: quarto !== null,
    queryFn: () =>
      hsRpc<PreviaCheckout>("hs_checkout_previa", { p_reserva_uh: quarto!.reserva_uh_id }),
  });
  const caixas = useQuery({
    queryKey: ["hotel-caixas", hotel.id],
    enabled: quarto !== null,
    queryFn: async () =>
      linhas<HsCaixa>(
        await hsDb
          .from("caixas")
          .select("id, filial_id, situacao")
          .eq("filial_id", hotel.id)
          .eq("situacao", "aberto"),
      ),
  });

  useEffect(() => {
    setResultado(null);
    setLinhasPorConta({});
  }, [quarto?.reserva_uh_id]);

  useEffect(() => {
    if (!previa.data) return;
    const inicial: Record<string, Linha[]> = {};
    for (const c of previa.data.contas) {
      const s = c.saldo_previsto;
      inicial[c.folio_id ?? "principal"] =
        s === 0 ? [] : [{ forma: s > 0 ? "dinheiro" : "pix", valor: Math.abs(s).toFixed(2) }];
    }
    setLinhasPorConta(inicial);
  }, [previa.data]);

  useEffect(() => {
    if (!caixaId && caixas.data?.[0]) setCaixaId(caixas.data[0].id);
  }, [caixas.data, caixaId]);

  const contas = previa.data?.contas ?? [];
  const pagar = previa.data?.ultimo_quarto ?? false;
  const soma = (chave: string) =>
    (linhasPorConta[chave] ?? []).reduce(
      (s, l) => s + centavos(Number(l.valor.replace(",", ".")) || 0),
      0,
    );
  const diferencas = contas.map((c) => ({
    c,
    resta: centavos(Math.abs(c.saldo_previsto)) - soma(c.folio_id ?? "principal"),
  }));
  const fechado = !pagar || diferencas.every((d) => d.resta === 0);
  const precisaCaixa = pagar && contas.some((c) => c.saldo_previsto !== 0);

  const fazer = useMutation({
    mutationFn: async () => {
      const pagamentos = contas.flatMap((c) =>
        (linhasPorConta[c.folio_id ?? "principal"] ?? []).map((l) => ({
          forma: l.forma,
          valor: Number(l.valor.replace(",", ".")),
          tipo: c.saldo_previsto < 0 ? "devolucao" : "pagamento",
          ...(c.folio_id && !c.principal ? { folio_id: c.folio_id } : {}),
        })),
      );
      return hsRpc<ResultadoCheckout>("hs_checkout", {
        p_reserva_uh: quarto!.reserva_uh_id,
        p_pagamentos: pagar ? pagamentos : [],
        ...(precisaCaixa ? { p_caixa: caixaId } : {}),
      });
    },
    onSuccess: (r) => {
      setResultado(r);
      toast.success(
        r.parcial ? "Quarto encerrado. A conta fica para o último quarto." : "Check-out feito.",
      );
      for (const k of [
        "hotel-painel",
        "hotel-mapa",
        "hotel-reserva",
        "hotel-reservas",
        "hotel-folio",
      ])
        void qc.invalidateQueries({ queryKey: [k] });
      aoConcluir?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function mudarLinha(chave: string, i: number, parte: Partial<Linha>) {
    setLinhasPorConta((m) => ({
      ...m,
      [chave]: (m[chave] ?? []).map((l, j) => (j === i ? { ...l, ...parte } : l)),
    }));
  }

  return (
    <Dialog open={quarto !== null} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resultado ? "Check-out feito" : "Check-out"}</DialogTitle>
          <DialogDescription>
            {quarto &&
              `Reserva ${quarto.reserva_numero} · ${quarto.titular} · acomodação ${quarto.uh ?? "—"}`}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-2 text-sm">
            {resultado.parcial ? (
              <p>
                Este quarto saiu e a acomodação ficou suja. A conta e a nota ficam para o check-out
                do último quarto da reserva.
              </p>
            ) : (
              <>
                <p>
                  {textoNoites(resultado.noites_cobradas ?? 0)} cobradas
                  {resultado.recebido !== undefined &&
                    ` · ${resultado.recebido < 0 ? "devolvido" : "recebido"} ${brl(Math.abs(resultado.recebido))}`}
                  .
                </p>
                <p>
                  {resultado.nfe_ids.length > 0
                    ? `${resultado.nfe_ids.length} NFS-e criada(s) em rascunho. Complete a configuração fiscal para transmitir.`
                    : "Nada a faturar em nota de serviço."}
                </p>
              </>
            )}
            <p className="text-muted-foreground">
              A acomodação fica suja até a recepção liberar a limpeza.
            </p>
            <Link
              to="/hotel-estadia/$id"
              params={{ id: quarto!.reserva_id }}
              className="text-primary underline"
            >
              Abrir a reserva
            </Link>
          </div>
        ) : previa.isLoading ? (
          <div className="panel h-32 animate-pulse" />
        ) : previa.error ? (
          <p className="text-sm text-destructive">{(previa.error as Error).message}</p>
        ) : previa.data ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-md border border-border p-3">
              <p>
                Saída em <strong>{dateBR(previa.data.saida)}</strong>
                {previa.data.saida !== previa.data.saida_prevista && (
                  <span className="text-muted-foreground">
                    {" "}
                    (prevista {dateBR(previa.data.saida_prevista)})
                  </span>
                )}{" "}
                · {textoNoites(previa.data.noites_cobradas)} cobradas
              </p>
              {previa.data.a_lancar > 0 && (
                <p className="text-muted-foreground">
                  Ainda serão lançados {brl(previa.data.a_lancar)} de diárias e taxa de turismo.
                </p>
              )}
            </div>

            {!pagar && (
              <p className="rounded-md bg-secondary p-3">
                Esta reserva tem outros quartos hospedados. Este quarto sai agora e a conta é paga
                no check-out do último quarto.
              </p>
            )}

            {pagar &&
              contas.map((c) => {
                const chave = c.folio_id ?? "principal";
                const l = linhasPorConta[chave] ?? [];
                const resta = diferencas.find((d) => d.c === c)?.resta ?? 0;
                return (
                  <div key={chave} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">{c.titulo}</span>
                      <span className={c.saldo_previsto < 0 ? "text-emerald-600" : ""}>
                        {c.saldo_previsto < 0
                          ? `Crédito do hóspede ${brl(-c.saldo_previsto)}`
                          : c.saldo_previsto === 0
                            ? "Conta quitada"
                            : `A receber ${brl(c.saldo_previsto)}`}
                      </span>
                    </div>
                    {c.saldo_previsto !== 0 && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {c.saldo_previsto < 0 ? "Devolução ao hóspede" : "Pagamentos"}
                        </p>
                        {l.map((x, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Select
                              value={x.forma}
                              onValueChange={(v) => mudarLinha(chave, i, { forma: v })}
                            >
                              <SelectTrigger className="w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FORMAS.map((f) => (
                                  <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              aria-label="Valor"
                              inputMode="decimal"
                              className="w-32"
                              value={x.valor}
                              onChange={(e) => mudarLinha(chave, i, { valor: e.target.value })}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Tirar linha"
                              onClick={() =>
                                setLinhasPorConta((m) => ({
                                  ...m,
                                  [chave]: l.filter((_, j) => j !== i),
                                }))
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ))}
                        <div className="flex items-center justify-between">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setLinhasPorConta((m) => ({
                                ...m,
                                [chave]: [
                                  ...l,
                                  {
                                    forma: "pix",
                                    valor: resta > 0 ? (resta / 100).toFixed(2) : "",
                                  },
                                ],
                              }))
                            }
                          >
                            <Plus className="size-4" /> Dividir pagamento
                          </Button>
                          {resta !== 0 && (
                            <span className="text-xs text-destructive">
                              {resta > 0
                                ? `Falta ${brl(resta / 100)}`
                                : `Passou ${brl(-resta / 100)}`}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

            {precisaCaixa && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Caixa do hotel</p>
                {caixas.data && caixas.data.length > 0 ? (
                  <Select value={caixaId} onValueChange={setCaixaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha o caixa" />
                    </SelectTrigger>
                    <SelectContent>
                      {caixas.data.map((c, i) => (
                        <SelectItem key={c.id} value={c.id}>
                          Caixa aberto {caixas.data!.length > 1 ? i + 1 : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-destructive">
                    Não há caixa aberto neste hotel. Abra o caixa para receber o pagamento.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {resultado ? (
            <Button onClick={onFechar}>Concluir</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button
                onClick={() => fazer.mutate()}
                disabled={fazer.isPending || !previa.data || !fechado || (precisaCaixa && !caixaId)}
              >
                {fazer.isPending ? "Fazendo check-out…" : "Fazer check-out"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
