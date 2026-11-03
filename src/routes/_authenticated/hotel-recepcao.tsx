import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BedDouble,
  BrushCleaning,
  CalendarCheck,
  CalendarX,
  LogIn,
  LogOut,
  Moon,
  Percent,
  Plus,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { CheckinDialog, type QuartoParaCheckin } from "@/components/hotelaria/CheckinDialog";
import { CheckoutDialog, type QuartoParaCheckout } from "@/components/hotelaria/CheckoutDialog";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { NovaReservaDialog } from "@/components/hotelaria/NovaReservaDialog";
import { SituacaoBadge } from "@/components/hotelaria/SituacaoBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { brl, dateBR } from "@/lib/format";
import { textoPessoas } from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type { Hotel, PainelDia, QuartoDoPainel, ResultadoFecharDia } from "@/lib/hotelaria-tipos";

export const Route = createFileRoute("/_authenticated/hotel-recepcao")({
  head: () => ({
    meta: [
      { title: "Recepção do hotel — EZRA ERP" },
      {
        name: "description",
        content:
          "Chegadas, saídas, hóspedes na casa, ocupação, acomodações sujas e contas em aberto do dia.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Recepcao hotel={hotel} />}</ModuloHotelaria>,
});

function Secao({
  titulo,
  vazio,
  itens,
  children,
}: {
  titulo: string;
  vazio: string;
  itens: QuartoDoPainel[];
  children: (q: QuartoDoPainel) => React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
        {titulo} <Badge variant="secondary">{itens.length}</Badge>
      </h2>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="divide-y divide-border">
          {itens.map((q) => (
            <li
              key={q.reserva_uh_id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  <Link
                    to="/hotel-estadia/$id"
                    params={{ id: q.reserva_id }}
                    className="hover:underline"
                  >
                    {q.titular}
                  </Link>{" "}
                  <span className="text-muted-foreground">· reserva {q.reserva_numero}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {q.uh ? `Acomodação ${q.uh}` : "Sem acomodação"} · {q.tipo}
                  {q.entrada && q.saida && ` · ${dateBR(q.entrada)} a ${dateBR(q.saida)}`}
                  {q.adultos !== undefined && ` · ${textoPessoas(q.adultos, q.criancas ?? 0)}`}
                  {q.saldo !== undefined && q.saldo !== 0 && ` · saldo ${brl(q.saldo)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SituacaoBadge situacao={q.situacao} quarto />
                {children(q)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Recepcao({ hotel }: { hotel: Hotel }) {
  const qc = useQueryClient();
  const [data, setData] = useState("");
  const [nova, setNova] = useState(false);
  const [checkin, setCheckin] = useState<QuartoParaCheckin | null>(null);
  const [checkout, setCheckout] = useState<QuartoParaCheckout | null>(null);
  const [confirmaDia, setConfirmaDia] = useState(false);
  const [fechamento, setFechamento] = useState<ResultadoFecharDia | null>(null);

  const painel = useQuery({
    queryKey: ["hotel-painel", hotel.id, data],
    refetchInterval: 60_000,
    queryFn: () =>
      hsRpc<PainelDia>("hs_painel_dia", { p_filial: hotel.id, ...(data ? { p_data: data } : {}) }),
  });
  const p = painel.data;
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["hotel-painel"] });
  const ehHoje = !p || p.data === p.hoje;
  const podeFechar = !p || p.data <= p.hoje;

  const confirmar = useMutation({
    mutationFn: (id: string) => hsRpc("hs_reserva_confirmar", { p_id: id }),
    onSuccess: () => {
      toast.success("Reserva confirmada.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const liberar = useMutation({
    mutationFn: (uh: string) => hsRpc("hs_uh_situacao", { p_uh: uh, p_para: "limpo" }),
    onSuccess: () => {
      toast.success("Acomodação liberada.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const fechar = useMutation({
    mutationFn: () =>
      hsRpc<ResultadoFecharDia>("hs_auditoria_noturna", {
        p_filial: hotel.id,
        ...(data ? { p_data: data } : {}),
      }),
    onSuccess: (r) => {
      setConfirmaDia(false);
      setFechamento(r);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const paraCheckin = (q: QuartoDoPainel): QuartoParaCheckin => ({
    reserva_uh_id: q.reserva_uh_id,
    reserva_numero: q.reserva_numero,
    titular: q.titular,
    uh: q.uh,
    entrada: q.entrada,
    saida: q.saida,
    adultos: q.adultos,
    criancas: q.criancas,
  });
  const paraCheckout = (q: QuartoDoPainel): QuartoParaCheckout => ({
    reserva_uh_id: q.reserva_uh_id,
    reserva_id: q.reserva_id,
    reserva_numero: q.reserva_numero,
    titular: q.titular,
    uh: q.uh,
  });
  const botaoCheckin = (q: QuartoDoPainel) =>
    q.situacao === "reservada" ? (
      q.pendente ? (
        <Button size="sm" variant="outline" onClick={() => confirmar.mutate(q.reserva_id)}>
          Confirmar reserva
        </Button>
      ) : (
        <Button size="sm" onClick={() => setCheckin(paraCheckin(q))} disabled={!q.uh}>
          <LogIn className="size-4" /> Check-in
        </Button>
      )
    ) : null;
  const botaoCheckout = (q: QuartoDoPainel) =>
    q.situacao === "hospedada" ? (
      <Button size="sm" variant="outline" onClick={() => setCheckout(paraCheckout(q))}>
        <LogOut className="size-4" /> Check-out
      </Button>
    ) : null;

  return (
    <div>
      <PageHeader
        title="Recepção"
        description={`${hotel.nome} · ${p ? dateBR(p.data) : "…"}${ehHoje ? " (hoje)" : ""}`}
        actions={
          <>
            <Input
              aria-label="Dia do painel"
              type="date"
              className="w-40"
              value={data || p?.data || ""}
              onChange={(e) => setData(e.target.value)}
            />
            {podeFechar && (
              <Button variant="outline" onClick={() => setConfirmaDia(true)}>
                <Moon className="size-4" /> Fechar o dia
              </Button>
            )}
            <Button onClick={() => setNova(true)}>
              <Plus className="size-4" /> Nova reserva
            </Button>
          </>
        }
      />

      {painel.isLoading || !p ? (
        <div className="panel h-48 animate-pulse" />
      ) : painel.error ? (
        <p className="text-sm text-destructive">{(painel.error as Error).message}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard label="Chegadas" value={String(p.totais.chegadas)} icon={CalendarCheck} />
            <StatCard label="Saídas" value={String(p.totais.saidas)} icon={CalendarX} />
            <StatCard label="Hospedados" value={String(p.totais.hospedados)} icon={BedDouble} />
            <StatCard
              label="Ocupação"
              value={`${p.ocupacao.percentual.toLocaleString("pt-BR")}%`}
              hint={`${p.ocupacao.ocupadas} de ${p.ocupacao.vendaveis} vendáveis`}
              icon={Percent}
            />
            <StatCard
              label="Sujas"
              value={String(p.totais.sujas)}
              icon={BrushCleaning}
              tone={p.totais.sujas > 0 ? "warning" : "default"}
            />
            <StatCard
              label="A receber"
              value={brl(p.contas_em_aberto.total)}
              hint={`${p.contas_em_aberto.quantidade} conta(s)`}
              icon={Wallet}
            />
          </div>

          {(p.chegadas_atrasadas.length > 0 || p.saidas_atrasadas.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Secao titulo="Chegadas atrasadas" vazio="" itens={p.chegadas_atrasadas}>
                {(q) => (
                  <>
                    {botaoCheckin(q)}
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/hotel-estadia/$id" params={{ id: q.reserva_id }}>
                        Abrir
                      </Link>
                    </Button>
                  </>
                )}
              </Secao>
              <Secao titulo="Saídas atrasadas" vazio="" itens={p.saidas_atrasadas}>
                {(q) => (
                  <>
                    {botaoCheckout(q)}
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/hotel-estadia/$id" params={{ id: q.reserva_id }}>
                        Estender
                      </Link>
                    </Button>
                  </>
                )}
              </Secao>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Secao titulo="Chegadas do dia" vazio="Nenhuma chegada prevista." itens={p.chegadas}>
              {botaoCheckin}
            </Secao>
            <Secao titulo="Saídas do dia" vazio="Nenhuma saída prevista." itens={p.saidas}>
              {botaoCheckout}
            </Secao>
          </div>

          <Secao
            titulo="Hóspedes na casa"
            vazio="Ninguém hospedado nesta noite."
            itens={p.hospedados}
          >
            {(q) => (
              <>
                {botaoCheckout(q)}
                <Button asChild size="sm" variant="ghost">
                  <Link to="/hotel-estadia/$id" params={{ id: q.reserva_id }}>
                    Conta
                  </Link>
                </Button>
              </>
            )}
          </Secao>

          <section className="panel p-4">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
              Acomodações sujas <Badge variant="secondary">{p.sujas.length}</Badge>
            </h2>
            {p.sujas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tudo limpo.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {p.sujas.map((s) => (
                  <div
                    key={s.uh_id}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium">{s.numero}</span>
                    <span className="text-xs text-muted-foreground">{s.tipo}</span>
                    {s.ocupada ? (
                      <Badge variant="outline">com hóspede</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => liberar.mutate(s.uh_id)}
                        disabled={liberar.isPending}
                      >
                        Liberar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <NovaReservaDialog hotel={hotel} aberto={nova} onFechar={() => setNova(false)} />
      <CheckinDialog
        hotel={hotel}
        quarto={checkin}
        onFechar={() => setCheckin(null)}
        aoConcluir={atualizar}
      />
      <CheckoutDialog
        hotel={hotel}
        quarto={checkout}
        onFechar={() => setCheckout(null)}
        aoConcluir={atualizar}
      />

      <AlertDialog open={confirmaDia} onOpenChange={setConfirmaDia}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar o dia {p ? dateBR(p.data) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Lança a diária e a taxa de turismo da noite para cada quarto hospedado. Pode repetir:
              o que já foi lançado não é lançado de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => fechar.mutate()} disabled={fechar.isPending}>
              Fechar o dia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={fechamento !== null} onOpenChange={(o) => !o && setFechamento(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dia {fechamento ? dateBR(fechamento.data) : ""} fechado</DialogTitle>
          </DialogHeader>
          {fechamento && (
            <div className="space-y-3 text-sm">
              <p>
                {fechamento.quartos} quarto(s) lançado(s), {brl(fechamento.total_lancado)} em
                diárias e taxas.
              </p>
              {fechamento.chegadas_pendentes.length > 0 && (
                <div>
                  <p className="font-medium">Chegadas que não vieram</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {fechamento.chegadas_pendentes.map((c) => (
                      <li key={c.reserva_uh_id}>
                        Reserva {c.reserva_numero} · {c.titular} · {c.uh ?? "sem acomodação"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Decida se é não comparecimento na tela da reserva.
                  </p>
                </div>
              )}
              {fechamento.saidas_atrasadas.length > 0 && (
                <div>
                  <p className="font-medium">Saídas atrasadas</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {fechamento.saidas_atrasadas.map((c) => (
                      <li key={c.reserva_uh_id}>
                        Reserva {c.reserva_numero} · {c.titular} · {c.uh ?? "—"} · saída{" "}
                        {dateBR(c.saida)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Estenda a estadia ou faça o check-out.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setFechamento(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
