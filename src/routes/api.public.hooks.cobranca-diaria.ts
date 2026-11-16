import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Rotina diária da cobrança automática: POST /api/public/hooks/cobranca-diaria?lote=20 (com o segredo do cron).
// Gera as faturas do mês, cria no Asaas as cobranças que faltam e suspende/reativa por inadimplência. Repetir é seguro.
export const Route = createFileRoute("/api/public/hooks/cobranca-diaria")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const negado = await authenticateCronRequest(request);
        if (negado) return negado;
        try {
          const { gatewayConfigurado, rodadaDeCobranca } =
            await import("@/lib/cobranca-asaas.server");
          if (!gatewayConfigurado()) {
            return Response.json({ erro: "ASAAS_API_KEY não configurada" }, { status: 503 });
          }
          const lote = Number(new URL(request.url).searchParams.get("lote") ?? 20);
          const resumo = await rodadaDeCobranca(
            Number.isFinite(lote) && lote > 0 ? Math.min(lote, 100) : 20,
          );
          return Response.json(resumo);
        } catch (e) {
          console.error("[cobranca] falha na rodada diária", e);
          return Response.json({ erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
