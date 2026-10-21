import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  TIPOS_DOCUMENTO,
  dataPorExtenso,
  numeroDoDocumento,
  type DocumentoClinico,
} from "@/lib/documentos-clinica";
import { dateBR } from "@/lib/format";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-documento")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search["id"] === "string" ? (search["id"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Documento da clínica — ERP Ze Tech" },
      {
        name: "description",
        content: "Receita, atestado, termo ou solicitação de exames para imprimir.",
      },
    ],
  }),
  component: DocumentoModulo,
});

function DocumentoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Documento />;
}

const SEXOS: Record<string, string> = { macho: "Macho", femea: "Fêmea" };

function Documento() {
  const { id } = Route.useSearch();
  const {
    data: d,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["clinica-documento", id],
    enabled: Boolean(id),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_documento_obter", { p_id: id as string });
      if (error) throw error;
      return data as unknown as DocumentoClinico;
    },
  });

  if (!id)
    return (
      <EmptyState
        title="Nenhum documento escolhido"
        description="Abra o documento pela ficha do paciente ou pelo atendimento."
        action={
          <Button asChild variant="outline">
            <Link to="/clinica-prontuario">Ir para o Prontuário</Link>
          </Button>
        }
      />
    );
  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !d)
    return (
      <EmptyState
        title="Não foi possível abrir o documento"
        description={(error as Error | null)?.message ?? "Documento não encontrado."}
      />
    );

  const c = d.clinica;
  const endereco = c
    ? [
        [c.endereco, c.numero].filter(Boolean).join(", "),
        c.bairro,
        [c.cidade, c.estado].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" — ")
    : "";
  const tutorDoc = d.tutor.cpf ?? d.tutor.cnpj;
  const cancelado = d.situacao === "cancelado";

  return (
    <div>
      <PageHeader
        title={`${TIPOS_DOCUMENTO[d.tipo].rotulo} nº ${numeroDoDocumento(d)}`}
        description={`${d.pet.nome} · tutor(a) ${d.tutor.nome}`}
        actions={
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        }
      />

      <div
        id="documento-impresso"
        className="relative mx-auto w-full max-w-[800px] bg-card p-8 text-sm leading-relaxed"
      >
        {cancelado && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-bold uppercase text-destructive/20 -rotate-12">
            Cancelado
          </p>
        )}

        <div className="mb-4 border-b border-border pb-3">
          <p className="font-display text-lg font-bold uppercase">
            {c?.nome ?? "Clínica veterinária"}
          </p>
          {c?.razao_social && c.razao_social !== c.nome && (
            <p className="text-xs text-muted-foreground">{c.razao_social}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {[c?.cnpj ? `CNPJ ${c.cnpj}` : null, c?.telefone, c?.email].filter(Boolean).join(" · ")}
          </p>
          {endereco && <p className="text-xs text-muted-foreground">{endereco}</p>}
        </div>

        <div className="mb-4 flex items-baseline justify-between">
          <p className="font-display text-base font-bold uppercase">
            {TIPOS_DOCUMENTO[d.tipo].impresso}
          </p>
          <p className="text-xs text-muted-foreground">nº {numeroDoDocumento(d)}</p>
        </div>
        {d.titulo !== TIPOS_DOCUMENTO[d.tipo].rotulo && (
          <p className="mb-3 font-semibold">{d.titulo}</p>
        )}

        <div className="mb-4 grid gap-1 rounded-md border border-border p-3 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Paciente: </span>
            <strong>{d.pet.nome}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Tutor(a): </span>
            {d.tutor.nome}
            {tutorDoc ? ` · ${tutorDoc}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Espécie / raça: </span>
            {rotulo(ESPECIES, d.pet.especie)}
            {d.pet.raca ? ` · ${d.pet.raca}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Sexo / idade: </span>
            {d.pet.sexo ? (SEXOS[d.pet.sexo] ?? d.pet.sexo) : "—"}
            {d.pet.nascimento ? ` · ${idadeDoPet(d.pet.nascimento)}` : ""}
            {d.pet.peso_kg ? ` · ${String(d.pet.peso_kg).replace(".", ",")} kg` : ""}
          </p>
        </div>

        {d.tipo === "receita" && (
          <ol className="mb-4 list-decimal space-y-3 pl-5">
            {d.itens.map((i, k) => (
              <li key={k}>
                <p className="font-semibold">
                  {i.medicamento}
                  {i.quantidade ? <span className="font-normal"> — {i.quantidade}</span> : null}
                </p>
                <p>{i.posologia}</p>
                {(i.via || i.duracao) && (
                  <p className="text-xs text-muted-foreground">
                    {[i.via ? `Via ${i.via}` : null, i.duracao ? `Duração: ${i.duracao}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}

        {d.tipo === "solicitacao_exame" && (
          <ul className="mb-4 space-y-1">
            {d.itens.map((i, k) => (
              <li key={k}>
                ☐ <strong>{i.exame}</strong>
                {i.observacao ? (
                  <span className="text-muted-foreground"> — {i.observacao}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {d.corpo && (
          <div className="mb-4">
            {(d.tipo === "receita" || d.tipo === "solicitacao_exame") && (
              <p className="font-semibold">
                {d.tipo === "receita" ? "Orientações" : "Indicação clínica"}
              </p>
            )}
            <p className="whitespace-pre-wrap">{d.corpo}</p>
          </div>
        )}

        <p className="mt-6">
          {c?.cidade ? `${c.cidade}, ` : ""}
          {dataPorExtenso(d.emitido_em)}.
        </p>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <div className="border-t border-foreground pt-1 text-center">
            <p className="font-medium">{d.veterinario.nome}</p>
            <p className="text-xs">
              Médico(a) veterinário(a) · CRMV {d.veterinario.crmv}/{d.veterinario.crmv_uf}
            </p>
          </div>
          {d.tipo === "termo" && (
            <div className="border-t border-foreground pt-1 text-center">
              <p className="font-medium">{d.tutor.nome}</p>
              <p className="text-xs">Tutor(a){tutorDoc ? ` · ${tutorDoc}` : ""}</p>
            </div>
          )}
        </div>

        <p className="mt-8 text-[11px] text-muted-foreground">
          Emitido em {dateBR(d.emitido_em)} pelo ERP Ze Tech, sem assinatura digital: vale com a
          assinatura do veterinário.
          {cancelado ? ` CANCELADO em ${dateBR(d.cancelado_em)}: ${d.cancelado_motivo ?? ""}.` : ""}
        </p>
      </div>
    </div>
  );
}
