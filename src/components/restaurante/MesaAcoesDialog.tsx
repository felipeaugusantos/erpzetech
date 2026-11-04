import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarClock, LockOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHAVE_REST, rpcRestaurante, type Mesa, type MesaReserva } from "@/lib/restaurante-dados";

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Valor de <input type="datetime-local"> no horário local, daqui a `min` minutos. */
function localDaqui(min: number) {
  const d = new Date(Date.now() + min * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Bloqueio e reservas de uma mesa que não tem comanda aberta. */
export function MesaAcoesDialog({
  mesa,
  reservas,
  onFechar,
}: {
  mesa: Mesa | null;
  reservas: MesaReserva[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [pessoas, setPessoas] = useState("");
  const [quando, setQuando] = useState(() => localDaqui(60));
  const [obs, setObs] = useState("");

  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });

  const bloquear = useMutation({
    mutationFn: (bloquear: boolean) =>
      rpcRestaurante("restaurante_bloquear_mesa", {
        p_mesa_id: mesa?.id,
        p_bloquear: bloquear,
        p_motivo: bloquear ? motivo.trim() || null : null,
      }),
    onSuccess: (_r, bloqueou) => {
      toast.success(bloqueou ? "Mesa bloqueada" : "Mesa desbloqueada");
      setMotivo("");
      atualizar();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reservar = useMutation({
    mutationFn: async () => {
      const qtd = pessoas.trim() ? Number(pessoas) : null;
      if (qtd !== null && (!Number.isInteger(qtd) || qtd <= 0))
        throw new Error("Informe a quantidade de pessoas");
      const data = new Date(quando);
      if (!quando || Number.isNaN(data.getTime()))
        throw new Error("Informe a data e a hora da reserva");
      return rpcRestaurante("restaurante_reservar_mesa", {
        p_mesa_id: mesa?.id,
        p_nome: nome.trim(),
        p_para: data.toISOString(),
        p_telefone: telefone.trim() || null,
        p_pessoas: qtd,
        p_observacao: obs.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success("Reserva registrada");
      setNome("");
      setTelefone("");
      setPessoas("");
      setObs("");
      setQuando(localDaqui(60));
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: (id: string) =>
      rpcRestaurante("restaurante_cancelar_reserva", { p_reserva_id: id }),
    onSuccess: () => {
      toast.success("Reserva cancelada");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const minhas = reservas
    .filter((r) => r.mesa_id === mesa?.id && r.situacao === "ativa")
    .sort((a, b) => a.reservada_para.localeCompare(b.reservada_para));

  return (
    <Dialog open={mesa !== null} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mesa {mesa?.numero}</DialogTitle>
          <DialogDescription>Reservar ou bloquear a mesa.</DialogDescription>
        </DialogHeader>

        {mesa?.bloqueada ? (
          <div className="space-y-2 rounded border border-slate-400 bg-slate-100 p-3">
            <p className="flex items-center gap-1.5 font-medium">
              <Ban className="size-4" /> Mesa bloqueada
            </p>
            {mesa.bloqueio_motivo && <p className="text-sm">Motivo: {mesa.bloqueio_motivo}</p>}
            <Button onClick={() => bloquear.mutate(false)} disabled={bloquear.isPending}>
              <LockOpen className="mr-1 size-4" /> Desbloquear
            </Button>
          </div>
        ) : (
          <>
            {minhas.length > 0 && (
              <section className="space-y-1">
                <h3 className="font-display text-sm font-semibold">Reservas</h3>
                {minhas.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                  >
                    <span>
                      <strong>{hora(r.reservada_para)}</strong> · {r.nome}
                      {r.pessoas ? ` · ${r.pessoas} pessoas` : ""}
                      {r.telefone ? ` · ${r.telefone}` : ""}
                      {r.observacao && (
                        <span className="block text-xs text-muted-foreground">{r.observacao}</span>
                      )}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Cancelar reserva de ${r.nome}`}
                      disabled={cancelar.isPending}
                      onClick={() => cancelar.mutate(r.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="font-display text-sm font-semibold">Nova reserva</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Label htmlFor="res-nome">Nome</Label>
                  <Input
                    id="res-nome"
                    maxLength={80}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="res-quando">Data e hora</Label>
                  <Input
                    id="res-quando"
                    type="datetime-local"
                    value={quando}
                    onChange={(e) => setQuando(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="res-pessoas">Pessoas</Label>
                  <Input
                    id="res-pessoas"
                    inputMode="numeric"
                    value={pessoas}
                    onChange={(e) => setPessoas(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="res-tel">Telefone</Label>
                  <Input
                    id="res-tel"
                    maxLength={30}
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="res-obs">Observação</Label>
                  <Input
                    id="res-obs"
                    maxLength={300}
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={() => reservar.mutate()}
                disabled={!nome.trim() || reservar.isPending}
              >
                <CalendarClock className="mr-1 size-4" /> Reservar
              </Button>
            </section>

            <section className="space-y-2 border-t pt-3">
              <h3 className="font-display text-sm font-semibold">Bloquear mesa</h3>
              <p className="text-xs text-muted-foreground">
                Mesa bloqueada não abre comanda nem recebe transferência (ex.: mesa quebrada,
                evento).
              </p>
              <Input
                aria-label="Motivo do bloqueio"
                placeholder="Motivo (opcional)"
                maxLength={200}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => bloquear.mutate(true)}
                disabled={bloquear.isPending}
              >
                <Ban className="mr-1 size-4" /> Bloquear
              </Button>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
