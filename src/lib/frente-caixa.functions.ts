import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Confere e-mail/senha de um gestor e devolve uma autorização de uso único (5 min). */
export const autorizarGestor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email(),
        senha: z.string().min(1),
        acao: z.enum(["cancelar_venda", "desconto", "sangria"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const verificador = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: login, error } = await verificador.auth.signInWithPassword({
      email: data.email,
      password: data.senha,
    });
    if (error || !login.user) throw new Error("Senha do gestor incorreta");
    const gestorId = login.user.id;
    await verificador.auth.signOut();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: perfilGestor }, { data: perfilOperador }, { data: papeis }] = await Promise.all([
      supabaseAdmin.from("profiles").select("tenant_id, ativo").eq("id", gestorId).maybeSingle(),
      supabaseAdmin.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", gestorId),
    ]);
    const ehGestor = (papeis ?? []).some((p) => p.role === "gestor" || p.role === "administrador");
    if (!perfilGestor?.tenant_id || !perfilOperador || perfilGestor.tenant_id !== perfilOperador.tenant_id || !ehGestor)
      throw new Error("Este usuário não é gestor desta empresa");

    const { data: aut, error: e2 } = await supabaseAdmin
      .from("gestor_autorizacoes")
      .insert({ tenant_id: perfilGestor.tenant_id, gestor_id: gestorId, operador_id: context.userId, acao: data.acao })
      .select("id")
      .single();
    if (e2) throw new Error(e2.message);
    return { autorizacaoId: aut.id as string };
  });

const Sugestao = z.object({
  itens: z.array(
    z.object({
      codigo: z.string(),
      quantidade: z.number(),
      motivo: z.string(),
    }),
  ),
  observacao: z.string(),
});

/** Usa IA para achar produtos do catálogo que atendem ao que o cliente descreveu. */
export const sugerirProdutos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ texto: z.string().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Serviço de IA não configurado");

    const { data: produtos, error } = await context.supabase
      .from("produtos")
      .select("id, descricao, unidade, unidade_venda, preco_venda")
      .eq("ativo", true)
      .limit(1500);
    if (error) throw new Error(error.message);
    if (!produtos?.length) return { itens: [], observacao: "Nenhum produto cadastrado." };

    const catalogo = produtos
      .map((p, i) => `P${i}|${p.descricao}|${p.unidade_venda ?? p.unidade ?? "UN"}|${Number(p.preco_venda ?? 0).toFixed(2)}`)
      .join("\n");

    const { streamText, Output } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        output: Output.object({ schema: Sugestao }),
        system:
          "Você é um vendedor experiente de loja de materiais de construção. Com base no pedido do cliente, escolha SOMENTE produtos do catálogo (use o código Pxx exato), no máximo 12 itens, com quantidade sugerida na unidade de venda e um motivo curto em português. Se o cliente der medidas, calcule a quantidade. Em 'observacao' dê uma dica curta ou diga o que faltou no catálogo.",
        prompt: `Catálogo (código|descrição|unidade|preço):\n${catalogo}\n\nPedido do cliente: ${data.texto}`,
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      const out = await result.output;
      const itens = out.itens
        .slice(0, 12)
        .map((it) => {
          const p = produtos[Number(it.codigo.replace(/\D/g, ""))];
          if (!p) return null;
          return {
            produto_id: p.id,
            descricao: p.descricao,
            quantidade: Math.max(Math.round(it.quantidade * 1000) / 1000, 0.001),
            motivo: it.motivo,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return { itens, observacao: out.observacao };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
      if (status === 429) throw new Error("Muitas consultas seguidas. Aguarde alguns segundos.");
      throw new Error("Não foi possível consultar a IA agora.");
    }
  });
