import { createFileRoute } from "@tanstack/react-router";

import { chaveBearer, chaveTvConfere, montarResumoTv } from "@/lib/monitoramento-tv";
import { criarLimitador } from "@/lib/monitoramento";

// Painel de TV da central Zé Registra: GET /api/public/tv/monitoramento com "Authorization: Bearer <chave de leitura>".
// Devolve só números agregados (sem cliente, e-mail ou texto de erro). Quem chama é o servidor da central, nunca o navegador.
// Chave errada ou ausente = 401 sem detalhe; limite por IP; nada fica em cache.
const podeConsultar = criarLimitador(60, 60_000);

function ipDe(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "desconhecido"
  );
}

const SEM_CACHE = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/public/tv/monitoramento")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!podeConsultar(ipDe(request))) {
          return new Response(null, { status: 429, headers: SEM_CACHE });
        }
        const chave = chaveBearer(request.headers.get("authorization"));
        if (!chaveTvConfere(chave)) {
          return new Response("Unauthorized", { status: 401, headers: SEM_CACHE });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as unknown as {
            rpc(nome: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
          };
          const { data, error } = await db.rpc("saas_monitoramento_tv");
          if (error) return new Response(null, { status: 502, headers: SEM_CACHE });
          return Response.json(montarResumoTv(data), { headers: SEM_CACHE });
        } catch {
          return new Response(null, { status: 502, headers: SEM_CACHE });
        }
      },
    },
  },
});
