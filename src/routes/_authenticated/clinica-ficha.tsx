import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { useCamposPet, useValoresCamposPet } from "@/components/app/CamposPersonalizados";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import type { AtendimentoClinico, PetClinico } from "@/lib/clinica";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import { camposAtivos, valorLegivel } from "@/lib/pet-campos";
import { ESPECIES, PELAGENS, PORTES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-ficha")({
  validateSearch: (search: Record<string, unknown>) => ({
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Ficha clínica — EZRA ERP" },
      { name: "description", content: "Ficha clínica do paciente para imprimir." },
    ],
  }),
  component: FichaModulo,
});

type Ficha = {
  pet: PetClinico & {
    id: string;
    observacoes: string | null;
    microchip: string | null;
    foto: string | null;
  };
  tutor: string;
  atendimentos: AtendimentoClinico[];
};

function FichaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <FichaImpressa />;
}

function FichaImpressa() {
  const { pet } = Route.useSearch();
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-ficha", pet],
    enabled: Boolean(pet),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_historico", { p_pet_id: pet as string });
      if (error) throw error;
      return data as unknown as Ficha;
    },
  });

  const campos = useCamposPet();
  const valores = useValoresCamposPet(pet);

  if (!pet)
    return (
      <EmptyState
        title="Nenhum paciente escolhido"
        description="Abra a ficha clínica pelo prontuário do paciente."
        action={
          <Button asChild variant="outline">
            <Link to="/clinica-prontuario" search={{ pet: undefined }}>
              Ir para o Prontuário
            </Link>
          </Button>
        }
      />
    );
  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !data)
    return (
      <EmptyState
        title="Não foi possível abrir a ficha"
        description={(error as Error | null)?.message ?? "Paciente não encontrado."}
      />
    );

  const p = data.pet;
  const extras = camposAtivos(campos.data ?? [], "pet").filter((c) => valores.data?.[c.id]);
  // do mais antigo para o mais novo, como uma ficha de papel
  const atendimentos = [...data.atendimentos].sort((a, b) =>
    a.aberto_em.localeCompare(b.aberto_em),
  );

  return (
    <div>
      <PageHeader
        title={`Ficha clínica — ${p.nome}`}
        description={`Tutor(a) ${data.tutor}`}
        actions={
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        }
      />
      <div
        id="documento-impresso"
        className="mx-auto w-full max-w-[800px] bg-card p-8 text-sm leading-relaxed"
      >
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-3">
          <div>
            <p className="font-display text-lg font-bold uppercase">Ficha clínica</p>
            <p className="text-xs text-muted-foreground">
              Impressa em {dateTimeBR(new Date().toISOString())}
            </p>
          </div>
          {p.foto && (
            <img
              src={p.foto}
              alt={`Foto de ${p.nome}`}
              className="size-24 rounded-md border border-border object-cover"
            />
          )}
        </div>

        <div className="mb-4 grid gap-1 rounded-md border border-border p-3 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Paciente: </span>
            <strong>{p.nome}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Tutor(a): </span>
            {data.tutor}
          </p>
          <p>
            <span className="text-muted-foreground">Espécie / raça: </span>
            {rotulo(ESPECIES, p.especie)}
            {p.raca ? ` · ${p.raca}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Sexo / idade: </span>
            {p.sexo === "macho" ? "Macho" : p.sexo === "femea" ? "Fêmea" : "—"}
            {p.nascimento ? ` · ${idadeDoPet(p.nascimento)} (${dateBR(p.nascimento)})` : ""}
            {p.castrado !== null ? ` · ${p.castrado ? "Castrado" : "Não castrado"}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Porte / pelagem: </span>
            {[rotulo(PORTES, p.porte), rotulo(PELAGENS, p.pelagem)].filter(Boolean).join(" · ") ||
              "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Peso / microchip: </span>
            {p.peso_kg ? `${num(Number(p.peso_kg), 2)} kg` : "—"}
            {p.microchip ? ` · ${p.microchip}` : ""}
          </p>
          {p.alergias && (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Alergias: </span>
              <strong>{p.alergias}</strong>
            </p>
          )}
          {extras.map((c) => (
            <p key={c.id}>
              <span className="text-muted-foreground">{c.nome}: </span>
              {valorLegivel(c, valores.data?.[c.id] ?? "")}
            </p>
          ))}
          {p.observacoes && (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Observações: </span>
              {p.observacoes}
            </p>
          )}
        </div>

        {atendimentos.length === 0 ? (
          <p className="text-muted-foreground">Sem atendimentos registrados.</p>
        ) : (
          atendimentos.map((a) => (
            <div key={a.id} className="mb-4 break-inside-avoid border-t border-border pt-3">
              <p className="font-semibold">
                {dateTimeBR(a.aberto_em)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {a.veterinario.nome} · CRMV {a.veterinario.crmv}/{a.veterinario.crmv_uf}
                  {a.situacao === "aberto" ? " · em atendimento" : ""}
                </span>
              </p>
              <Linha r="Queixa" v={a.queixa} />
              <Linha r="Anamnese" v={a.anamnese} />
              <Linha
                r="Sinais"
                v={[
                  a.peso_kg ? `${num(Number(a.peso_kg), 2)} kg` : null,
                  a.temperatura_c ? `${num(Number(a.temperatura_c), 1)} °C` : null,
                  a.freq_cardiaca ? `${a.freq_cardiaca} bpm` : null,
                  a.freq_respiratoria ? `${a.freq_respiratoria} mpm` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Linha r="Exame físico" v={a.exame_fisico} />
              <Linha r="Diagnóstico" v={a.diagnostico} />
              <Linha r="Conduta" v={a.conduta} />
              <Linha r="Retorno" v={a.retorno_em ? dateBR(a.retorno_em) : null} />
              <Linha r="Observações" v={a.observacoes} />
              {a.adendos.map((d) => (
                <p key={d.id} className="mt-1 border-l-4 border-border pl-2">
                  <span className="whitespace-pre-wrap">{d.texto}</span>
                  <span className="block text-xs text-muted-foreground">
                    Adendo de {d.veterinario} (CRMV {d.crmv}/{d.crmv_uf}) em{" "}
                    {dateTimeBR(d.created_at)}
                  </span>
                </p>
              ))}
            </div>
          ))
        )}

        <p className="mt-8 text-[11px] text-muted-foreground">
          Documento do prontuário do paciente, impresso pelo EZRA ERP sem assinatura digital. Contém
          informação sigilosa: guarde com o tutor ou na clínica.
        </p>
      </div>
    </div>
  );
}

function Linha({ r, v }: { r: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <p className="whitespace-pre-wrap">
      <span className="text-muted-foreground">{r}: </span>
      {v}
    </p>
  );
}
