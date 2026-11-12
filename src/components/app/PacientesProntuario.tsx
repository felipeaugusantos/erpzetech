import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PawPrint, RefreshCw, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import { ESPECIES, rotulo } from "@/lib/pet";

type Paciente = {
  id: string; nome: string; especie: string; raca: string | null; tutor: string | null;
  atendimentos: number; ultimo_atendimento: string; em_atendimento: boolean;
};
type Lista = { total: number; pacientes: Paciente[] };

export function PacientesProntuario({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const { data: sessao } = useSessionData();
  const [pagina, setPagina] = useState(0);
  const lista = useQuery({
    queryKey: ["clinica-pacientes-atendidos", sessao?.user.id, sessao?.profile?.tenant_id, pagina],
    enabled: Boolean(sessao?.user.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes_atendidos", { p_pagina: pagina });
      if (error) throw error;
      return data as unknown as Lista;
    },
  });
  return (
    <section aria-label="Pacientes atendidos" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold">Pacientes atendidos</h2>
          {lista.data && <Badge variant="secondary">{lista.data.total}</Badge>}
        </div>
        <Button variant="outline" size="sm" disabled={lista.isFetching} onClick={() => void lista.refetch()}>
          <RefreshCw className="size-4" /> Atualizar
        </Button>
      </div>
      {lista.isPending ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-48 animate-pulse rounded-md bg-muted" />)}</div>
        : lista.error ? <p role="alert" className="text-sm text-destructive">{lista.error.message}</p>
        : !lista.data?.pacientes.length ? <p className="py-8 text-sm text-muted-foreground">Nenhum paciente atendido nesta empresa.</p>
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lista.data.pacientes.map(p => (
            <article key={p.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><PawPrint className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-semibold">{p.nome}</h3>
                  <p className="break-words text-xs text-muted-foreground">{rotulo(ESPECIES, p.especie)}{p.raca ? ` · ${p.raca}` : ""}</p>
                </div>
              </div>
              <p className="mt-3 break-words text-sm text-muted-foreground">Tutor(a): {p.tutor ?? "—"}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{p.atendimentos} atendimento{p.atendimentos === 1 ? "" : "s"}</span>
                {p.em_atendimento && <Badge variant="secondary">Em atendimento</Badge>}
              </div>
              <p className="mb-4 mt-2 text-xs text-muted-foreground">Último atendimento: {dateTimeBR(p.ultimo_atendimento)}</p>
              <Button className="mt-auto w-full" variant="outline" onClick={() => aoAbrir(p.id)}>Abrir prontuário <ArrowUpRight className="size-4" /></Button>
            </article>
          ))}
        </div>}
      {lista.data && lista.data.total > 24 && <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground">Página {pagina + 1} de {Math.ceil(lista.data.total / 24)}</span>
        <Button aria-label="Página anterior" variant="outline" size="icon" disabled={pagina === 0 || lista.isFetching} onClick={() => setPagina(p => p - 1)}><ChevronLeft className="size-4" /></Button>
        <Button aria-label="Próxima página" variant="outline" size="icon" disabled={(pagina + 1) * 24 >= lista.data.total || lista.isFetching} onClick={() => setPagina(p => p + 1)}><ChevronRight className="size-4" /></Button>
      </div>}
    </section>
  );
}