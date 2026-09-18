export const situacoesEntrega = [
  { value: "planejada", label: "Planejada" },
  { value: "em_rota", label: "Em rota" },
  { value: "entregue", label: "Entregue" },
  { value: "insucesso", label: "Sem sucesso" },
] as const;

export type EntregaSituacao = (typeof situacoesEntrega)[number]["value"];

const cores: Record<string, string> = {
  planejada: "bg-info/15 text-info",
  em_rota: "bg-primary/15 text-primary",
  entregue: "bg-success/15 text-success",
  insucesso: "bg-destructive/15 text-destructive",
};

export function corEntrega(s: string) {
  return cores[s] ?? "bg-secondary text-secondary-foreground";
}

export function labelEntrega(s: string) {
  return situacoesEntrega.find((x) => x.value === s)?.label ?? s;
}

export const motivosInsucesso = [
  "Cliente ausente",
  "Endereço não localizado",
  "Recusa do cliente",
  "Obra fechada",
  "Acesso impedido para o veículo",
  "Produto avariado no transporte",
  "Falta de tempo na rota",
] as const;

export const tiposVeiculo = [
  { value: "caminhao", label: "Caminhão" },
  { value: "truck", label: "Truck" },
  { value: "carreta", label: "Carreta" },
  { value: "utilitario", label: "Utilitário" },
  { value: "van", label: "Van" },
  { value: "moto", label: "Moto" },
] as const;

export function enderecoPedido(p: {
  entrega_endereco?: string | null;
  entrega_numero?: string | null;
  entrega_bairro?: string | null;
  entrega_cidade?: string | null;
  entrega_estado?: string | null;
}) {
  const linha = [p.entrega_endereco, p.entrega_numero].filter(Boolean).join(", ");
  const cidade = [p.entrega_bairro, p.entrega_cidade, p.entrega_estado].filter(Boolean).join(" · ");
  return [linha, cidade].filter(Boolean).join(" — ") || "Retirada na loja";
}
