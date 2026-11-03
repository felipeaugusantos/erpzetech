import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Printer, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { HospedeDialog } from "@/components/hotelaria/HospedeDialog";
import { imprimirHtml } from "@/components/hotelaria/imprimir";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { filtrarHospedes, useHospedes } from "@/hooks/useHospedes";
import { useSessionData } from "@/hooks/useSessionData";
import { htmlFichaHospedagem } from "@/lib/ficha-hospedagem";
import { dateBR } from "@/lib/format";
import { textoPessoas } from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type { FichaHospedagemDados, Hotel } from "@/lib/hotelaria-tipos";

export type QuartoParaCheckin = {
  reserva_uh_id: string;
  reserva_numero: number;
  titular: string;
  titular_id?: string | null;
  uh: string | null;
  entrada?: string | undefined;
  saida?: string | undefined;
  adultos?: number | undefined;
  criancas?: number | undefined;
};

/** Check-in: escolhe os acompanhantes (o titular entra sozinho), faz o check-in e oferece a ficha de hospedagem para imprimir. */
export function CheckinDialog({
  hotel,
  quarto,
  onFechar,
  aoConcluir,
}: {
  hotel: Hotel;
  quarto: QuartoParaCheckin | null;
  onFechar: () => void;
  aoConcluir?: () => void;
}) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const { data: hospedes = [] } = useHospedes();
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [novo, setNovo] = useState(false);
  const [ficha, setFicha] = useState<FichaHospedagemDados | null>(null);

  useEffect(() => {
    if (quarto) {
      setBusca("");
      setEscolhidos([]);
      setFicha(null);
    }
  }, [quarto?.reserva_uh_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(
    () =>
      filtrarHospedes(hospedes, busca)
        .filter((h) => h.nome !== quarto?.titular)
        .slice(0, 30),
    [hospedes, busca, quarto?.titular],
  );
  const vagas = Math.max((quarto?.adultos ?? 1) + (quarto?.criancas ?? 0) - 1, 0);

  const fazer = useMutation({
    mutationFn: async () =>
      hsRpc<FichaHospedagemDados>("hs_checkin", {
        p_reserva_uh: quarto!.reserva_uh_id,
        p_acompanhantes: escolhidos,
      }),
    onSuccess: (f) => {
      setFicha(f);
      toast.success("Check-in feito.");
      void qc.invalidateQueries({ queryKey: ["hotel-painel"] });
      void qc.invalidateQueries({ queryKey: ["hotel-mapa"] });
      void qc.invalidateQueries({ queryKey: ["hotel-reserva"] });
      void qc.invalidateQueries({ queryKey: ["hotel-reservas"] });
      aoConcluir?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function imprimir() {
    if (!ficha) return;
    imprimirHtml(
      htmlFichaHospedagem({
        hotel: hotel.nome,
        empresa: sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || null,
        ficha,
      }),
    );
  }

  function alternar(id: string) {
    setEscolhidos((atual) =>
      atual.includes(id)
        ? atual.filter((x) => x !== id)
        : atual.length < vagas
          ? [...atual, id]
          : atual,
    );
  }

  return (
    <>
      <Dialog open={quarto !== null} onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{ficha ? "Check-in feito" : "Check-in"}</DialogTitle>
            <DialogDescription>
              {quarto && (
                <>
                  Reserva {quarto.reserva_numero} · {quarto.titular} · acomodação{" "}
                  {quarto.uh ?? "sem acomodação"}
                  {quarto.entrada &&
                    quarto.saida &&
                    ` · ${dateBR(quarto.entrada)} a ${dateBR(quarto.saida)}`}
                  {quarto.adultos !== undefined &&
                    ` · ${textoPessoas(quarto.adultos, quarto.criancas ?? 0)}`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {ficha ? (
            <div className="space-y-2 text-sm">
              <p>
                {ficha.hospedes.length} hóspede(s) registrado(s) na acomodação {ficha.uh}. Entregue
                a ficha para assinatura.
              </p>
              <Button variant="outline" onClick={imprimir}>
                <Printer className="size-4" /> Imprimir ficha de hospedagem
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                O titular da reserva entra sozinho.{" "}
                {vagas > 0
                  ? `Dá para registrar até ${vagas} acompanhante(s).`
                  : "A reserva é só para uma pessoa."}
              </p>
              {vagas > 0 && (
                <>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Buscar acompanhante"
                      placeholder="Buscar por nome, documento ou telefone"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                    <Button variant="outline" onClick={() => setNovo(true)}>
                      <UserPlus className="size-4" /> Novo
                    </Button>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {lista.length === 0 && (
                      <p className="p-2 text-sm text-muted-foreground">
                        Nenhum hóspede encontrado.
                      </p>
                    )}
                    {lista.map((h) => (
                      <label
                        key={h.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary"
                      >
                        <Checkbox
                          checked={escolhidos.includes(h.id)}
                          onCheckedChange={() => alternar(h.id)}
                        />
                        <span>{h.nome}</span>
                        {h.documento_numero && (
                          <span className="text-xs text-muted-foreground">
                            {h.documento_numero}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {ficha ? (
              <Button onClick={onFechar}>Concluir</Button>
            ) : (
              <>
                <Button variant="outline" onClick={onFechar}>
                  Cancelar
                </Button>
                <Button onClick={() => fazer.mutate()} disabled={fazer.isPending}>
                  {fazer.isPending ? "Fazendo check-in…" : "Fazer check-in"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <HospedeDialog
        aberto={novo}
        onFechar={() => setNovo(false)}
        aoSalvar={(id) => setEscolhidos((a) => (a.length < vagas ? [...a, id] : a))}
      />
    </>
  );
}
