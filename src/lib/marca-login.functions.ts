import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

export type MarcaLogin = { nome: string; cor: string | null; logoUrl: string | null };

/** Dados públicos da marca da empresa para a tela de login personalizada (/nome-da-empresa). */
export const buscarMarcaLogin = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => {
    const slug = String(d?.slug ?? "").toLowerCase().trim().slice(0, 60);
    return { slug };
  })
  .handler(async ({ data }): Promise<MarcaLogin | null> => {
    if (!/^[a-z0-9-]{3,50}$/.test(data.slug)) return null;
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: key.startsWith("sb_")
        ? {
            fetch: (input, init) => {
              const h = new Headers(init?.headers);
              if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
              h.set("apikey", key);
              return fetch(input, { ...init, headers: h });
            },
          }
        : {},
    });
    const { data: rows } = await sb.rpc("empresa_por_slug", { p_slug: data.slug });
    const row = (rows as { nome: string; cor_primaria: string | null; logo_path: string | null }[] | null)?.[0];
    if (!row) return null;
    let logoUrl: string | null = null;
    if (row.logo_path) {
      if (row.logo_path.startsWith("http")) logoUrl = row.logo_path;
      else {
        // Só a logo desta empresa, por tempo limitado.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: s } = await supabaseAdmin.storage
          .from("empresa")
          .createSignedUrl(row.logo_path, 6 * 3600);
        logoUrl = s?.signedUrl ?? null;
      }
    }
    return { nome: row.nome, cor: row.cor_primaria, logoUrl };
  });
