// Campo de busca do PDV: "3*cimento" ou "3*7891234" significa quantidade 3 do produto buscado.
// Só "*" e "×" valem como multiplicador: "x" aparece em nomes como "madeira 2x4".
export type BuscaPdv = { quantidade: number | null; termo: string };

export function interpretarBusca(texto: string): BuscaPdv {
  const t = texto.trim();
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*[*×]\s*(.*)$/);
  if (!m) return { quantidade: null, termo: t };
  const n = Number(m[1]!.replace(",", "."));
  const quantidade = Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
  return { quantidade, termo: m[2]!.trim() };
}
