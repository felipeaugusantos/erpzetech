import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { evolucaoDoPeso, type AtendimentoClinico, type PetClinico } from "@/lib/clinica";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import { ESPECIES, PELAGENS, PORTES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-prontuario")({
  validateSearch: (search: Record<string, unknown>) => ({
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prontuário — ERP Ze Tech" },
      {
        name: "description",
        content: "Ficha do paciente e histórico de atendimentos da clínica.",
      },
    ],
  }),
  component: ProntuarioModulo,
});

type Paciente = { id: string; nome: string; especie: string; raca: string | null; tutor: string };
type Ficha = {
  pet: PetClinico & { id: string; observacoes: string | null };
  tutor: string;
  atendimentos: AtendimentoClinico[];
};

function ProntuarioModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Prontuario />;
}

function Prontuario() {
  const { pet } = Route.useSearch();
  const navegar = useNavigate();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");

  const achados = useQuery({
    queryKey: ["clinica-pacientes", termo],
    enabled: termo.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes", { p_busca: termo });
      if (error) throw error;
      return (data ?? []) as unknown as Paciente[];
    },
  });

  return (
    <div>
      <PageHeader
        title="Prontuário"
        description="Ficha e histórico do paciente. Só o veterinário vê o texto clínico; cada abertura de ficha fica registrada."
      />

      <form
        className="mb-4 flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTermo(busca.trim());
        }}
      >
        <Input
          aria-label="Buscar paciente"
          placeholder="Nome do pet ou do tutor"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busca.trim().length < 2}>
          <Search className="size-4" /> Buscar
        </Button>
      </form>

      {termo && (
        <div className="mb-6">
          {achados.isLoading ? (
            <div className="panel h-16 animate-pulse" />
          ) : achados.error ? (
            <p className="text-sm text-destructive">{(achados.error as Error).message}</p>
          ) : (achados.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum paciente encontrado.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {achados.data?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="panel p-3 text-left hover:bg-muted"
                  onClick={() => navegar({ to: "/clinica-prontuario", search: { pet: p.id } })}
                >
                  <span className="font-medium">{p.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {rotulo(ESPECIES, p.especie)}
                    {p.raca ? ` · ${p.raca}` : ""} · tutor(a) {p.tutor}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pet ? (
        <FichaDoPaciente petId={pet} />
      ) : (
        !termo && (
          <EmptyState
            title="Escolha um paciente"
            description="Busque pelo nome do pet ou do tutor, ou abra o prontuário pela Minha agenda."
          />
        )
      )}
    </div>
  );
}

function FichaDoPaciente({ petId }: { petId: string }) {
  const qc = useQueryClient();
  const [alergias, setAlergias] = useState<string | null>(null);
  const [adendo, setAdendo] = useState<{ id: string; texto: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-historico", petId],
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_historico", { p_pet_id: petId });
      if (error) throw error;
      return data as unknown as Ficha;
    },
  });

  const salvarAlergias = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_pet_alergias", {
        p_pet_id: petId,
        p_alergias: alergias ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alergia atualizada");
      setAlergias(null);
      void qc.invalidateQueries({ queryKey: ["clinica-historico", petId] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const criarAdendo = useMutation({
    mutationFn: async () => {
      if (!adendo) return;
      const { error } = await supabase.rpc("clinica_adendo_criar", {
        p_atendimento_id: adendo.id,
        p_texto: adendo.texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Adendo registrado");
      setAdendo(null);
      void qc.invalidateQueries({ queryKey: ["clinica-historico", petId] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !data)
    return (
      <EmptyState
        title="Não foi possível abrir a ficha"
        description={(error as Error | null)?.message ?? "Paciente não encontrado."}
      />
    );

  const p = data.pet;
  const evolucao = evolucaoDoPeso(data.atendimentos);

  return (
    <div className="grid gap-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">{p.nome}</h2>
          <span className="text-sm text-muted-foreground">Tutor(a) {data.tutor}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>{rotulo(ESPECIES, p.especie)}</span>
          {p.raca && <span>{p.raca}</span>}
          {p.porte && <span>Porte {rotulo(PORTES, p.porte).toLowerCase()}</span>}
          {p.pelagem && <span>Pelo {rotulo(PELAGENS, p.pelagem).toLowerCase()}</span>}
          {p.nascimento && <span>{idadeDoPet(p.nascimento)}</span>}
          {p.castrado !== null && <span>{p.castrado ? "Castrado" : "Não castrado"}</span>}
        </div>

        <div className="mt-3">
          <Label htmlFor="f-alergia">Alergias</Label>
          <div className="flex gap-2">
            <Input
              id="f-alergia"
              value={alergias ?? p.alergias ?? ""}
              onChange={(e) => setAlergias(e.target.value)}
              placeholder="Nenhuma informada"
            />
            <Button
              variant="outline"
              disabled={alergias === null || salvarAlergias.isPending}
              onClick={() => salvarAlergias.mutate()}
            >
              Salvar
            </Button>
          </div>
          {p.alergias && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-800">
              <TriangleAlert className="size-3" /> Esta alergia aparece na agenda de banho e tosa.
            </p>
          )}
        </div>

        {evolucao.length > 1 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Peso nas consultas: {evolucao.map((e) => `${num(e.peso, 1)} kg`).join(" → ")}
          </p>
        )}
      </div>

      <h3 className="font-display text-base font-semibold">Atendimentos</h3>
      {data.atendimentos.length === 0 ? (
        <EmptyState
          title="Sem atendimentos"
          description="O primeiro aparece aqui depois da consulta."
        />
      ) : (
        data.atendimentos.map((a) => (
          <div key={a.id} className="panel p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{dateTimeBR(a.aberto_em)}</strong>
              <span className="text-muted-foreground">
                {a.veterinario.nome} · CRMV {a.veterinario.crmv}/{a.veterinario.crmv_uf}
              </span>
              <Badge variant={a.situacao === "fechado" ? "secondary" : "default"}>
                {a.situacao === "fechado" ? "Fechado" : "Em atendimento"}
              </Badge>
            </div>
            <dl className="mt-2 grid gap-1">
              <Linha rotulo="Queixa" valor={a.queixa} />
              <Linha rotulo="Anamnese" valor={a.anamnese} />
              <Linha
                rotulo="Sinais"
                valor={[
                  a.peso_kg ? `${num(Number(a.peso_kg), 2)} kg` : null,
                  a.temperatura_c ? `${num(Number(a.temperatura_c), 1)} °C` : null,
                  a.freq_cardiaca ? `${a.freq_cardiaca} bpm` : null,
                  a.freq_respiratoria ? `${a.freq_respiratoria} mpm` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Linha rotulo="Exame físico" valor={a.exame_fisico} />
              <Linha rotulo="Diagnóstico" valor={a.diagnostico} />
              <Linha rotulo="Conduta" valor={a.conduta} />
              <Linha rotulo="Retorno" valor={a.retorno_em ? dateBR(a.retorno_em) : null} />
              <Linha rotulo="Observações" valor={a.observacoes} />
            </dl>

            {a.adendos.map((d) => (
              <div key={d.id} className="mt-3 rounded-md border-l-4 border-primary bg-muted/50 p-3">
                <p className="whitespace-pre-wrap">{d.texto}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Adendo de {d.veterinario} (CRMV {d.crmv}/{d.crmv_uf}) em{" "}
                  {dateTimeBR(d.created_at)}
                </p>
              </div>
            ))}

            {a.situacao === "fechado" &&
              (adendo?.id === a.id ? (
                <div className="mt-3 grid gap-2">
                  <Textarea
                    aria-label="Texto do adendo"
                    rows={3}
                    value={adendo.texto}
                    onChange={(e) => setAdendo({ id: a.id, texto: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => criarAdendo.mutate()}
                      disabled={criarAdendo.isPending || !adendo.texto.trim()}
                    >
                      Registrar adendo
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAdendo(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setAdendo({ id: a.id, texto: "" })}
                >
                  Adicionar adendo
                </Button>
              ))}
          </div>
        ))
      )}
    </div>
  );
}

function Linha({ rotulo: r, valor }: { rotulo: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">{r}</dt>
      <dd className="whitespace-pre-wrap">{valor}</dd>
    </div>
  );
}
