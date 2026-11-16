import { createFileRoute } from "@tanstack/react-router";

import { LegalDocumento } from "@/components/app/LegalDocumento";
import { montarTermos } from "@/lib/legal";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — EZRA ERP" },
      {
        name: "description",
        content: "Termos de Uso do EZRA ERP, sistema de gestão como serviço.",
      },
    ],
  }),
  component: () => <LegalDocumento doc={montarTermos()} outro="/privacidade" />,
});
