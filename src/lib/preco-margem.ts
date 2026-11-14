/** Margem sobre o preço de venda (mesma regra da tela Preços e margens). */
export function margemSobrePreco(custo: number, preco: number): number {
  return preco > 0 ? ((preco - custo) / preco) * 100 : 0;
}

/** Preço para atingir a margem: custo 10 com 30% → 14,29. Margem fora de 0–99,99% → null. */
export function precoPelaMargem(custo: number, margemPct: number): number | null {
  if (!(custo > 0) || !(margemPct >= 0) || margemPct >= 100) return null;
  return Math.round((custo / (1 - margemPct / 100)) * 100) / 100;
}
