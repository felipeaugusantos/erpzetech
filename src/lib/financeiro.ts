export const situacoesCompra = [
  { value: "rascunho", label: "Rascunho" },
  { value: "cotacao", label: "Cotação" },
  { value: "aprovado", label: "Aprovado" },
  { value: "pedido_enviado", label: "Pedido enviado" },
  { value: "parcialmente_recebido", label: "Parcialmente recebido" },
  { value: "recebido", label: "Recebido" },
  { value: "cancelado", label: "Cancelado" },
] as const;

export type CompraSituacao = (typeof situacoesCompra)[number]["value"];

const coresCompra: Record<string, string> = {
  rascunho: "bg-secondary text-secondary-foreground",
  cotacao: "bg-info/15 text-info",
  aprovado: "bg-accent/20 text-accent-foreground",
  pedido_enviado: "bg-primary/15 text-primary",
  parcialmente_recebido: "bg-warning/20 text-warning-foreground",
  recebido: "bg-success/15 text-success",
  cancelado: "bg-destructive/15 text-destructive",
};

export const corCompra = (s: string) => coresCompra[s] ?? "bg-secondary text-secondary-foreground";
export const labelCompra = (s: string) => situacoesCompra.find((x) => x.value === s)?.label ?? s;

/** Próximas situações permitidas — espelha a regra aplicada no banco. */
export function proximasCompra(s: string): CompraSituacao[] {
  switch (s) {
    case "rascunho":
      return ["cotacao", "aprovado", "cancelado"];
    case "cotacao":
      return ["aprovado", "rascunho", "cancelado"];
    case "aprovado":
      return ["pedido_enviado", "cancelado"];
    case "pedido_enviado":
    case "parcialmente_recebido":
      return ["cancelado"];
    default:
      return [];
  }
}

export const podeReceber = (s: string) =>
  s === "aprovado" || s === "pedido_enviado" || s === "parcialmente_recebido";

export const formasPagamento = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "crediario", label: "Crediário" },
] as const;

export type FormaPagamento = (typeof formasPagamento)[number]["value"];

export const labelForma = (s: string | null | undefined) =>
  formasPagamento.find((x) => x.value === s)?.label ?? "—";

export const divergencias = [
  { value: "quantidade", label: "Quantidade divergente" },
  { value: "produto_errado", label: "Produto errado (não entra no estoque)" },
  { value: "danificado", label: "Produto danificado" },
] as const;

export const situacoesConta = [
  { value: "aberto", label: "Aberto" },
  { value: "parcial", label: "Parcial" },
  { value: "pago", label: "Pago" },
  { value: "cancelado", label: "Cancelado" },
] as const;

export const hojeISO = () => new Date().toISOString().slice(0, 10);

export const estaVencida = (situacao: string, vencimento: string) =>
  (situacao === "aberto" || situacao === "parcial") && vencimento < hojeISO();

export function labelConta(situacao: string, vencimento: string) {
  if (estaVencida(situacao, vencimento)) return "Vencido";
  return situacoesConta.find((x) => x.value === situacao)?.label ?? situacao;
}

export function corConta(situacao: string, vencimento: string) {
  if (estaVencida(situacao, vencimento)) return "bg-destructive/15 text-destructive";
  const cores: Record<string, string> = {
    aberto: "bg-info/15 text-info",
    parcial: "bg-warning/20 text-warning-foreground",
    pago: "bg-success/15 text-success",
    cancelado: "bg-secondary text-secondary-foreground",
  };
  return cores[situacao] ?? "bg-secondary text-secondary-foreground";
}

export const tiposCaixaMov = [
  { value: "entrada", label: "Entrada" },
  { value: "saida", label: "Saída" },
  { value: "sangria", label: "Sangria" },
  { value: "suprimento", label: "Suprimento" },
] as const;

export const entradaCaixa = (tipo: string) =>
  ["abertura", "entrada", "suprimento", "venda", "recebimento"].includes(tipo);

export const somaDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
