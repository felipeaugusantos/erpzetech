// Ligação do WhatsApp com o servidor Evolution da Ze Tech e com o banco (service role). Só roda no servidor.
// Variáveis de ambiente: EVOLUTION_API_URL e EVOLUTION_API_KEY (servidor Evolution), WHATSAPP_WEBHOOK_SECRET (assina os avisos
// que o Evolution manda de volta) e, se o endereço público do sistema não for o da requisição, WHATSAPP_APP_URL.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tokenConfere as conferir, tokenDoWebhook as derivar } from "./whatsapp-token.ts";
import { despachar, type ItemReservado } from "./whatsapp-despacho.ts";
import { enviarTexto, type ConfigEvolution } from "./whatsapp-evolution.ts";

export function configEvolution(): ConfigEvolution {
  const url = process.env["EVOLUTION_API_URL"];
  const apikey = process.env["EVOLUTION_API_KEY"];
  if (!url || !apikey)
    throw new Error("O servidor de WhatsApp da Ze Tech ainda não está configurado");
  return { url, apikey };
}

function segredo() {
  const s = process.env["WHATSAPP_WEBHOOK_SECRET"];
  if (!s || s.length < 16)
    throw new Error("WHATSAPP_WEBHOOK_SECRET não configurado (mínimo de 16 caracteres)");
  return s;
}

/** Senha do aviso de uma instância: o Evolution devolve este valor na URL e só ele serve para aquela instância. */
export const tokenDoWebhook = (instancia: string) => derivar(segredo(), instancia);

export const tokenConfere = (instancia: string, informado: string | null) =>
  conferir(segredo(), instancia, informado);

export function urlDoWebhook(origem: string, instancia: string) {
  const base = (process.env["WHATSAPP_APP_URL"] || origem).replace(/\/+$/, "");
  return `${base}/api/public/whatsapp/eventos?t=${tokenDoWebhook(instancia)}`;
}

/** Uma rodada do envio (cron): enfileira o automático, reserva o que é da hora e envia pelo Evolution. */
export async function rodadaDeEnvio() {
  const cfg = configEvolution();
  return despachar({
    varrer: async () => {
      const { data, error } = await supabaseAdmin.rpc("wa_auto_varrer");
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    reservar: async (total, porEmpresa, dentroHorario) => {
      const { data, error } = await supabaseAdmin.rpc("wa_reservar", {
        p_total: total,
        p_por_empresa: porEmpresa,
        p_dentro_horario: dentroHorario,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ItemReservado[];
    },
    enviar: (item, texto, atrasoMs) =>
      enviarTexto(cfg, item.instancia, item.numero, texto, atrasoMs),
    resultado: async (r) => {
      const { error } = await supabaseAdmin.rpc("wa_resultado", {
        p_id: r.id,
        p_ok: r.ok,
        p_id_externo: r.idExterno ?? null,
        p_jid: r.jid ?? null,
        p_erro: r.erro ?? null,
        p_proxima: r.proxima ? r.proxima.toISOString() : null,
      });
      if (error) throw new Error(error.message);
    },
  });
}
