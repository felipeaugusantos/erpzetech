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
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-sm font-semibold">
          <CalendarClock className="size-4" /> Exames agendados
        </p>
        <Button asChild size="sm" variant="outline">
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
        <ul className="divide-y divide-border text-sm">
          {itens.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">{i.exame}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {diaBrasilia(i.agendado_para).split("-").reverse().join("/")} às{" "}
                  {horaBrasilia(i.agendado_para)}
                  {i.veterinario ? ` · ${i.veterinario}` : ""}
                  {i.observacao ? ` · ${i.observacao}` : ""}
                </span>
              </div>
              <Badge variant={i.situacao === "faltou" || i.situacao === "cancelado" ? "destructive" : "outline"}>
                {SITUACOES_AGENDA_EXAME[i.situacao]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
