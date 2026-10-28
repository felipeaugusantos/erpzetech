import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Rotina de envio do WhatsApp: POST /api/public/hooks/whatsapp-despachar (a cada minuto, com o segredo do cron).
// Enfileira os avisos automáticos, reserva o que está na hora e envia pelo Evolution (ver despachar em whatsapp-despacho.ts).
export const Route = createFileRoute("/api/public/hooks/whatsapp-despachar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const negado = await authenticateCronRequest(request);
        if (negado) return negado;
        try {
          const { rodadaDeEnvio } = await import("@/lib/whatsapp.server");
          const relatorio = await rodadaDeEnvio();
          return Response.json(relatorio);
        } catch (e) {
          console.error("[whatsapp] falha na rodada de envio", e);
          return Response.json({ erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
