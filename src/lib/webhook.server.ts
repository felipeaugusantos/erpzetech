/**
 * Ligação dos webhooks de entrada com o Supabase (service role). Só roda no servidor.
 *
 * Para adicionar um provedor (Pix, boleto, maquininha, NFC-e...):
 *  1. cadastre o segredo compartilhado como variável de ambiente (ex.: PIX_WEBHOOK_SECRET);
 *  2. crie um `ProvedorWebhook` em PROVEDORES, com a chave igual ao `nome`;
 *  3. informe ao provedor a URL  https://<app>/api/public/webhooks/<nome>.
 * O endpoint confere a assinatura, grava o evento uma única vez e chama `processar`. Se `processar`
 * lançar erro, o provedor recebe 500 e tenta de novo; o evento é reprocessado.
 *
 * IMPORTANTE: `processar` deve ser idempotente (usar o id do evento como chave de qualquer baixa ou
 * emissão). Se o processamento terminar mas a gravação da conclusão falhar, o evento fica como
 * "recebido" e, passados 5 minutos, uma nova entrega do provedor o reprocessa.
 */
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DepsWebhook, ProvedorWebhook } from "@/lib/webhook";

const PROVEDORES: Record<string, ProvedorWebhook> = {
  // Nenhum provedor cadastrado ainda. Exemplo:
  //
  // pix: {
  //   nome: "pix",
  //   segredo: () => process.env["PIX_WEBHOOK_SECRET"],
  //   cabecalhoAssinatura: "x-signature",
  //   assinatura: { prefixo: "sha256=" },
  //   extrair: (payload) => {
  //     const p = payload as { id?: string };
  //     return p.id ? { id: p.id } : null;
  //   },
  //   processar: async (evento) => { /* dar baixa, emitir nota... */ return "processado"; },
  // },
};

export const depsWebhook: DepsWebhook = {
  provedores: PROVEDORES,
  registrar: async ({ provedor, eventId, tenantId, payload }) => {
    const { data, error } = await supabaseAdmin.rpc("webhook_registrar", {
      p_provedor: provedor,
      p_event_id: eventId,
      ...(tenantId ? { p_tenant_id: tenantId } : {}),
      p_payload: payload as Json,
    });
    if (error) throw error;
    const registro = data as { resultado?: unknown; tentativa?: unknown } | null;
    const resultado = registro?.resultado;
    const tentativa = registro?.tentativa;
    if (
      (resultado !== "novo" && resultado !== "reprocessar" && resultado !== "duplicado") ||
      typeof tentativa !== "number"
    ) {
      throw new Error(`Resposta inesperada de webhook_registrar: ${JSON.stringify(data)}`);
    }
    return { resultado, tentativa };
  },
  concluir: async ({ provedor, eventId, tentativa, status, erro }) => {
    const { data, error } = await supabaseAdmin.rpc("webhook_concluir", {
      p_provedor: provedor,
      p_event_id: eventId,
      p_tentativa: tentativa,
      p_status: status,
      ...(erro ? { p_erro: erro } : {}),
    });
    if (error) throw error;
    return data === true;
  },
};
