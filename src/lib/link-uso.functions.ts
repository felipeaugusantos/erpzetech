import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Registra que o usuário logado entrou por este link (personalizado, principal, do cadastro ou código da empresa).
 * O banco só grava se o link é da empresa do próprio usuário; link inexistente, desativado ou de outra empresa é ignorado.
 */
export const registrarAcessoPorLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { slug: string }) => ({
    slug: String(input?.slug ?? "")
      .toLowerCase()
      .trim()
      .slice(0, 60),
  }))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (!data.slug) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("link_acesso_registrar", {
      p_user: context.userId,
      p_slug: data.slug,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
