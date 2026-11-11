import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { empresaLiberada, listaDeEmpresasLiberadas } from "@/lib/whatsapp-liberacao";
import {
  INSTRUCAO_RESUMO,
  MENSAGEM_IA_NAO_LIBERADA,
  ResumoClinico,
  textoDoHistorico,
  type FichaParaResumo,
  type ResumoClinicoT,
} from "@/lib/resumo-ia-clinica";

export type ResultadoResumo = { vazio: true } | { vazio: false; resumo: ResumoClinicoT };

/** Empresas liberadas para o resumo com IA (ids em CLINICA_IA_EMPRESAS_LIBERADAS; vazia = ninguém). */
export const empresasComResumoIa = () =>
  listaDeEmpresasLiberadas(process.env["CLINICA_IA_EMPRESAS_LIBERADAS"]);

/**
 * Resumo do histórico do animal para o veterinário ler. A empresa vem da sessão, a leitura é a do próprio prontuário
 * (só veterinário, com registro de acesso) e nada é gravado.
 */
export const resumirHistoricoClinico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ petId: z.guid() }).parse(d))
  .handler(async ({ data, context }): Promise<ResultadoResumo> => {
    const { data: tenant, error: eTenant } = await context.supabase.rpc("current_tenant_id");
    if (eTenant || !tenant) throw new Error("Sessão sem empresa");
    if (!empresaLiberada(String(tenant), empresasComResumoIa()))
      throw new Error(MENSAGEM_IA_NAO_LIBERADA);

    // mesma leitura e mesma regra da ficha: o banco recusa quem não é veterinário da clínica liberada
    const { data: ficha, error } = await context.supabase.rpc("clinica_historico", {
      p_pet_id: data.petId,
    });
    if (error) throw new Error(error.message);
    const texto = textoDoHistorico(ficha as unknown as FichaParaResumo);
    if (!texto) return { vazio: true };

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Serviço de IA não configurado");
    const { generateText, Output } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    try {
      const r = await generateText({
        model: lovable.responses("openai/gpt-6-astra"),
        output: Output.object({ schema: ResumoClinico }),
        system: INSTRUCAO_RESUMO,
        prompt: `Histórico do animal:\n\n${texto}`,
        providerOptions: { openai: { reasoningEffort: "low", store: false } },
      });
      return { vazio: false, resumo: r.output };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 402)
        throw new Error("Créditos de IA esgotados.");
      if ((e as { statusCode?: number }).statusCode === 429)
        throw new Error("Muitos resumos agora. Tente de novo em instantes.");
      throw new Error("Não foi possível gerar o resumo agora. Leia o histórico abaixo.");
    }
  });

/** Só diz se o botão deve aparecer: a empresa da sessão está na lista. Não lê dado clínico. */
export const resumoIaLiberado = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<boolean> => {
    const { data: tenant, error } = await context.supabase.rpc("current_tenant_id");
    return !error && !!tenant && empresaLiberada(String(tenant), empresasComResumoIa());
  });
