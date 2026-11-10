import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Rotina noturna de backup por cliente: POST /api/public/hooks/backup-clientes?lote=3 (com o segredo do cron).
// Cada chamada faz o backup de até `lote` clientes ainda sem o do dia e aplica a retenção; repetir a chamada é seguro
// (cliente já feito é pulado). Ver docs/backup-por-cliente.md para o agendamento.
export const Route = createFileRoute("/api/public/hooks/backup-clientes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const negado = await authenticateCronRequest(request);
        if (negado) return negado;
        try {
          const { rodadaDeBackup } = await import("@/lib/backup-tenant.server");
          const lote = new URL(request.url).searchParams.get("lote");
          return Response.json(await rodadaDeBackup({ lote }));
        } catch (e) {
          console.error("[backup] falha na rodada", e);
          return Response.json({ erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
