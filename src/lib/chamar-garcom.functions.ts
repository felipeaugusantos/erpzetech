import { createServerFn } from "@tanstack/react-start";

export type InfoChamado = {
  empresa: { nome: string; cor: string | null };
  mesa: string;
  motivos: { id: string; nome: string }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{3,50}$/;
const limpaSlug = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .trim()
    .slice(0, 60);

/** Dados da página de chamar o garçom (nome da loja, mesa e motivos). Nulo se o recurso está desligado. */
export const buscarInfoChamado = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string; mesa: string }) => ({
    slug: limpaSlug(d?.slug),
    mesa: String(d?.mesa ?? ""),
  }))
  .handler(async ({ data }): Promise<InfoChamado | null> => {
    if (!SLUG.test(data.slug) || !UUID.test(data.mesa)) return null;
    const { clientePublico } = await import("@/lib/supabase-publico.server");
    const { data: r } = await clientePublico().rpc("restaurante_chamar_info", {
      p_slug: data.slug,
      p_mesa_id: data.mesa,
    });
    return (r as InfoChamado | null) ?? null;
  });

/** Registra o chamado da mesa. Devolve só se deu certo; a mensagem de erro do banco é a que o cliente vê. */
export const chamarGarcom = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string; mesa: string; motivo: string | null }) => ({
    slug: limpaSlug(d?.slug),
    mesa: String(d?.mesa ?? ""),
    motivo: d?.motivo ? String(d.motivo) : null,
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    if (!SLUG.test(data.slug) || !UUID.test(data.mesa) || (data.motivo && !UUID.test(data.motivo)))
      return { ok: false, erro: "Chamado indisponível" };
    const { clientePublico } = await import("@/lib/supabase-publico.server");
    const { error } = await clientePublico().rpc("restaurante_chamar_garcom", {
      p_slug: data.slug,
      p_mesa_id: data.mesa,
      p_motivo_id: data.motivo,
    });
    return error ? { ok: false, erro: error.message } : { ok: true };
  });
