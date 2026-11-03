import { Fragment, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { NovaReservaDialog, type InicialReserva } from "@/components/hotelaria/NovaReservaDialog";
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
import { useSessionData } from "@/hooks/useSessionData";
import { dateBR } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import {
  cabecalhoDoDia,
  celulasDaAcomodacao,
  rotuloLimpeza,
  segmentosDaLinha,
  somarDias,
} from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type { Hotel, MapaDados, OcupacaoDoMapaDados } from "@/lib/hotelaria-tipos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/hotel-mapa")({
  head: () => ({
    meta: [
      { title: "Mapa de ocupação — EZRA ERP" },
      {
        name: "description",
        content: "Acomodações por dia: reservas, hóspedes na casa, bloqueios e o que está livre.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Mapa hotel={hotel} />}</ModuloHotelaria>,
});

const JANELAS = [14, 21, 31, 45];

function classeDaOcupacao(o: OcupacaoDoMapaDados) {
  if (o.origem === "bloqueio") return "border-destructive/40 bg-destructive/15 text-destructive";
  if (o.situacao === "hospedada") return "border-success/50 bg-success/25";
  if (o.situacao === "finalizada") return "border-border bg-muted text-muted-foreground";
  return cn(
    "border-primary/40 bg-primary/20",
    o.reserva_situacao === "pendente" && "border-dashed",
  );
}

function Mapa({ hotel }: { hotel: Hotel }) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const [de, setDe] = useState(() => somarDias(isoBrasilia(), -1));
  const [janela, setJanela] = useState(21);
  const [nova, setNova] = useState<InicialReserva | null>(null);
  const [bloqueio, setBloqueio] = useState<OcupacaoDoMapaDados | null>(null);

  const ate = somarDias(de, janela);
  const mapa = useQuery({
    queryKey: ["hotel-mapa", hotel.id, de, janela],
    refetchInterval: 60_000,
    queryFn: () => hsRpc<MapaDados>("hs_mapa", { p_filial: hotel.id, p_de: de, p_ate: ate }),
  });
  const m = mapa.data;
  const hoje = isoBrasilia();

  const linhasDoMapa = useMemo(
    () =>
      (m?.uhs ?? []).map((u) => ({
        uh: u,
        segmentos: segmentosDaLinha(celulasDaAcomodacao(m!.dias, u.ocupacoes)),
      })),
    [m],
  );

  const remover = useMutation({
    mutationFn: (id: string) => hsRpc("hs_bloqueio_remover", { p_id: id }),
    onSuccess: () => {
      toast.success("Bloqueio removido.");
      setBloqueio(null);
      void qc.invalidateQueries({ queryKey: ["hotel-mapa"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Mapa de ocupação"
        description={`${hotel.nome} · clique num dia livre para reservar e numa reserva para abrir a conta.`}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Voltar"
              onClick={() => setDe(somarDias(de, -Math.floor(janela / 2)))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              aria-label="Primeiro dia"
              type="date"
              className="w-40"
              value={de}
              onChange={(e) => e.target.value && setDe(e.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Avançar"
              onClick={() => setDe(somarDias(de, Math.floor(janela / 2)))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="outline" onClick={() => setDe(somarDias(hoje, -1))}>
              Hoje
            </Button>
            <Select value={String(janela)} onValueChange={(v) => setJanela(Number(v))}>
              <SelectTrigger aria-label="Dias na tela" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JANELAS.map((j) => (
                  <SelectItem key={j} value={String(j)}>
                    {j} dias
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setNova({})}>
              <Plus className="size-4" /> Nova reserva
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block size-3 rounded border border-primary/40 bg-primary/20" />{" "}
          Reservado
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-3 rounded border border-dashed border-primary/40 bg-primary/20" />{" "}
          Pendente
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-3 rounded border border-success/50 bg-success/25" />{" "}
          Hospedado
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-3 rounded border border-border bg-muted" /> Já saiu
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-3 rounded border border-destructive/40 bg-destructive/15" />{" "}
          Bloqueado
        </span>
      </div>

      {mapa.isLoading || !m ? (
        <div className="panel h-64 animate-pulse" />
      ) : mapa.error ? (
        <p className="text-sm text-destructive">{(mapa.error as Error).message}</p>
      ) : m.uhs.length === 0 ? (
        <div className="panel p-6 text-sm text-muted-foreground">
          Cadastre as acomodações do hotel para ver o mapa.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-36 bg-card p-2 text-left font-medium">
                  Acomodação
                </th>
                {m.dias.map((d) => {
                  const c = cabecalhoDoDia(d);
                  return (
                    <th
                      key={d}
                      className={cn(
                        "min-w-11 p-1 text-center font-normal",
                        c.fimDeSemana && "bg-secondary/60",
                        d === hoje && "bg-primary/15 font-semibold",
                      )}
                    >
                      <div className="text-[10px] uppercase text-muted-foreground">{c.semana}</div>
                      <div>{c.dia}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {linhasDoMapa.map(({ uh, segmentos }) => (
                <tr key={uh.uh_id} className="border-t border-border">
                  <td
                    className={cn(
                      "sticky left-0 z-10 bg-card p-2",
                      uh.interditada && "text-muted-foreground",
                    )}
                  >
                    <div className="font-medium">{uh.numero}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {uh.tipo}
                      {uh.situacao_limpeza !== "limpo" &&
                        ` · ${rotuloLimpeza(uh.situacao_limpeza).toLowerCase()}`}
                      {uh.interditada && " · interditada"}
                    </div>
                  </td>
                  {segmentos.map((s) => {
                    const o = s.ocupacao;
                    if (!o) {
                      return Array.from({ length: s.dias }, (_, k) => {
                        const dia = m.dias[s.inicio + k]!;
                        return (
                          <td key={dia} className="p-0">
                            <button
                              type="button"
                              aria-label={`Reservar a ${uh.numero} em ${dateBR(dia)}`}
                              disabled={uh.interditada}
                              className={cn(
                                "h-9 w-full hover:bg-primary/10 disabled:cursor-not-allowed disabled:bg-muted/50",
                                cabecalhoDoDia(dia).fimDeSemana && "bg-secondary/30",
                              )}
                              onClick={() =>
                                setNova({ uhId: uh.uh_id, entrada: dia, saida: somarDias(dia, 1) })
                              }
                            />
                          </td>
                        );
                      });
                    }
                    return (
                      <td key={o.id} colSpan={s.dias} className="p-0.5">
                        <button
                          type="button"
                          title={
                            o.origem === "bloqueio"
                              ? `Bloqueado: ${o.motivo}`
                              : `Reserva ${o.reserva_numero} · ${o.titular} · ${dateBR(o.de)} a ${dateBR(o.ate)}`
                          }
                          className={cn(
                            "h-8 w-full truncate rounded border px-1.5 text-left",
                            classeDaOcupacao(o),
                          )}
                          onClick={() =>
                            o.origem === "bloqueio"
                              ? setBloqueio(o)
                              : void navegar({
                                  to: "/hotel-estadia/$id",
                                  params: { id: o.reserva_id! },
                                })
                          }
                        >
                          {o.origem === "bloqueio"
                            ? (o.motivo ?? "Bloqueio")
                            : `${o.titular ?? ""}`}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/40">
                <td className="sticky left-0 z-10 bg-secondary p-2 font-medium">
                  Ocupadas / vendáveis
                </td>
                {m.totais_por_dia.map((t) => (
                  <td
                    key={t.data}
                    className="p-1 text-center"
                    title={`${t.livres} livre(s), ${t.bloqueadas} bloqueada(s)`}
                  >
                    {t.ocupadas}/{t.total}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {m && m.sem_acomodacao.length > 0 && (
        <section className="panel mt-4 p-4">
          <h2 className="mb-2 font-display text-base font-semibold">Reservas sem acomodação</h2>
          <ul className="space-y-1 text-sm">
            {m.sem_acomodacao.map((q) => (
              <Fragment key={q.reserva_uh_id}>
                <li>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() =>
                      void navegar({ to: "/hotel-estadia/$id", params: { id: q.reserva_id } })
                    }
                  >
                    Reserva {q.reserva_numero}
                  </button>{" "}
                  · {q.titular} · {q.tipo} · {dateBR(q.entrada)} a {dateBR(q.saida)}
                </li>
              </Fragment>
            ))}
          </ul>
        </section>
      )}

      <NovaReservaDialog
        hotel={hotel}
        aberto={nova !== null}
        onFechar={() => setNova(null)}
        {...(nova ? { inicial: nova } : {})}
      />

      <Dialog open={bloqueio !== null} onOpenChange={(o) => !o && setBloqueio(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Acomodação bloqueada</DialogTitle>
            <DialogDescription>
              {bloqueio &&
                `${bloqueio.motivo} · ${dateBR(bloqueio.de)} até ${dateBR(bloqueio.ate)}`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBloqueio(null)}>
              Fechar
            </Button>
            {gestao && bloqueio && (
              <Button
                variant="destructive"
                onClick={() => remover.mutate(bloqueio.id)}
                disabled={remover.isPending}
              >
                Remover bloqueio
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
