// Ligação do WhatsApp com o servidor Evolution da Ze Tech e com o banco (service role). Só roda no servidor.
// Variáveis de ambiente: EVOLUTION_API_URL e EVOLUTION_API_KEY (servidor Evolution), WHATSAPP_WEBHOOK_SECRET (assina os avisos
// que o Evolution manda de volta) e, se o endereço público do sistema não for o da requisição, WHATSAPP_APP_URL.
// WHATSAPP_EMPRESAS_LIBERADAS: ids das empresas que podem usar o WhatsApp (vazia = nenhuma; ver whatsapp-liberacao.ts).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tokenConfere as conferir, tokenDoWebhook as derivar } from "./whatsapp-token.ts";
import { despachar, type ItemReservado } from "./whatsapp-despacho.ts";
import { enviarTexto, type ConfigEvolution } from "./whatsapp-evolution.ts";
import {
  MENSAGEM_NAO_LIBERADA,
  empresaLiberada,
  listaDeEmpresasLiberadas,
  separarPorLiberacao,
} from "./whatsapp-liberacao.ts";

export function configEvolution(): ConfigEvolution {
  const url = process.env["EVOLUTION_API_URL"];
  const apikey = process.env["EVOLUTION_API_KEY"];
  if (!url || !apikey) throw new Error("O servidor de WhatsApp da EZRA ainda não está configurado");
  return { url, apikey };
}

/** Empresas liberadas para o WhatsApp (variável de ambiente). Vazia ou ausente: ninguém. */
export const empresasLiberadas = () =>
  listaDeEmpresasLiberadas(process.env["WHATSAPP_EMPRESAS_LIBERADAS"]);

/** Recusa a empresa que não está na lista (conectar e atualizar a conexão). */
export function exigirEmpresaLiberada(tenantId: string) {
  if (!empresaLiberada(tenantId, empresasLiberadas())) throw new Error(MENSAGEM_NAO_LIBERADA);
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
  const liberadas = empresasLiberadas();
  // sem nenhuma empresa liberada a rodada nem toca no banco: nada é enfileirado, reservado nem enviado
  if (liberadas.size === 0)
    return {
      enfileiradas: 0,
      enviadas: 0,
      repetir: 0,
      falhas: 0,
      semRegistro: 0,
      aviso: "nenhuma empresa liberada",
    };
  const resultado = async (r: {
    id: string;
    ok: boolean;
    idExterno?: string;
    jid?: string | null;
    erro?: string;
    proxima?: Date | null;
  }) => {
    const { error } = await supabaseAdmin.rpc("wa_resultado", {
      p_id: r.id,
      p_ok: r.ok,
      p_id_externo: r.idExterno ?? (null as unknown as string),
      p_jid: r.jid ?? (null as unknown as string),
      p_erro: r.erro ?? (null as unknown as string),
      p_proxima: r.proxima ? r.proxima.toISOString() : (null as unknown as string),
    });
    if (error) throw new Error(error.message);
  };
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
      const { liberados, bloqueados } = separarPorLiberacao(
        (data ?? []) as unknown as ItemReservado[],
        liberadas,
      );
      // empresa fora da lista (conectada antes da trava): não envia, e a mensagem sai de "enviando" com o motivo
      for (const item of bloqueados)
        await resultado({ id: item.id, ok: false, erro: MENSAGEM_NAO_LIBERADA, proxima: null });
      return liberados;
    },
    enviar: (item, texto, atrasoMs) =>
      enviarTexto(cfg, item.instancia, item.numero, texto, atrasoMs),
    resultado,
  });
}
