import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/oauth/backup-drive/return")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const message = {
          type: "erpBackupDriveOAuth",
          connectorId: url.searchParams.get("connector_id"),
          code: url.searchParams.get("success") === "true" ? url.searchParams.get("code") : null,
          nonce: url.searchParams.get("nonce"),
        };
        const json = JSON.stringify(message).replace(/</g, "\\u003c");
        return new Response(
          `<!doctype html><html lang="pt-BR"><head><title>Conexão Google Drive — ERP Ze Tech</title><meta name="referrer" content="no-referrer"></head><body><p>Concluindo conexão com o Google Drive…</p><script>if(window.opener){window.opener.postMessage(${json},window.location.origin);window.close()}</script></body></html>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          },
        );
      },
    },
  },
});
