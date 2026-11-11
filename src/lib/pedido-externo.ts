// Pedido de canal externo (iFood) no formato interno que a caixa de entrada guarda (ver a migration 20261213).

export type ItemPedidoExterno = {
  codigo: string;
  nome: string;
  quantidade: number;
  preco: number;
  observacao?: string | null;
  adicionais?: { nome: string; preco: number }[];
};

export type PedidoExterno = {
  numero?: string | null;
  tipo?: "entrega" | "retirada" | "local";
  cliente?: { nome?: string | null; telefone?: string | null };
  endereco?: { texto?: string | null; bairro?: string | null; referencia?: string | null };
  itens: ItemPedidoExterno[];
  taxa_entrega?: number;
  desconto?: number;
  total?: number;
  pagamento?: string | null;
  troco_para?: number | null;
  observacao?: string | null;
};

export const ROTULO_TIPO_EXTERNO: Record<string, string> = {
  entrega: "Entrega",
  retirada: "Retirada no balcão",
  local: "Consumo no local",
};

/** Itens do pedido (sem repetir o código) que ainda não têm item do cardápio ligado. */
export function itensSemCorrespondencia(
  pedido: Pick<PedidoExterno, "itens">,
  cardapio: readonly { codigo_externo: string | null }[],
): ItemPedidoExterno[] {
  const conhecidos = new Set(cardapio.map((c) => c.codigo_externo).filter(Boolean));
  const vistos = new Set<string>();
  const faltam: ItemPedidoExterno[] = [];
  for (const i of pedido.itens) {
    if (conhecidos.has(i.codigo) || vistos.has(i.codigo)) continue;
    vistos.add(i.codigo);
    faltam.push(i);
  }
  return faltam;
}

/** Valor dos itens com adicionais, como o banco soma ao aceitar (sem taxa de entrega nem desconto). */
export function totalItensPedido(pedido: Pick<PedidoExterno, "itens">): number {
  const cent = pedido.itens.reduce((s, i) => {
    const unit =
      Math.round(i.preco * 100) +
      (i.adicionais ?? []).reduce((a, x) => a + Math.round(x.preco * 100), 0);
    return s + Math.round(i.quantidade * unit);
  }, 0);
  return cent / 100;
}
