import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

import { urlPublicaFoto } from "@/lib/cardapio-foto";

export type ItemPublico = {
  nome: string;
  descricao: string | null;
  preco: number;
  porPeso: boolean;
  fotoUrl: string | null;
  grupos: {
    nome: string;
    obrigatorio: boolean;
    max_escolhas: number;
    opcoes: { nome: string; preco_adicional: number }[];
  }[];
};
export type CardapioPublico = {
  empresa: { nome: string; cor: string | null; logoUrl: string | null };
  categorias: { nome: string; itens: ItemPublico[] }[];
};

/** Cardápio online (só leitura) de uma empresa que ligou a página pública. */
export const buscarCardapioPublico = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => ({
    slug: String(d?.slug ?? "")
      .toLowerCase()
      .trim()
      .slice(0, 60),
  }))
  .handler(async ({ data }): Promise<CardapioPublico | null> => {
    if (!/^[a-z0-9-]{3,50}$/.test(data.slug)) return null;
    const url = process.env["SUPABASE_URL"]!;
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(url, key, {
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
    const { data: bruto } = await sb.rpc("restaurante_cardapio_publico", { p_slug: data.slug });
    const r = bruto as {
      empresa: { nome: string; cor: string | null; logo_path: string | null };
      categorias: {
        nome: string;
        itens: (Omit<ItemPublico, "fotoUrl" | "porPeso"> & {
          foto_path: string | null;
          por_peso?: boolean;
        })[];
      }[];
    } | null;
    if (!r) return null;

    let logoUrl: string | null = null;
    const logo = r.empresa.logo_path;
    if (logo) {
      if (logo.startsWith("http")) logoUrl = logo;
      else {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: s } = await supabaseAdmin.storage
          .from("empresa")
          .createSignedUrl(logo, 6 * 3600);
        logoUrl = s?.signedUrl ?? null;
      }
    }
    return {
      empresa: { nome: r.empresa.nome, cor: r.empresa.cor, logoUrl },
      categorias: r.categorias.map((c) => ({
        nome: c.nome,
        itens: c.itens.map((i) => ({
          nome: i.nome,
          descricao: i.descricao,
          preco: Number(i.preco),
          porPeso: i.por_peso === true,
          fotoUrl: urlPublicaFoto(url, i.foto_path),
          grupos: i.grupos ?? [],
        })),
      })),
    };
  });
