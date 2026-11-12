export type PedidoFaturamento = {
  created_at: string;
  situacao: string;
  pedido_itens?: { total: number | string }[] | null;
};

/** Usa a mesma receita por itens e data de criação do resumo do Dashboard. */
export function serieFaturamento(
  pedidos: readonly PedidoFaturamento[],
  periodo: { de: string; ate: string },
) {
  const inicio = new Date(`${periodo.de}T00:00:00Z`);
  const fim = new Date(`${periodo.ate}T00:00:00Z`);
  if (!Number.isFinite(inicio.getTime()) || !Number.isFinite(fim.getTime()) || inicio > fim)
    return [];
  const totais = new Map<string, number>();
  for (const pedido of pedidos) {
    const dia = pedido.created_at.slice(0, 10);
    if (pedido.situacao === "cancelado" || dia < periodo.de || dia > periodo.ate) continue;
    const valor = (pedido.pedido_itens ?? []).reduce((s, item) => s + Number(item.total), 0);
    totais.set(dia, (totais.get(dia) ?? 0) + valor);
  }
  const serie: { data: string; faturamento: number }[] = [];
  for (const dia = inicio; dia <= fim; dia.setUTCDate(dia.getUTCDate() + 1)) {
    const data = dia.toISOString().slice(0, 10);
    serie.push({ data, faturamento: totais.get(data) ?? 0 });
  }
  return serie;
}