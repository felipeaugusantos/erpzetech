import { createFileRoute } from "@tanstack/react-router";

// Endpoint público de webhooks de entrada: POST /api/public/webhooks/<provedor>.
// A autenticidade vem da assinatura HMAC de cada provedor (ver src/lib/webhook.ts).
export const Route = createFileRoute("/api/public/webhooks/$provedor")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { tratarWebhook } = await import("@/lib/webhook");
        const { depsWebhook } = await import("@/lib/webhook.server");
        return tratarWebhook(request, params.provedor, depsWebhook);
      },
    },
  },
});
