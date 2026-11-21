import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { preferenciasAssistenteSchema } from "./assistente-whatsapp";

export const lerPreferenciasAssistente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("wa_assistente_preferencias_ler");
    if (error) throw new Error(error.message);
    return preferenciasAssistenteSchema.parse(data);
  });

export const salvarPreferenciasAssistente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(preferenciasAssistenteSchema)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("wa_assistente_preferencias_salvar", {
      p_dados: data,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
