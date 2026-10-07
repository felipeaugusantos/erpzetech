import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gtinValido, interpretarCosmos, type ProdutoGtin } from "@/lib/gtin";

export type ResultadoGtin =
  | { status: "ok"; produto: ProdutoGtin }
  | { status: "nao_encontrado" | "sem_token" | "limite" | "invalido" | "erro" };

/**
 * Busca nome, marca e NCM de um código de barras no Cosmos (Bluesoft).
 * O token fica só no servidor (COSMOS_TOKEN); COSMOS_USER_AGENT é opcional.
 */
export const consultarGtin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { gtin: string }) => ({ gtin: String(d?.gtin ?? "").trim() }))
  .handler(async ({ data }): Promise<ResultadoGtin> => {
    if (!gtinValido(data.gtin)) return { status: "invalido" };
    const token = process.env["COSMOS_TOKEN"];
    if (!token) return { status: "sem_token" };
    try {
      const r = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${data.gtin}.json`, {
        headers: {
          "X-Cosmos-Token": token,
          "Content-Type": "application/json",
          // O Cosmos pode exigir o User-Agent exibido junto com o token da conta.
          "User-Agent": process.env["COSMOS_USER_AGENT"] || "Cosmos-API-Request",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404) return { status: "nao_encontrado" };
      if (r.status === 429) return { status: "limite" };
      if (!r.ok) return { status: "erro" };
      const produto = interpretarCosmos(await r.json());
      return produto ? { status: "ok", produto } : { status: "nao_encontrado" };
    } catch {
      return { status: "erro" };
    }
  });
