import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Syringe } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useModulosCnae } from "@/lib/cnae";
import { hojeISO } from "@/lib/financeiro";
import { CarteirinhaVacinacao } from "@/components/app/CarteirinhaVacinacao";
import { type CartaoVacinacao } from "@/lib/vacinas";

export const Route = createFileRoute("/_authenticated/clinica-cartao")({
  validateSearch: (search: Record<string, unknown>) => ({
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Carteirinha de vacinação — ERP Ze Tech" },
      { property: "og:title", content: "Carteirinha de vacinação — ERP Ze Tech" },
      {
        property: "og:description",
        content:
          "Carteirinha digital e impressa do paciente, com doses aplicadas e próximas datas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
        p_pet_id: pet ?? "",
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
        title="Carteirinha de vacinação"
        description={`${c.pet.nome} · tutor(a) ${c.tutor}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/clinica-prontuario" search={{ pet: c.pet.id }}>
                <ArrowLeft className="size-4" /> Prontuário
              </Link>
            </Button>
            {veterinario && (
              <Button asChild variant="outline">
                <Link to="/clinica-prontuario" search={{ pet: c.pet.id }}>
                  <Syringe className="size-4" /> Aplicar no prontuário
                </Link>
              </Button>
            )}
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Imprimir / salvar PDF
            </Button>
          </>
        }
      />

      <CarteirinhaVacinacao cartao={c} hoje={hoje} />
    </div>
  );
}
