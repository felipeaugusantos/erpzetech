import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Conexão do WhatsApp da empresa (QR code). Só administrador ou gestor, e só a instância da própria empresa:
// o nome vem do tenant da sessão, nunca de quem chama.

async function empresaDoGestor(supabase: {
  rpc: (n: "wa_exige_gestor") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("wa_exige_gestor");
  if (error) throw new Error(error.message);
  return String(data);
}

export type ResultadoConexao = {
  estado: "conectada" | "desconectada" | "conectando";
  numero: string | null;
  qrBase64: string | null;
  codigoPareamento: string | null;
};

/** Cria a instância (se preciso), liga os avisos ao sistema e devolve o QR code para ler no celular. */
export const whatsappConectar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResultadoConexao> => {
    const tenantId = await empresaDoGestor(context.supabase);
    const ev = await import("./whatsapp-evolution");
    const srv = await import("./whatsapp.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = srv.configEvolution();
    const instancia = ev.nomeDaInstancia(tenantId);
    const criada = await ev.criarInstancia(cfg, instancia);
    await ev.configurarWebhook(cfg, instancia, {
      url: srv.urlDoWebhook(new URL(getRequest().url).origin, instancia),
      eventos: ev.EVENTOS_WEBHOOK,
    });
    const r = await ev.conectar(cfg, instancia);
    const estado = r.estado ?? "conectando";
    const { error } = await supabaseAdmin
      .from("wa_config")
      .upsert(
        { tenant_id: tenantId, instancia, estado, atualizado_em: new Date().toISOString() },
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(error.message);
    return {
      estado,
      numero: null,
      qrBase64: r.qrBase64 ?? criada.qrBase64,
      codigoPareamento: r.codigoPareamento,
    };
  });

/** Consulta o servidor: conectou? Enquanto não conecta, devolve o QR code atual (ele troca a cada alguns segundos). */
export const whatsappAtualizar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResultadoConexao> => {
    const tenantId = await empresaDoGestor(context.supabase);
    const ev = await import("./whatsapp-evolution");
    const srv = await import("./whatsapp.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = srv.configEvolution();
    const instancia = ev.nomeDaInstancia(tenantId);
    const estado = await ev.estadoConexao(cfg, instancia);
    const numero = estado === "conectada" ? await ev.numeroConectado(cfg, instancia) : null;
    const qr = estado === "conectando" ? await ev.conectar(cfg, instancia) : null;
    const { error } = await supabaseAdmin
      .from("wa_config")
      .update({
        estado,
        numero,
        atualizado_em: new Date().toISOString(),
        ...(estado === "conectada" ? { conectada_em: new Date().toISOString() } : {}),
        ...(estado === "desconectada"
          ? { auto_pronto: false, auto_plano: false, auto_desde: null }
          : {}),
      })
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return {
      estado,
      numero,
      qrBase64: qr?.qrBase64 ?? null,
      codigoPareamento: qr?.codigoPareamento ?? null,
    };
  });

/** Desconecta o número (sai do WhatsApp Web) e desliga o envio automático. */
export const whatsappDesconectar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const tenantId = await empresaDoGestor(context.supabase);
    const ev = await import("./whatsapp-evolution");
    const srv = await import("./whatsapp.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await ev.desconectar(srv.configEvolution(), ev.nomeDaInstancia(tenantId));
    } catch (e) {
      // instância já desconectada no servidor: segue e marca como desconectada aqui também
      if (!(e instanceof ev.ErroEvolution) || e.status < 400 || e.status >= 500) throw e;
    }
    const { error } = await supabaseAdmin
      .from("wa_config")
      .update({
        estado: "desconectada",
        numero: null,
        auto_pronto: false,
        auto_plano: false,
        auto_desde: null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
