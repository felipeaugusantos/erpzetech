import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateTimeBR, num } from "@/lib/format";
import {
  descricaoDaFrequencia,
  rotuloSituacaoInternacao,
  rotuloTipoOcorrencia,
  type FichaInternacao,
} from "@/lib/internacao";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-internacao-historico")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search["id"] === "string" ? (search["id"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Histórico da internação — EZRA ERP" },
      { name: "description", content: "Histórico completo da internação para imprimir." },
    ],
  }),
  component: HistoricoModulo,
});

const SITUACAO_DOSE: Record<string, string> = {
  pendente: "pendente",
  executada: "feita",
  nao_executada: "não feita",
  cancelada: "cancelada",
};

function HistoricoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Historico />;
}

function Historico() {
  const { id } = Route.useSearch();
  const {
    data: f,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["clinica-internacao-historico", id],
    enabled: Boolean(id),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_internacao_obter", {
        p_id: id as string,
      });
      if (error) throw error;
      return data as unknown as FichaInternacao;
    },
  });

  if (!id)
    return (
      <EmptyState
        title="Nenhuma internação escolhida"
        description="Abra o histórico pela ficha da internação."
        action={
          <Button asChild variant="outline">
            <Link to="/clinica-internacao">Ir para a Internação</Link>
          </Button>
        }
      />
    );
  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !f)
    return (
      <EmptyState
        title="Não foi possível abrir o histórico"
        description={(error as Error | null)?.message ?? "Internação não encontrada."}
      />
    );

  const i = f.internacao;
  const itensValidos = f.itens.filter((x) => !x.cancelado_em);

  return (
    <div>
      <PageHeader
        title={`Histórico da internação — ${f.pet.nome}`}
        description={`Tutor(a) ${f.tutor}`}
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
        <div className="mb-4 border-b border-border pb-3">
          <p className="font-display text-lg font-bold uppercase">Histórico da internação</p>
          <p className="text-xs text-muted-foreground">
            {rotuloSituacaoInternacao(i.situacao)} · admissão {dateTimeBR(i.admitido_em)}
            {i.encerrado_em ? ` · encerrada em ${dateTimeBR(i.encerrado_em)}` : ""} · box{" "}
            {i.box.nome}
          </p>
        </div>

        <div className="mb-4 grid gap-1 rounded-md border border-border p-3 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Paciente: </span>
            <strong>{f.pet.nome}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Tutor(a): </span>
            {f.tutor}
            {f.tutor_telefone ? ` · ${f.tutor_telefone}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Espécie / raça: </span>
            {rotulo(ESPECIES, f.pet.especie)}
            {f.pet.raca ? ` · ${f.pet.raca}` : ""}
            {f.pet.nascimento ? ` · ${idadeDoPet(f.pet.nascimento)}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Veterinário(a): </span>
            {i.veterinario.nome} (CRMV {i.veterinario.crmv}/{i.veterinario.crmv_uf})
          </p>
          {f.pet.alergias && (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Alergias: </span>
              <strong>{f.pet.alergias}</strong>
            </p>
          )}
          {i.motivo && (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Motivo: </span>
              {i.motivo}
              {i.observacoes ? ` — ${i.observacoes}` : ""}
            </p>
          )}
        </div>

        <Secao titulo="Prescrições e doses">
          {f.prescricoes.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma prescrição.</p>
          ) : (
            f.prescricoes.map((p) => (
              <div key={p.id} className="mb-2 break-inside-avoid">
                <p>
                  <strong>{p.medicamento}</strong> · {p.dose}
                  {p.via ? ` · ${p.via}` : ""} · {descricaoDaFrequencia(p)}
                  {p.situacao === "suspensa" ? ` · SUSPENSA (${p.suspensa_motivo})` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.veterinario} (CRMV {p.crmv}/{p.crmv_uf}) · {dateTimeBR(p.inicio)}
                  {p.observacao ? ` · ${p.observacao}` : ""}
                </p>
                <ul className="mt-1 grid gap-x-4 text-xs sm:grid-cols-2">
                  {p.execucoes.map((e) => (
                    <li key={e.id}>
                      {dateTimeBR(e.previsto_em)} — {SITUACAO_DOSE[e.situacao]}
                      {e.executado_por ? ` por ${e.executado_por}` : ""}
                      {e.observacao ? ` (${e.observacao})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Secao>

        {f.relatos && (
          <Secao titulo="Relatos médicos">
            {f.relatos.length === 0 ? (
              <p className="text-muted-foreground">Nenhum relato.</p>
            ) : (
              [...f.relatos].reverse().map((r) => (
                <p key={r.id} className="mb-2 whitespace-pre-wrap break-inside-avoid">
                  {r.texto}
                  <span className="block text-xs text-muted-foreground">
                    {r.veterinario} (CRMV {r.crmv}/{r.crmv_uf}) · {dateTimeBR(r.created_at)}
                  </span>
                </p>
              ))
            )}
          </Secao>
        )}

        <Secao titulo="Ocorrências">
          {f.ocorrencias.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma ocorrência.</p>
          ) : (
            <ul className="space-y-1">
              {[...f.ocorrencias].reverse().map((o) => (
                <li key={o.id}>
                  {dateTimeBR(o.created_at)} · {rotuloTipoOcorrencia(o.tipo)} — {o.texto}{" "}
                  <span className="text-xs text-muted-foreground">({o.profissional})</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>

        <Secao titulo="Pesagens">
          {f.pesagens.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma pesagem.</p>
          ) : (
            <p>
              {[...f.pesagens]
                .reverse()
                .map((p) => `${num(Number(p.peso_kg), 2)} kg (${dateTimeBR(p.created_at)})`)
                .join(" → ")}
            </p>
          )}
        </Secao>

        <Secao titulo="Produtos e serviços">
          {itensValidos.length === 0 ? (
            <p className="text-muted-foreground">Nenhum item.</p>
          ) : (
            <>
              <ul className="space-y-0.5">
                {itensValidos.map((x) => (
                  <li key={x.id}>
                    {x.descricao} · {String(x.quantidade).replace(".", ",")} ×{" "}
                    {brl(Number(x.preco_unitario))} = {brl(Number(x.total))}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-right font-bold">Total {brl(Number(f.total_itens))}</p>
            </>
          )}
        </Secao>

        {i.encerrado_em && i.encerramento_texto && (
          <Secao titulo={i.situacao === "obito" ? "Óbito" : "Alta"}>
            <p className="whitespace-pre-wrap">
              {dateTimeBR(i.encerrado_em)} — {i.encerramento_texto}
            </p>
          </Secao>
        )}

        <p className="mt-8 text-[11px] text-muted-foreground">
          Impresso pelo EZRA ERP sem assinatura digital. Contém informação sigilosa do prontuário.
        </p>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 border-b border-border font-display text-sm font-bold uppercase">
        {titulo}
      </h3>
      {children}
    </section>
  );
}
