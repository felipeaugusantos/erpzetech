import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { SeletorPeriodo } from "@/components/app/SeletorPeriodo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { hojeISO } from "@/lib/financeiro";
import { periodoDoAtalho, type Periodo } from "@/lib/periodo";
import {
  agruparPorDia,
  horaBrasilia,
  isoDeBrasilia,
  SITUACOES_AGENDA_EXAME,
  type SituacaoAgendaExame,
} from "@/lib/clinica-agenda-exames";

export const Route = createFileRoute("/_authenticated/clinica-agenda-exames")({
  head: () => ({
    meta: [
      { title: "Agenda de exames — ERP Ze Tech" },
      { name: "description", content: "Exames agendados com data, horário e situação." },
      { property: "og:title", content: "Agenda de exames — ERP Ze Tech" },
      { property: "og:description", content: "Planeje e acompanhe os exames da clínica." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgendaModulo,
});

type Item = {
  id: string;
  pet_id: string;
  pet: string;
  tutor: string | null;
  exame: string;
  agendado_para: string;
  situacao: SituacaoAgendaExame;
  observacao: string | null;
  veterinario: string | null;
};
type Paciente = { id: string; nome: string; tutor: string };

const TOM: Record<SituacaoAgendaExame, "default" | "secondary" | "destructive" | "outline"> = {
  agendado: "outline",
  coletado: "secondary",
  resultado: "default",
  faltou: "destructive",
  cancelado: "destructive",
};

function AgendaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <AgendaExames />;
}

function AgendaExames() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoAtalho("7dias"));
  const [novo, setNovo] = useState(false);
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(periodo.de) && /^\d{4}-\d{2}-\d{2}$/.test(periodo.ate);

  const lista = useQuery({
    queryKey: ["clinica-agenda-exames", periodo.de, periodo.ate],
    enabled: valido,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_agenda", {
        p_de: periodo.de,
        p_ate: periodo.ate,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
  });

  const mudar = useMutation({
    mutationFn: async ({ id, situacao }: { id: string; situacao: SituacaoAgendaExame }) => {
      const { error } = await supabase.rpc("clinica_exame_agenda_situacao", {
        p_id: id,
        p_situacao: situacao,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Situação atualizada");
      void qc.invalidateQueries({ queryKey: ["clinica-agenda-exames"] });
    },
    onError: (e: Error) => toast.error("Não foi possível atualizar", { description: e.message }),
  });

  const itens = lista.data ?? [];
  const conta = (s: SituacaoAgendaExame) => itens.filter((i) => i.situacao === s).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agenda de exames"
        description="Exames marcados por data e horário. Atualize a situação conforme o exame avança."
        actions={
          <Button onClick={() => setNovo(true)}>
            <Plus /> Agendar exame
          </Button>
        }
      />
      <SeletorPeriodo periodo={periodo} aoMudar={setPeriodo} />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Agendados" value={String(conta("agendado"))} icon={CalendarClock} />
        <StatCard label="Coletados" value={String(conta("coletado"))} icon={CalendarClock} />
        <StatCard
          label="Resultado pronto"
          value={String(conta("resultado"))}
          icon={CalendarClock}
          tone="success"
        />
        <StatCard label="Faltas" value={String(conta("faltou"))} icon={CalendarClock} tone="warning" />
      </div>

      {lista.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : lista.error ? (
        <p className="text-sm text-destructive">{(lista.error as Error).message}</p>
      ) : itens.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhum exame agendado no período"
          description="Use Agendar exame para marcar data e horário."
        />
      ) : (
        agruparPorDia(itens).map(([dia, doDia]) => (
          <div key={dia} className="panel p-4">
            <h3 className="mb-2 font-display text-sm font-semibold">
              {new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </h3>
            <ul className="divide-y divide-border text-sm">
              {doDia.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-14 font-mono font-semibold">{horaBrasilia(i.agendado_para)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.exame}</p>
                    <p className="text-xs text-muted-foreground">
                      <Link
                        to="/clinica-prontuario"
                        search={{ pet: i.pet_id }}
                        className="underline-offset-2 hover:underline"
                      >
                        {i.pet}
                      </Link>
                      {i.tutor ? ` · ${i.tutor}` : ""}
                      {i.veterinario ? ` · ${i.veterinario}` : ""}
                      {i.observacao ? ` · ${i.observacao}` : ""}
                    </p>
                  </div>
                  <Badge variant={TOM[i.situacao]}>{SITUACOES_AGENDA_EXAME[i.situacao]}</Badge>
                  <Select
                    value={i.situacao}
                    onValueChange={(v) => mudar.mutate({ id: i.id, situacao: v as SituacaoAgendaExame })}
                  >
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SITUACOES_AGENDA_EXAME) as SituacaoAgendaExame[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {SITUACOES_AGENDA_EXAME[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {novo && (
        <NovoAgendamento
          onFechar={() => setNovo(false)}
          onSalvo={() => {
            setNovo(false);
            void qc.invalidateQueries({ queryKey: ["clinica-agenda-exames"] });
          }}
        />
      )}
    </div>
  );
}

function NovoAgendamento({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: () => void }) {
  const [busca, setBusca] = useState("");
  const [pet, setPet] = useState<Paciente | null>(null);
  const [exame, setExame] = useState("");
  const [dia, setDia] = useState(hojeISO());
  const [hora, setHora] = useState("09:00");
  const [obs, setObs] = useState("");

  const achados = useQuery({
    queryKey: ["clinica-pacientes", busca],
    enabled: busca.trim().length >= 2 && !pet,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes", { p_busca: busca });
      if (error) throw error;
      return (data ?? []) as unknown as Paciente[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_exame_agendar", {
        p_dados: {
          pet_id: pet!.id,
          exame: exame.trim(),
          agendado_para: isoDeBrasilia(dia, hora),
          observacao: obs,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Exame agendado");
      onSalvo();
    },
    onError: (e: Error) => toast.error("Não foi possível agendar", { description: e.message }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar exame</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Paciente *</Label>
            {pet ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  {pet.nome} <span className="text-muted-foreground">· {pet.tutor}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPet(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="Nome do pet ou do tutor"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                {(achados.data ?? []).length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-border text-sm">
                    {(achados.data ?? []).map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left hover:bg-muted"
                          onClick={() => setPet(p)}
                        >
                          {p.nome} <span className="text-muted-foreground">· {p.tutor}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div>
            <Label htmlFor="ag-exame">Exame *</Label>
            <Input
              id="ag-exame"
              placeholder="Ex.: Hemograma completo"
              value={exame}
              onChange={(e) => setExame(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ag-dia">Data *</Label>
              <Input id="ag-dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ag-hora">Horário *</Label>
              <Input id="ag-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ag-obs">Observação</Label>
            <Input
              id="ag-obs"
              placeholder="Ex.: jejum de 8 horas"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            disabled={!pet || exame.trim().length < 2 || !dia || !hora || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
