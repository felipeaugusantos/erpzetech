import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  RefreshCw,
  Search,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import { ESPECIES, rotulo } from "@/lib/pet";
import { useSessionData } from "@/hooks/useSessionData";

type Visita = { id: string; data: string; situacao: string; veterinario: string | null };
type Exame = Visita & { nome: string; origem: "agenda" | "registro" };
type Paciente = {
  id: string;
  nome: string;
  tutor: string | null;
  especie: string;
  raca: string | null;
  visitas: Visita[];
  exames: Exame[];
};
type Lista = { total: number; pacientes: Paciente[] };
const situacoes: Record<string, string> = {
  aberto: "Em aberto",
  fechado: "Concluído",
  cancelado: "Cancelado",
  agendado: "Agendado",
  coletado: "Coletado",
  resultado: "Resultado pronto",
  faltou: "Faltou",
};

export function PacientesPainelClinica({ de, ate }: { de: string; ate: string }) {
  const { data: sessao } = useSessionData();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(0);
  const lista = useQuery({
    queryKey: [
      "clinica-painel-pacientes",
      sessao?.user.id,
      sessao?.profile?.tenant_id,
      de,
      ate,
      termo,
      pagina,
    ],
    enabled: Boolean(sessao?.user.id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_painel_pacientes", {
        p_de: de,
        p_ate: ate,
        p_busca: termo,
        p_pagina: pagina,
      });
      if (error) throw error;
      return data as unknown as Lista;
    },
  });
  return (
    <section
      className="space-y-3 border-t border-border pt-5"
      aria-label="Prontuários dos pacientes"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold">Prontuários dos pacientes</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void lista.refetch()}
          disabled={lista.isFetching}
        >
          <RefreshCw className="size-4" /> Atualizar
        </Button>
      </div>
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(0);
          setTermo(busca.trim());
        }}
      >
        <Input
          aria-label="Buscar paciente no painel"
          placeholder="Nome do paciente ou tutor"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" />
          <span className="hidden sm:inline">Buscar</span>
        </Button>
      </form>
      {lista.isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : lista.error ? (
        <p role="alert" className="text-sm text-destructive">
          {lista.error.message}
        </p>
      ) : !lista.data?.pacientes.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nenhum paciente com visitas ou exames no período{termo ? " para esta busca" : ""}.
        </p>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {lista.data.pacientes.map((p) => (
            <details key={p.id} className="group py-3">
              <summary className="cursor-pointer rounded-sm px-1 py-2 focus-visible:outline focus-visible:outline-ring">
                <span className="ml-1 inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 align-middle">
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{p.nome}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {rotulo(ESPECIES, p.especie)}
                      {p.raca ? ` · ${p.raca}` : ""}
                      {p.tutor ? ` · Tutor(a): ${p.tutor}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      <Stethoscope className="mr-1 size-3" />
                      {p.visitas.length} visitas
                    </Badge>
                    <Badge variant="outline">
                      <FlaskConical className="mr-1 size-3" />
                      {p.exames.length} exames
                    </Badge>
                  </span>
                </span>
              </summary>
              <div className="mt-3 grid gap-5 px-2 pb-2 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Stethoscope className="size-4 text-primary" />
                    Visitas no período
                  </h3>
                  {!p.visitas.length ? (
                    <p className="text-sm text-muted-foreground">Nenhuma visita no período.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {p.visitas.map((v) => (
                        <li
                          key={v.id}
                          className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
                        >
                          <div>
                            <span>{dateTimeBR(v.data)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {v.veterinario ?? "Veterinário não informado"}
                            </span>
                          </div>
                          <Badge variant="outline">{situacoes[v.situacao] ?? v.situacao}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <FlaskConical className="size-4 text-primary" />
                    Exames no período
                  </h3>
                  {!p.exames.length ? (
                    <p className="text-sm text-muted-foreground">Nenhum exame no período.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {p.exames.map((e) => (
                        <li
                          key={`${e.origem}-${e.id}`}
                          className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
                        >
                          <div className="min-w-0 break-words">
                            <span className="font-medium">{e.nome}</span>
                            <span className="block text-xs text-muted-foreground">
                              {dateTimeBR(e.data)} · {e.origem === "agenda" ? "Agenda" : "Registro"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {e.veterinario ?? "Veterinário não informado"}
                            </span>
                          </div>
                          <Badge
                            variant={
                              e.situacao === "cancelado" || e.situacao === "faltou"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {situacoes[e.situacao] ?? e.situacao}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
      {!!lista.data?.total && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {lista.data.total} pacientes · Página {pagina + 1} de {Math.ceil(lista.data.total / 20)}
          </span>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="outline"
              aria-label="Página anterior"
              disabled={pagina === 0 || lista.isFetching}
              onClick={() => setPagina((n) => n - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label="Próxima página"
              disabled={(pagina + 1) * 20 >= lista.data.total || lista.isFetching}
              onClick={() => setPagina((n) => n + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
