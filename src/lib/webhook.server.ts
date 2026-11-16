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
import { tokenNoCabecalho } from "@/lib/webhook";
import { lerEventoAsaas } from "@/lib/cobranca-gateway";

const PROVEDORES: Record<string, ProvedorWebhook> = {
  // Cobrança das mensalidades (Asaas). URL no painel do Asaas: https://<app>/api/public/webhooks/asaas, com o token em
  // ASAAS_WEBHOOK_TOKEN (o Asaas o envia no cabeçalho asaas-access-token). Ver docs/cobranca-asaas.md.
  asaas: {
    nome: "asaas",
    segredo: () => process.env["ASAAS_WEBHOOK_TOKEN"],
    autenticar: (headers, segredo) => tokenNoCabecalho(headers, "asaas-access-token", segredo),
    extrair: (payload) => {
      const e = lerEventoAsaas(payload);
      return e ? { id: e.eventoId } : null;
    },
    processar: async (evento) => {
      const e = lerEventoAsaas(evento.payload);
      if (!e || e.acao === "ignorar") return "ignorado";
      const { aplicarEvento } = await import("@/lib/cobranca-asaas.server");
      const resultado = await aplicarEvento({
        cobrancaId: e.cobrancaId,
        acao: e.acao,
        valor: e.valor,
        forma: e.forma,
        data: e.data,
        status: e.status,
      });
      return resultado === "desconhecida" ? "ignorado" : "processado";
    },
  },
  // Outros provedores. Exemplo:
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
    const { data, error } = await supabaseAdmin.rpc(
      "webhook_registrar" as never,
      {
        p_provedor: provedor,
        p_event_id: eventId,
        ...(tenantId ? { p_tenant_id: tenantId } : {}),
        p_payload: payload as Json,
      } as never,
    );
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
    const { data, error } = await supabaseAdmin.rpc(
      "webhook_concluir" as never,
      {
        p_provedor: provedor,
        p_event_id: eventId,
        p_tentativa: tentativa,
        p_status: status,
        ...(erro ? { p_erro: erro } : {}),
      } as never,
    );
    if (error) throw error;
    return data === true;
  },
};
