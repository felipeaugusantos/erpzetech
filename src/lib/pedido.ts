export const situacoesPedido = [
  { value: "aguardando_pagamento", label: "Aguardando pagamento" },
  { value: "aprovado", label: "Aprovado" },
  { value: "separacao", label: "Separação" },
  { value: "separado", label: "Separado" },
  { value: "conferencia", label: "Conferência" },
  { value: "pronto_entrega", label: "Pronto para entrega" },
  { value: "em_rota", label: "Em rota" },
  { value: "entregue", label: "Entregue" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" },
] as const;

export type PedidoSituacao = (typeof situacoesPedido)[number]["value"];

const cores: Record<string, string> = {
  aguardando_pagamento: "bg-warning/20 text-warning-foreground",
  aprovado: "bg-info/15 text-info",
  separacao: "bg-info/15 text-info",
  separado: "bg-info/15 text-info",
  conferencia: "bg-accent/20 text-accent-foreground",
  pronto_entrega: "bg-accent/20 text-accent-foreground",
  em_rota: "bg-primary/15 text-primary",
  entregue: "bg-success/15 text-success",
  concluido: "bg-success/15 text-success",
  cancelado: "bg-destructive/15 text-destructive",
};

export function corSituacao(s: string) {
  return cores[s] ?? "bg-secondary text-secondary-foreground";
}

export function labelSituacao(s: string) {
  return situacoesPedido.find((x) => x.value === s)?.label ?? s;
}

/** Próximas situações permitidas — espelha a regra aplicada no banco. */
export function proximas(s: string): PedidoSituacao[] {
  switch (s) {
    case "aguardando_pagamento":
      return ["aprovado", "cancelado"];
    case "aprovado":
      return ["separacao", "cancelado"];
    case "separacao":
      return ["separado", "cancelado"];
    case "separado":
      return ["conferencia", "separacao", "cancelado"];
    case "conferencia":
      return ["pronto_entrega", "separacao", "cancelado"];
    case "pronto_entrega":
      return ["em_rota", "cancelado"];
    case "em_rota":
      return ["entregue", "cancelado"];
    case "entregue":
      return ["concluido"];
    default:
      return [];
  }
}
