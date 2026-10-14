/** Saldos de um item de pedido ao longo do atendimento (separação → conferência → saída). */
export type ItemSaldoEntrada = {
  quantidade: number;
  quantidade_separada: number;
  quantidade_conferida: number;
  quantidade_entregue: number;
  /** Já programado em entregas planejadas ou em rota, ainda não concluídas. */
  planejado: number;
};

export type ItemSaldo = {
  pedido: number;
  separado: number;
  conferido: number;
  planejado: number;
  entregue: number;
  /** O que ainda pode ser retirado ou entregue agora. */
  disponivelParaSaida: number;
  /** Tudo que ainda falta sair do pedido (inclui o que já está programado). */
  pendente: number;
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const arred = (v: number) => Math.round(v * 1000) / 1000;

export function saldoItem(i: ItemSaldoEntrada): ItemSaldo {
  const pedido = n(i.quantidade);
  const entregue = n(i.quantidade_entregue);
  const planejado = n(i.planejado);
  return {
    pedido,
    separado: n(i.quantidade_separada),
    conferido: n(i.quantidade_conferida),
    planejado,
    entregue,
    pendente: arred(Math.max(pedido - entregue, 0)),
    disponivelParaSaida: arred(Math.max(pedido - entregue - planejado, 0)),
  };
}

/** Mensagem de erro se a quantidade pedida para sair passa do saldo, ou null se está ok. */
export function validaSaida(saldo: ItemSaldo, quantidade: number): string | null {
  if (!Number.isFinite(quantidade) || quantidade < 0) return "Quantidade inválida";
  if (quantidade > saldo.disponivelParaSaida + 1e-9)
    return `Acima do saldo pendente (${saldo.disponivelParaSaida})`;
  return null;
}

/** Soma por item o que está em entregas ainda abertas (planejada ou em rota). */
export function planejadoPorItem(
  entregas: { situacao: string; entrega_itens?: { pedido_item_id: string; quantidade: number }[] }[],
): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const e of entregas) {
    if (e.situacao !== "planejada" && e.situacao !== "em_rota") continue;
    for (const ei of e.entrega_itens ?? []) {
      mapa[ei.pedido_item_id] = (mapa[ei.pedido_item_id] ?? 0) + n(ei.quantidade);
    }
  }
  return mapa;
}
