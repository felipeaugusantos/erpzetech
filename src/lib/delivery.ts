// Delivery do restaurante: telefone, etapa do pedido, troco e o pedido para imprimir.
// O andamento de verdade fica no banco (restaurante_delivery_avancar); aqui ficam as contas da tela.

export const soDigitos = (v: string) => (v ?? "").replace(/\D/g, "");

/** Telefone para exibir: (11) 99999-8888. Fora do padrão, devolve o texto como veio. */
export function formatarTelefone(v: string | null | undefined): string {
  const d = soDigitos(v ?? "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v ?? "";
}

/** O banco aceita telefone com pelo menos 8 números (ou vazio). */
export const telefoneValido = (v: string) => v.trim() === "" || soDigitos(v).length >= 8;

export type SituacaoEntrega = "aguardando" | "saiu" | "entregue";
export type EtapaDelivery = "montando" | "cozinha" | "pronto" | "em_rota" | "entregue";

export const ROTULO_ETAPA: Record<EtapaDelivery, string> = {
  montando: "Montando o pedido",
  cozinha: "Na cozinha",
  pronto: "Pronto para sair",
  em_rota: "Em rota",
  entregue: "Entregue",
};

export const ROTULO_PAGAMENTO: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  pago_online: "Já pago (online)",
};

/**
 * Em que etapa o pedido está, a partir da entrega e da situação dos itens (cancelados não contam).
 * Quem chama deixa a taxa de entrega de fora: ela nasce "entregue" e não diz nada sobre a comida.
 */
export function etapaDelivery(
  entrega: SituacaoEntrega | null | undefined,
  situacoesItens: string[],
): EtapaDelivery {
  if (entrega === "entregue") return "entregue";
  if (entrega === "saiu") return "em_rota";
  const itens = situacoesItens.filter((s) => s !== "cancelado");
  if (itens.length === 0 || itens.includes("pendente")) return "montando";
  if (itens.some((s) => s === "enviado" || s === "preparando")) return "cozinha";
  return "pronto";
}

/** Troco que o entregador precisa levar; zero quando o cliente paga certo, ou sem informação. */
export function trocoNecessario(total: number, trocoPara: number | null | undefined): number {
  if (!trocoPara || trocoPara <= total) return 0;
  return Math.round((trocoPara - total + Number.EPSILON) * 100) / 100;
}

export function formatarEndereco(e: {
  endereco: string | null;
  bairro?: string | null | undefined;
  referencia?: string | null | undefined;
}): string {
  const partes = [e.endereco?.trim(), e.bairro?.trim()].filter(Boolean).join(" — ");
  return e.referencia?.trim() ? `${partes} (ref.: ${e.referencia.trim()})` : partes;
}

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** Pedido de delivery para imprimir (80 mm): cliente, endereço, itens, total e o troco a levar. */
export function htmlPedidoDelivery(p: {
  numero: number;
  loja?: string | null;
  cliente: string;
  telefone?: string | null;
  endereco: string | null;
  bairro?: string | null;
  referencia?: string | null;
  pagamento?: string | null;
  trocoPara?: number | null;
  observacao?: string | null;
  entregador?: string | null;
  itens: {
    quantidade: number;
    nome: string;
    opcoes?: string[];
    observacao?: string | null;
    total: number;
  }[];
  total: number;
}): string {
  const linhas = p.itens
    .map(
      (i) =>
        `<tr><td>${i.quantidade}× ${escapar(i.nome)}${
          i.opcoes?.length ? `<br><small>${escapar(i.opcoes.join(", "))}</small>` : ""
        }${i.observacao ? `<br><small><i>${escapar(i.observacao)}</i></small>` : ""}</td><td class="v">${reais(i.total)}</td></tr>`,
    )
    .join("");
  const troco = trocoNecessario(p.total, p.trocoPara ?? null);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Delivery ${p.numero}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: Arial, sans-serif; width: 72mm; margin: 0 auto; color: #000; font-size: 13px; }
  h1 { font-size: 26px; margin: 4px 0; text-align: center; }
  .loja { text-align: center; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  td { padding: 3px 0; vertical-align: top; border-bottom: 1px dotted #888; }
  td.v { text-align: right; white-space: nowrap; }
  .total { font-size: 18px; font-weight: bold; display: flex; justify-content: space-between; margin-top: 6px; }
  .aviso { border: 2px solid #000; padding: 4px; margin-top: 6px; font-weight: bold; text-align: center; }
  p { margin: 2px 0; }
</style></head><body>
  ${p.loja ? `<p class="loja">${escapar(p.loja)}</p>` : ""}
  <h1>DELIVERY ${p.numero}</h1>
  <p><b>${escapar(p.cliente)}</b>${p.telefone ? ` · ${escapar(formatarTelefone(p.telefone))}` : ""}</p>
  <p>${escapar(formatarEndereco({ endereco: p.endereco, bairro: p.bairro, referencia: p.referencia }))}</p>
  ${p.observacao ? `<p><i>${escapar(p.observacao)}</i></p>` : ""}
  <table>${linhas}</table>
  <div class="total"><span>Total</span><span>${reais(p.total)}</span></div>
  <p>Pagamento: ${escapar(ROTULO_PAGAMENTO[p.pagamento ?? ""] ?? "a combinar")}</p>
  ${troco > 0 ? `<div class="aviso">LEVAR TROCO: ${reais(troco)} (cliente paga com ${reais(p.trocoPara ?? 0)})</div>` : ""}
  ${p.pagamento === "pago_online" ? `<div class="aviso">PEDIDO JÁ PAGO</div>` : ""}
  ${p.entregador ? `<p>Entregador: ${escapar(p.entregador)}</p>` : ""}
</body></html>`;
}
