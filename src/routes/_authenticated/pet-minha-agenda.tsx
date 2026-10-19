import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Dog, Scissors, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { dateBR, num } from "@/lib/format";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { hojeISO } from "@/lib/financeiro";
import {
  ESPECIES,
  PELAGENS,
  PORTES,
  SITUACOES_AGENDA,
  passoDoProfissional,
  rotulo,
  somarDiasISO,
} from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pet-minha-agenda")({
  head: () => ({
    meta: [
      { title: "Minha agenda — ERP Ze Tech" },
      {
        name: "description",
        content: "Atendimentos do dia do profissional do pet shop: começar e dar como pronto.",
      },
    ],
  }),
  component: MinhaAgenda,
});

type Atendimento = {
  id: string;
  inicio: string;
  fim: string;
  situacao: string;
  taxi_dog: boolean;
  observacoes: string | null;
  tutor: string;
  pet: {
    nome: string;
    especie: string;
    raca: string | null;
    porte: string | null;
    pelagem: string | null;
    peso_kg: number | null;
    castrado: boolean | null;
    alergias: string | null;
    observacoes: string | null;
  };
  servicos: { nome: string; categoria?: string; duracao_min: number }[];
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

function MinhaAgenda() {
  const qc = useQueryClient();
  const hoje = hojeISO();
  const [dia, setDia] = useState(hoje);
  const { data: sessao } = useSessionData();
  const { clinica } = useModulosCnae();
  const prontuario = clinica && (sessao?.roles ?? []).includes("veterinario");

  const { data, isLoading, error } = useQuery({
    queryKey: ["pet-minha-agenda", dia],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pet_minha_agenda", { p_de: dia, p_ate: dia });
      if (error) throw error;
      return (data ?? []) as unknown as Atendimento[];
    },
  });

  const avancar = useMutation({
    mutationFn: async (v: { id: string; para: string }) => {
      const { error } = await supabase.rpc("pet_minha_situacao", { p_id: v.id, p_para: v.para });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pet-minha-agenda"] }),
    onError: (e: Error) => toast.error("Não foi possível atualizar", { description: e.message }),
  });

  const lista = data ?? [];

  return (
    <div>
      <PageHeader
        title="Minha agenda"
        description="Seus atendimentos do dia. Toque em Começar ao pegar o pet e em Pronto ao terminar; a recepção avisa o tutor e faz a cobrança."
      />

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Dia anterior"
          onClick={() => setDia(somarDiasISO(dia, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-40 text-center font-medium">
          {dateBR(dia)}
          {dia === hoje && <span className="block text-xs text-muted-foreground">hoje</span>}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Próximo dia"
          onClick={() => setDia(somarDiasISO(dia, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        {dia !== hoje && (
          <Button variant="ghost" onClick={() => setDia(hoje)}>
            Hoje
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <EmptyState
          title="Não foi possível abrir a agenda"
          description={(error as Error).message}
        />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum atendimento neste dia"
          description="Quando a recepção agendar, aparece aqui."
        />
      ) : (
        <div className="grid gap-3">
          {lista.map((a) => {
            const passo = passoDoProfissional(a.situacao);
            const sit = SITUACOES_AGENDA.find((s) => s.value === a.situacao)?.label ?? a.situacao;
            return (
              <div key={a.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-lg font-semibold">
                      <Dog className="size-5" /> {a.pet.nome}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {hora(a.inicio)} – {hora(a.fim)} · tutor(a) {a.tutor}
                    </div>
                  </div>
                  <Badge variant={a.situacao === "em_atendimento" ? "default" : "secondary"}>
                    {sit}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>{rotulo(ESPECIES, a.pet.especie)}</span>
                  {a.pet.raca && <span>{a.pet.raca}</span>}
                  {a.pet.porte && <span>Porte {rotulo(PORTES, a.pet.porte).toLowerCase()}</span>}
                  {a.pet.pelagem && (
                    <span>Pelo {rotulo(PELAGENS, a.pet.pelagem).toLowerCase()}</span>
                  )}
                  {a.pet.peso_kg ? <span>{num(Number(a.pet.peso_kg), 1)} kg</span> : null}
                  {a.taxi_dog && <span className="font-medium">Táxi dog</span>}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Scissors className="size-4 text-muted-foreground" />
                  {a.servicos.map((s) => (
                    <Badge key={s.nome} variant="outline">
                      {s.nome} · {s.duracao_min} min
                    </Badge>
                  ))}
                </div>

                {a.pet.alergias && (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <TriangleAlert className="size-4 shrink-0" /> Alergia: {a.pet.alergias}
                  </div>
                )}
                {(a.pet.observacoes || a.observacoes) && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {[a.pet.observacoes, a.observacoes].filter(Boolean).join(" · ")}
                  </p>
                )}

                {(passo || (prontuario && a.servicos.some((s) => s.categoria === "consulta"))) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {prontuario && a.servicos.some((s) => s.categoria === "consulta") && (
                      <Button asChild variant="outline">
                        <Link to="/clinica-atendimento" search={{ agendamento: a.id }}>
                          {a.situacao === "pronto" || a.situacao === "retirado"
                            ? "Ver prontuário"
                            : "Abrir prontuário"}
                        </Link>
                      </Button>
                    )}
                    {passo && (
                      <Button
                        onClick={() => avancar.mutate({ id: a.id, para: passo.para })}
                        disabled={avancar.isPending}
                      >
                        {passo.rotulo}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
