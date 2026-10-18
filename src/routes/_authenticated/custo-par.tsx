import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/PageHeader";
import { RentabilidadeChinelo } from "@/components/app/RentabilidadeChinelo";

export const Route = createFileRoute("/_authenticated/custo-par")({
  head: () => ({
    meta: [
      { title: "Custo por par — ERP Ze Tech" },
      {
        name: "description",
        content: "Calcule o custo real de cada par de chinelo: tira, solado e folha impressa.",
      },
      { property: "og:title", content: "Custo por par — ERP Ze Tech" },
      {
        property: "og:description",
        content:
          "Custo da tira, do solado e da folha impressa em cada par, com margem sobre o preço.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustoPar,
});

function CustoPar() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Custo por par"
        description="Chinelo + sacolinha voil. O custo dos materiais vem do cadastro do produto."
      />
      <RentabilidadeChinelo />
    </div>
  );
}
