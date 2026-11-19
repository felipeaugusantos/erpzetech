import { createFileRoute } from "@tanstack/react-router";
import { VacinasPaciente } from "@/components/app/VacinasPaciente";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState } from "@/components/app/PageHeader";
import { useModulosCnae } from "@/lib/cnae";

export const Route = createFileRoute("/_authenticated/clinica-vacinas")({
  validateSearch: (search: Record<string, unknown>) => ({
    agendamento:
      typeof search["agendamento"] === "string" ? (search["agendamento"] as string) : undefined,
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
    aplicar: search["aplicar"] === true || search["aplicar"] === "1" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Vacinas e vermífugos — ERP Ze Tech" },
      { property: "og:title", content: "Vacinas e vermífugos — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Aplicações, lotes, intervalos e próximas doses do paciente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content: "Registro de vacina e vermífugo aplicados, com lote e próxima dose.",
      },
    ],
  }),
  component: VacinasModulo,
});

function VacinasModulo() {
  const modulos = useModulosCnae();
  const { pet, agendamento, aplicar } = Route.useSearch();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  if (!pet)
    return (
      <EmptyState
        title="Nenhum paciente escolhido"
        description="Escolha o paciente na ficha ou na agenda."
      />
    );
  return <VacinasPaciente key={pet} pet={pet} agendamento={agendamento} aplicar={aplicar} />;
}
