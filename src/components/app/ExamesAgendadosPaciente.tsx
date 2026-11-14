import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  diaBrasilia,
  horaBrasilia,
  SITUACOES_AGENDA_EXAME,
  type SituacaoAgendaExame,
} from "@/lib/clinica-agenda-exames";

type Item = {
  id: string;
  exame: string;
  agendado_para: string;
  situacao: SituacaoAgendaExame;
  observacao: string | null;
  veterinario: string | null;
};

/** Exames agendados do paciente (Agenda de exames), na ficha do prontuário. */
export function ExamesAgendadosPaciente({ petId }: { petId: string }) {
  const lista = useQuery({
    queryKey: ["clinica-agenda-exames", "pet", petId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_agenda_do_pet", { p_pet_id: petId });
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
  });
  const itens = lista.data ?? [];

  return (
    <div className="min-w-0 border-b border-border py-4">
      <div className="mb-3 grid gap-3 sm:flex sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 font-display text-sm font-semibold">
          <CalendarClock className="size-4" /> Exames agendados
        </p>
        <Button asChild size="sm" variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link to="/clinica-agenda-exames">Abrir agenda de exames</Link>
        </Button>
      </div>
      {lista.isLoading ? (
        <div className="h-12 animate-pulse rounded-md bg-muted" />
      ) : lista.error ? (
        <p className="text-sm text-destructive">{(lista.error as Error).message}</p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum exame agendado para este paciente.</p>
      ) : (
        <ul className="grid gap-3 text-sm lg:grid-cols-2">
          {itens.map((i) => (
            <li key={i.id} className="grid min-w-0 gap-3 rounded-md border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="break-words text-base font-semibold">{i.exame}</p>
                <time dateTime={i.agendado_para} className="mt-2 block font-semibold tabular-nums text-primary">
                  {diaBrasilia(i.agendado_para).split("-").reverse().join("/")} às{" "}
                  {horaBrasilia(i.agendado_para)}
                </time>
                {i.veterinario && <p className="mt-2 break-words text-muted-foreground">{i.veterinario}</p>}
                {i.observacao && <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{i.observacao}</p>}
              </div>
              <Badge className="w-fit" variant={i.situacao === "faltou" || i.situacao === "cancelado" ? "destructive" : "outline"}>
                {SITUACOES_AGENDA_EXAME[i.situacao]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
