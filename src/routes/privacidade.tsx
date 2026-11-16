import { createFileRoute } from "@tanstack/react-router";

import { LegalDocumento } from "@/components/app/LegalDocumento";
import { montarPrivacidade } from "@/lib/legal";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — EZRA ERP" },
      { name: "description", content: "Como o EZRA ERP trata dados pessoais, conforme a LGPD." },
    ],
  }),
  component: () => <LegalDocumento doc={montarPrivacidade()} outro="/termos" />,
});
