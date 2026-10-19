/** Venda a granel: o saco guarda quantos kg tem; abrir o saco passa esses kg para o produto vendido por kg. */

/** Interpreta "15", "15,5" ou "15.5"; devolve null para vazio, zero ou negativo. */
export function lerFatorGranel(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

/** Quantos kg entram no granel ao abrir os sacos. */
export function kgDosSacos(sacos: number, fator: number): number {
  return Math.round(sacos * fator * 1000) / 1000;
}

/** Custo do kg: o custo do saco dividido pelos kg dele (4 casas, como o estoque guarda). */
export function custoDoKg(custoSaco: number, fator: number): number {
  if (!(fator > 0)) return 0;
  return Math.round((custoSaco / fator) * 10000) / 10000;
}

/** Margem do kg vendido contra o custo proporcional do saco; null quando não há custo. */
export function margemDoKg(precoKg: number, custoKg: number): number | null {
  if (!(precoKg > 0) || !(custoKg > 0)) return null;
  return ((precoKg - custoKg) / precoKg) * 100;
}
