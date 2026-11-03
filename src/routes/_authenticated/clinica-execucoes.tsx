import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateTimeBR } from "@/lib/format";
import {
  ROTULO_COR,
  corDaExecucao,
  textoDoPrazo,
  type CorExecucao,
  type ExecucaoDose,
} from "@/lib/internacao";

export const Route = createFileRoute("/_authenticated/clinica-execucoes")({
  head: () => ({
    meta: [
      { title: "Mapa de execuções — EZRA ERP" },
      {
        name: "description",
        content: "Doses prescritas dos animais internados, com aviso de cor para o horário.",
      },
    ],
  }),
  component: ExecucoesModulo,
});

type Dose = {
  id: string;
  previsto_em: string;
  situacao: ExecucaoDose["situacao"];
  executado_em: string | null;
  executado_por: string | null;
  observacao: string | null;
  medicamento: string;
  dose: string;
  via: string | null;
  prescricao_observacao: string | null;
  internacao_id: string;
  pet: { id: string; nome: string; alergias: string | null };
  box: string;
};

// classes de cor (borda e fundo) por situação; o texto do rótulo repete a cor, para não depender só dela
const COR: Record<CorExecucao, string> = {
  verde: "border-green-600 bg-green-50 dark:bg-green-950/30",
  laranja: "border-orange-500 bg-orange-50 dark:bg-orange-950/30",
  cinza: "border-border bg-muted/50 opacity-70",
  azul: "border-sky-500 bg-sky-50 dark:bg-sky-950/30",
  amarelo: "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30",
  vermelho: "border-red-600 bg-red-50 dark:bg-red-950/30",
};
const COR_TEXTO: Record<CorExecucao, string> = {
  verde: "text-green-800 dark:text-green-300",
  laranja: "text-orange-800 dark:text-orange-300",
  cinza: "text-muted-foreground",
  azul: "text-sky-800 dark:text-sky-300",
  amarelo: "text-yellow-800 dark:text-yellow-300",
  vermelho: "text-red-800 dark:text-red-300",
};

function ExecucoesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Execucoes />;
}

function Execucoes() {
  const qc = useQueryClient();
  const [horas, setHoras] = useState("12");
  const [nao, setNao] = useState<Dose | null>(null);
  const [motivo, setMotivo] = useState("");

  const mapa = useQuery({
    queryKey: ["clinica-execucoes-mapa", horas],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_execucoes_mapa", {
        p_horas: Number(horas),
      });
      if (error) throw error;
      return data as unknown as { agora: string; itens: Dose[] };
    },
  });

  const registrar = useMutation({
    mutationFn: async (v: {
      id: string;
      situacao: "executada" | "nao_executada";
      obs?: string;
    }) => {
      const { error } = await supabase.rpc("clinica_execucao_registrar", {
        p_id: v.id,
        p_situacao: v.situacao,
        ...(v.obs ? { p_obs: v.obs } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNao(null);
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["clinica-execucoes-mapa"] });
      void qc.invalidateQueries({ queryKey: ["clinica-internacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const agora = mapa.data?.agora ?? new Date().toISOString();
  const itens = mapa.data?.itens ?? [];
  const atrasadas = itens.filter((d) => corDaExecucao(d, agora) === "vermelho").length;

  return (
    <div>
      <PageHeader
        title="Mapa de execuções"
        description="Doses prescritas dos animais internados. A tela atualiza sozinha a cada minuto."
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-44">
          <Label htmlFor="mx-horas" className="text-xs">
            Mostrar próximas
          </Label>
          <Select value={horas} onValueChange={setHoras}>
            <SelectTrigger id="mx-horas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["4", "12", "24", "48"].map((h) => (
                <SelectItem key={h} value={h}>
                  {h} horas
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Legenda das cores">
          {(Object.keys(ROTULO_COR) as CorExecucao[]).map((c) => (
            <li key={c} className={`rounded border px-2 py-0.5 ${COR[c]} ${COR_TEXTO[c]}`}>
              {ROTULO_COR[c]}
            </li>
          ))}
        </ul>
        {atrasadas > 0 && (
          <p className="text-sm font-semibold text-red-700" role="status">
            {atrasadas} dose{atrasadas === 1 ? "" : "s"} atrasada{atrasadas === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {mapa.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : mapa.error ? (
        <EmptyState
          title="Não foi possível abrir o mapa"
          description={(mapa.error as Error).message}
        />
      ) : itens.length === 0 ? (
        <EmptyState
          title="Nenhuma dose neste período"
          description="As doses aparecem quando o veterinário prescreve na ficha da internação."
        />
      ) : (
        <div className="grid gap-2">
          {itens.map((d) => {
            const cor = corDaExecucao(d, agora);
            const pendente = d.situacao === "pendente";
            return (
              <div
                key={d.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-md border-l-4 p-3 ${COR[cor]}`}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {d.pet.nome}{" "}
                    <span className="text-xs font-normal text-muted-foreground">· {d.box}</span>
                  </p>
                  <p className="text-sm">
                    {d.medicamento} · {d.dose}
                    {d.via ? ` · ${d.via}` : ""}
                  </p>
                  {d.prescricao_observacao && (
                    <p className="text-xs text-muted-foreground">{d.prescricao_observacao}</p>
                  )}
                  {d.pet.alergias && (
                    <p className="text-xs text-amber-800">Alergia: {d.pet.alergias}</p>
                  )}
                  {!pendente && (
                    <p className="text-xs text-muted-foreground">
                      {d.executado_por ? `${d.executado_por} · ` : ""}
                      {dateTimeBR(d.executado_em)}
                      {d.observacao ? ` — ${d.observacao}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${COR_TEXTO[cor]}`}>
                      {ROTULO_COR[cor]}
                      {pendente ? ` · ${textoDoPrazo(d.previsto_em, agora)}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{dateTimeBR(d.previsto_em)}</p>
                  </div>
                  {pendente && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => registrar.mutate({ id: d.id, situacao: "executada" })}
                        disabled={registrar.isPending}
                        aria-label={`Marcar dose de ${d.medicamento} de ${d.pet.nome} como feita`}
                      >
                        <Check className="size-4" /> Feita
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNao(d);
                          setMotivo("");
                        }}
                        aria-label={`Marcar dose de ${d.medicamento} de ${d.pet.nome} como não feita`}
                      >
                        <X className="size-4" /> Não feita
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nao && (
        <Dialog open onOpenChange={(o) => !o && setNao(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Dose não feita</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              {nao.pet.nome} · {nao.medicamento} · {dateTimeBR(nao.previsto_em)}
            </p>
            <Label htmlFor="mx-motivo">Por que a dose não foi feita?</Label>
            <Textarea
              id="mx-motivo"
              rows={3}
              maxLength={300}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setNao(null)}>
                Voltar
              </Button>
              <Button
                onClick={() =>
                  registrar.mutate({ id: nao.id, situacao: "nao_executada", obs: motivo })
                }
                disabled={registrar.isPending || !motivo.trim()}
              >
                Registrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
