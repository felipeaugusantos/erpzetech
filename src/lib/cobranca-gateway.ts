// Cobrança automática das mensalidades pelo gateway (Asaas): regras puras, sem rede nem banco.
// Monta os pedidos ao gateway a partir das faturas e traduz os eventos (webhook) em ações sobre a fatura.
// A ligação com o gateway e o banco está em cobranca-asaas.server.ts.

export type FaturaPendente = {
  fatura_id: string;
  cliente_id: string;
  descricao: string;
  valor: number | string;
  vencimento: string;
  cliente_nome: string;
  documento: string | null;
  email: string | null;
  whatsapp: string | null;
  gateway_cliente_id: string | null;
};

export type PedidoCliente = {
  name: string;
  cpfCnpj: string;
  email?: string;
  mobilePhone?: string;
  externalReference: string;
};

export type PedidoCobranca = {
  customer: string;
  billingType: "UNDEFINED";
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function arredondar2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** O gateway não aceita vencimento no passado: fatura já vencida é cobrada com vencimento de hoje (a fatura no sistema não muda). */
export function dataDeVencimento(vencimento: string, hoje: string): string {
  if (!DATA_ISO.test(vencimento) || !DATA_ISO.test(hoje))
    throw new Error("Data de vencimento inválida");
  return vencimento < hoje ? hoje : vencimento;
}

/** CPF (11 dígitos) ou CNPJ (14, numérico ou alfanumérico); qualquer outra coisa vira erro legível. */
export function documentoLimpo(documento: string | null | undefined): string {
  const limpo = (documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (/^\d{11}$/.test(limpo) || /^[0-9A-Z]{14}$/.test(limpo)) return limpo;
  throw new Error("CPF ou CNPJ do cliente ausente ou inválido");
}

function celular(whatsapp: string | null | undefined): string | undefined {
  let d = (whatsapp ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : undefined;
}

export function montarClienteAsaas(p: FaturaPendente): PedidoCliente {
  const pedido: PedidoCliente = {
    name: p.cliente_nome.trim().slice(0, 100),
    cpfCnpj: documentoLimpo(p.documento),
    externalReference: p.cliente_id,
  };
  if (!pedido.name) throw new Error("Nome do cliente ausente");
  const email = p.email?.trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) pedido.email = email;
  const fone = celular(p.whatsapp);
  if (fone) pedido.mobilePhone = fone;
  return pedido;
}

export function montarCobrancaAsaas(
  p: FaturaPendente,
  clienteGateway: string,
  hoje: string,
): PedidoCobranca {
  const valor = arredondar2(Number(p.valor));
  if (!Number.isFinite(valor) || valor <= 0) throw new Error("Valor da fatura inválido");
  if (!clienteGateway) throw new Error("Cliente do gateway ausente");
  return {
    customer: clienteGateway,
    billingType: "UNDEFINED", // quem paga escolhe Pix, boleto ou cartão na página da fatura
    value: valor,
    dueDate: dataDeVencimento(p.vencimento, hoje),
    description: p.descricao.trim().slice(0, 500),
    externalReference: p.fatura_id,
  };
}

// ---------------------------------------------------------------------------------------------
// Eventos do webhook

export type AcaoDoEvento = "baixar" | "estornar" | "status" | "ignorar";

export type EventoAsaas = {
  eventoId: string;
  evento: string;
  cobrancaId: string;
  status: string;
  valor: number;
  forma: string;
  data: string | null;
  acao: AcaoDoEvento;
};

/** Forma de pagamento no vocabulário do sistema. */
export function formaDoGateway(billingType: string | null | undefined): string {
  switch (billingType) {
    case "PIX":
      return "pix";
    case "BOLETO":
      return "boleto";
    case "CREDIT_CARD":
    case "DEBIT_CARD":
      return "cartao";
    default:
      return "outro";
  }
}

/**
 * O que fazer com cada evento. Dinheiro disponível (RECEIVED) dá baixa; no cartão a confirmação (CONFIRMED) já vale, pois o
 * repasse leva dias; boleto e Pix só valem no RECEIVED. Estorno e contestação desfazem a baixa. Vencida, apagada, restaurada,
 * alterada e captura recusada só anotam a situação. O resto é ignorado.
 */
export function acaoDoEvento(evento: string, billingType: string | null | undefined): AcaoDoEvento {
  switch (evento) {
    case "PAYMENT_RECEIVED":
      return "baixar";
    case "PAYMENT_CONFIRMED":
      return billingType === "CREDIT_CARD" ? "baixar" : "status";
    case "PAYMENT_REFUNDED":
    case "PAYMENT_PARTIALLY_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_RECEIVED_IN_CASH_UNDONE":
      return "estornar";
    case "PAYMENT_OVERDUE":
    case "PAYMENT_DELETED":
    case "PAYMENT_RESTORED":
    case "PAYMENT_UPDATED":
    case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
    case "PAYMENT_AWAITING_CHARGEBACK_REVERSAL":
      return "status";
    default:
      return "ignorar";
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Lê o corpo do webhook do Asaas. null = formato inesperado (o chamador responde 400). */
export function lerEventoAsaas(payload: unknown): EventoAsaas | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const eventoId = texto(p["id"]);
  const evento = texto(p["event"]);
  const pg = p["payment"];
  if (!eventoId || !evento || !pg || typeof pg !== "object" || Array.isArray(pg)) return null;
  const pagamento = pg as Record<string, unknown>;
  const cobrancaId = texto(pagamento["id"]);
  if (!cobrancaId) return null;
  const valor = Number(pagamento["value"]);
  const dataBruta = texto(pagamento["paymentDate"]) ?? texto(pagamento["clientPaymentDate"]);
  const billingType = texto(pagamento["billingType"]);
  return {
    eventoId,
    evento,
    cobrancaId,
    status: texto(pagamento["status"]) ?? evento,
    valor: Number.isFinite(valor) ? arredondar2(valor) : 0,
    forma: formaDoGateway(billingType),
    data: dataBruta && DATA_ISO.test(dataBruta) ? dataBruta : null,
    acao: acaoDoEvento(evento, billingType),
  };
}

// ---------------------------------------------------------------------------------------------
// Situação da assinatura (tela de bloqueio e aviso)

export type FaturaEmAberto = {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  url: string | null;
};

export type SituacaoAssinatura = {
  bloqueado: boolean;
  emAtraso: boolean;
  diasAtraso: number;
  valorEmAberto: number;
  toleranciaDias: number;
  faturas: FaturaEmAberto[];
};

/** Lê o retorno de assinatura_situacao(). Qualquer formato inesperado vira null (nunca bloqueia por engano). */
export function lerSituacaoAssinatura(dados: unknown): SituacaoAssinatura | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  if (typeof d["bloqueado"] !== "boolean" || typeof d["em_atraso"] !== "boolean") return null;
  const faturas = Array.isArray(d["faturas"])
    ? d["faturas"].flatMap((f): FaturaEmAberto[] => {
        if (!f || typeof f !== "object") return [];
        const x = f as Record<string, unknown>;
        if (
          typeof x["id"] !== "string" ||
          typeof x["descricao"] !== "string" ||
          typeof x["vencimento"] !== "string"
        )
          return [];
        const url = typeof x["url"] === "string" && /^https:\/\//.test(x["url"]) ? x["url"] : null;
        return [
          {
            id: x["id"],
            descricao: x["descricao"],
            valor: Number(x["valor"]) || 0,
            vencimento: x["vencimento"],
            url,
          },
        ];
      })
    : [];
  return {
    bloqueado: d["bloqueado"],
    emAtraso: d["em_atraso"],
    diasAtraso: Number(d["dias_atraso"]) || 0,
    valorEmAberto: Number(d["valor_em_aberto"]) || 0,
    toleranciaDias: Number(d["tolerancia_dias"]) || 10,
    faturas,
  };
}
