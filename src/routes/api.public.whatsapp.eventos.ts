import { createFileRoute } from "@tanstack/react-router";

// Avisos do servidor Evolution (conexão, entrega, respostas): POST /api/public/whatsapp/eventos?t=<senha da instância>.
// A senha é derivada da instância com WHATSAPP_WEBHOOK_SECRET (ver src/lib/whatsapp.server.ts); sem ela nada é gravado.
// Qualquer formato desconhecido responde 200 e é ignorado, para o Evolution não ficar repetindo o envio.
export const Route = createFileRoute("/api/public/whatsapp/eventos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { interpretarEvento, ehPedidoDeSaida } = await import("@/lib/whatsapp-evolution");
        const { tokenConfere } = await import("@/lib/whatsapp.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let corpo: unknown;
        try {
          corpo = await request.json();
        } catch {
          return new Response("Corpo inválido", { status: 400 });
        }
        const instanciaDoCorpo =
          corpo && typeof corpo === "object"
            ? (corpo as Record<string, unknown>)["instance"]
            : null;
        if (
          typeof instanciaDoCorpo !== "string" ||
          !tokenConfere(instanciaDoCorpo, new URL(request.url).searchParams.get("t"))
        ) {
          return new Response("Não autorizado", { status: 401 });
        }

        const ev = interpretarEvento(corpo);
        if (ev.tipo === "conexao") {
          const agora = new Date().toISOString();
          const { error } = await supabaseAdmin
            .from("wa_config")
            .update({
              estado: ev.estado,
              atualizado_em: agora,
              ...(ev.numero ? { numero: ev.numero } : {}),
              ...(ev.estado === "conectada" ? { conectada_em: agora } : {}),
              // sem conexão não há envio automático: volta desligado
              ...(ev.estado === "desconectada"
                ? { numero: null, auto_pronto: false, auto_plano: false, auto_desde: null }
                : {}),
            })
            .eq("instancia", ev.instancia);
          if (error) return new Response("Erro ao gravar", { status: 500 });
        } else if (ev.tipo === "status") {
          if (ev.status !== "enviada") {
            const { error } = await supabaseAdmin.rpc("wa_status", {
              p_instancia: ev.instancia,
              p_id_externo: ev.idMensagem,
              p_status: ev.status,
            });
            if (error) return new Response("Erro ao gravar", { status: 500 });
          }
        } else if (ev.tipo === "entrada" && ehPedidoDeSaida(ev.texto)) {
          const { error } = await supabaseAdmin.rpc("wa_saida_registrar", {
            p_instancia: ev.instancia,
            p_numero: ev.numero as string,
            p_jid: ev.jid as string,
          });
          if (error) return new Response("Erro ao gravar", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
