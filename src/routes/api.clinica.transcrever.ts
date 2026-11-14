import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/clinica/transcrever")({
  server: { handlers: { POST: async ({ request }) => {
    const { transcreverConsulta } = await import("@/lib/consulta-audio.server");
    return transcreverConsulta(request);
  } } },
});