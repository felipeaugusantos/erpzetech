import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { dateBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import { ESPECIES, idadeDoPet, rotulo } from "@/lib/pet";
import { rotuloDose, situacaoDaDose, type CartaoVacinacao } from "@/lib/vacinas";

export const Route = createFileRoute("/_authenticated/clinica-cartao")({
  validateSearch: (search: Record<string, unknown>) => ({
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Cartão de vacinação — EZRA ERP" },
      {
        name: "description",
        content: "Cartão de vacinação do pet para imprimir: aplicações, lotes e próximas doses.",
      },
    ],
  }),
  component: CartaoModulo,
});

function CartaoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Cartao />;
}

function Cartao() {
  const { pet } = Route.useSearch();
  const { data: sessao } = useSessionData();
  const veterinario = (sessao?.roles ?? []).includes("veterinario");
  const hoje = hojeISO();
  const {
    data: c,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["clinica-cartao", pet],
    enabled: Boolean(pet),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_cartao_vacinacao", {
        p_pet_id: pet as string,
      });
      if (error) throw error;
      return data as unknown as CartaoVacinacao;
    },
  });

  if (!pet)
    return (
      <EmptyState
        title="Nenhum paciente escolhido"
        description="Abra o cartão pela lista de pets ou pela ficha do paciente."
        action={
          <Button asChild variant="outline">
            <Link to="/pets">Ir para Pets e tutores</Link>
          </Button>
        }
      />
    );
  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !c)
    return (
      <EmptyState
        title="Não foi possível abrir o cartão"
        description={(error as Error | null)?.message ?? "Paciente não encontrado."}
      />
    );

  return (
    <div>
      <PageHeader
        title="Cartão de vacinação"
        description={`${c.pet.nome} · tutor(a) ${c.tutor}`}
        actions={
          <>
            {veterinario && (
              <Button asChild variant="outline">
                <Link to="/clinica-vacinas" search={{ pet, agendamento: undefined }}>
                  Registrar vacina
                </Link>
              </Button>
            )}
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Imprimir
            </Button>
          </>
        }
      />

      <div id="documento-impresso" className="mx-auto w-full max-w-[800px] bg-card p-6 text-sm">
        <div className="mb-4 border-b border-border pb-3">
          <p className="font-display text-lg font-bold uppercase">
            {c.clinica ?? "Clínica veterinária"}
          </p>
          <p className="text-muted-foreground">Cartão de vacinação e vermifugação</p>
        </div>

        <div className="mb-4 grid gap-1 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Pet: </span>
            <strong>{c.pet.nome}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Tutor(a): </span>
            {c.tutor}
          </p>
          <p>
            <span className="text-muted-foreground">Espécie / raça: </span>
            {rotulo(ESPECIES, c.pet.especie)}
            {c.pet.raca ? ` · ${c.pet.raca}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Nascimento: </span>
            {c.pet.nascimento
              ? `${dateBR(c.pet.nascimento)} (${idadeDoPet(c.pet.nascimento)})`
              : "—"}
          </p>
        </div>

        {c.proximas.length > 0 && (
          <div className="mb-4 rounded-md border border-border p-3">
            <p className="mb-1 font-semibold">Próximas doses</p>
            <ul className="space-y-0.5">
              {c.proximas.map((p) => {
                const sit = situacaoDaDose(p.proxima_dose_em, hoje);
                return (
                  <li key={`${p.nome}-${p.proxima_dose_em}`}>
                    {p.nome} — <strong>{dateBR(p.proxima_dose_em)}</strong>
                    {sit === "atrasada" && <span className="text-destructive"> (atrasada)</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-border text-left">
              <th className="py-1">Data</th>
              <th className="py-1">Aplicação</th>
              <th className="py-1">Lote / validade</th>
              <th className="py-1">Responsável</th>
              <th className="py-1">Próxima</th>
            </tr>
          </thead>
          <tbody>
            {c.aplicacoes.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-muted-foreground">
                  Nenhuma aplicação registrada.
                </td>
              </tr>
            )}
            {c.aplicacoes.map((a) => (
              <tr key={a.id} className="border-b border-border/60 align-top">
                <td className="py-1">{dateBR(a.aplicada_em)}</td>
                <td className="py-1">
                  <span className="block font-medium">{a.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {rotuloDose(a.dose_tipo, a.dose_numero)}
                  </span>
                </td>
                <td className="py-1">
                  {a.lote ?? "—"}
                  {a.validade_lote && (
                    <span className="block text-xs text-muted-foreground">
                      val. {dateBR(a.validade_lote)}
                    </span>
                  )}
                </td>
                <td className="py-1">
                  {a.origem === "outro_local" ? (
                    <span className="text-xs">Aplicada em outro local ({a.informado_por})</span>
                  ) : (
                    <>
                      {a.aplicador ?? a.veterinario}
                      <span className="block text-xs text-muted-foreground">
                        Resp.: {a.veterinario} · CRMV {a.crmv}/{a.crmv_uf}
                      </span>
                    </>
                  )}
                </td>
                <td className="py-1">{a.proxima_dose_em ? dateBR(a.proxima_dose_em) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-6 text-xs text-muted-foreground">
          Emitido em {dateBR(hoje)}. Este cartão registra apenas vacinas e vermífugos; não traz
          informações do prontuário.
        </p>
      </div>
    </div>
  );
}
