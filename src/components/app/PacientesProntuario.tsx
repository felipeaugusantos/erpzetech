import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  PawPrint,
  RefreshCw,
  ArrowUpRight,
  LayoutGrid,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import { ESPECIES, rotulo } from "@/lib/pet";

type Paciente = {
  id: string;
  nome: string;
  especie: string;
  raca: string | null;
  tutor: string | null;
  atendimentos: number;
  ultimo_atendimento: string;
  em_atendimento: boolean;
  proxima_consulta: string | null;
};
type Lista = { total: number; pacientes: Paciente[] };

export function PacientesProntuario({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const { data: sessao } = useSessionData();
  const [pagina, setPagina] = useState(0);
  const [visualizacao, setVisualizacao] = useState<"cards" | "lista">("cards");
  const lista = useQuery({
    queryKey: ["clinica-pacientes-atendidos", sessao?.user.id, sessao?.profile?.tenant_id, pagina],
    enabled: Boolean(sessao?.user.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes_atendidos", {
        p_pagina: pagina,
      });
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
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Visualização dos pacientes" className="flex gap-1">
            <Button
              size="icon"
              variant={visualizacao === "cards" ? "default" : "outline"}
              aria-label="Visualizar como cartões"
              title="Cartões"
              aria-pressed={visualizacao === "cards"}
              onClick={() => setVisualizacao("cards")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              size="icon"
              variant={visualizacao === "lista" ? "default" : "outline"}
              aria-label="Visualizar como lista"
              title="Lista"
              aria-pressed={visualizacao === "lista"}
              onClick={() => setVisualizacao("lista")}
            >
              <List className="size-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={lista.isFetching}
            onClick={() => void lista.refetch()}
          >
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        </div>
      </div>
      {lista.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : lista.error ? (
        <p role="alert" className="text-sm text-destructive">
          {lista.error.message}
        </p>
      ) : !lista.data?.pacientes.length ? (
        <p className="py-8 text-sm text-muted-foreground">
          Nenhum paciente atendido nesta empresa.
        </p>
      ) : visualizacao === "lista" ? (
        <div className="min-w-0 border-y border-border">
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-3 border-b border-border py-2 text-xs font-medium text-muted-foreground lg:grid">
            <span>Paciente</span>
            <span>Tutor(a)</span>
            <span>Última visita · Atendimentos</span>
            <span>Próxima consulta</span>
            <span />
          </div>
        <ul className="min-w-0 divide-y divide-border">
          {lista.data.pacientes.map((p) => (
            <li
              key={p.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem]"
            >
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{p.nome}</h3>
                <p className="break-words text-xs text-muted-foreground">
                  {rotulo(ESPECIES, p.especie)}
                  {p.raca ? ` · ${p.raca}` : ""}
                </p>
              </div>
              <p className="col-start-1 min-w-0 break-words text-sm text-muted-foreground lg:col-auto">
                <span className="lg:hidden">Tutor(a): </span>{p.tutor ?? "—"}
              </p>
              <div className="col-start-1 min-w-0 text-sm sm:col-start-2 sm:row-start-1 lg:col-auto lg:row-auto">
                <p className="text-xs text-muted-foreground lg:hidden">Última visita</p>
                <p>{dateTimeBR(p.ultimo_atendimento)}</p>
                <p className="text-xs text-muted-foreground">
                  {p.atendimentos} atendimento{p.atendimentos === 1 ? "" : "s"}
                </p>
                {p.em_atendimento && (
                  <Badge variant="secondary" className="mt-1">
                    Em atendimento
                  </Badge>
                )}
              </div>
              <div className="col-start-1 min-w-0 text-sm sm:col-start-2 sm:row-start-2 lg:col-auto lg:row-auto">
                <p className="text-xs text-muted-foreground lg:hidden">Próxima consulta</p>
                <p
                  className={
                    p.proxima_consulta ? "font-medium text-primary" : "text-muted-foreground"
                  }
                >
                  {p.proxima_consulta ? dateTimeBR(p.proxima_consulta) : "Sem consulta agendada"}
                </p>
              </div>
              <Button variant="outline" size="icon" className="col-start-2 row-start-1 size-9 shrink-0 sm:col-start-3 lg:col-auto lg:row-auto" aria-label={`Abrir prontuário de ${p.nome}`} title={`Abrir prontuário de ${p.nome}`} onClick={() => aoAbrir(p.id)}>
                <ArrowUpRight className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lista.data.pacientes.map((p) => (
            <article
              key={p.id}
              className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <PawPrint className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-semibold">{p.nome}</h3>
                  <p className="break-words text-xs text-muted-foreground">
                    {rotulo(ESPECIES, p.especie)}
                    {p.raca ? ` · ${p.raca}` : ""}
                  </p>
                </div>
              </div>
              <p className="mt-3 break-words text-sm text-muted-foreground">
                Tutor(a): {p.tutor ?? "—"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {p.atendimentos} atendimento{p.atendimentos === 1 ? "" : "s"}
                </span>
                {p.em_atendimento && <Badge variant="secondary">Em atendimento</Badge>}
              </div>
              <dl className="mb-4 mt-3 space-y-2 border-t border-border pt-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Última visita</dt>
                  <dd>{dateTimeBR(p.ultimo_atendimento)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Próxima consulta</dt>
                  <dd
                    className={
                      p.proxima_consulta ? "font-medium text-primary" : "text-muted-foreground"
                    }
                  >
                    {p.proxima_consulta ? dateTimeBR(p.proxima_consulta) : "Sem consulta agendada"}
                  </dd>
                </div>
              </dl>
              <Button className="mt-auto w-full" variant="outline" onClick={() => aoAbrir(p.id)}>
                Abrir prontuário <ArrowUpRight className="size-4" />
              </Button>
            </article>
          ))}
        </div>
      )}
      {lista.data && lista.data.total > 24 && (
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground">
            Página {pagina + 1} de {Math.ceil(lista.data.total / 24)}
          </span>
          <Button
            aria-label="Página anterior"
            variant="outline"
            size="icon"
            disabled={pagina === 0 || lista.isFetching}
            onClick={() => setPagina((p) => p - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            aria-label="Próxima página"
            variant="outline"
            size="icon"
            disabled={(pagina + 1) * 24 >= lista.data.total || lista.isFetching}
            onClick={() => setPagina((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </section>
  );
}
