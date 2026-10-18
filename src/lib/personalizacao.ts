/** Personalização sob encomenda: grade por tamanho, aprovação da arte e etapas de produção. */

export const etapasPersonalizacao = [
  { value: "aguardando_arte", label: "Aguardando aprovação da arte" },
  { value: "impressao", label: "Impressão das folhas" },
  { value: "prensa", label: "Prensa / montagem" },
  { value: "pronto", label: "Pronto para retirada/entrega" },
  { value: "entregue", label: "Entregue" },
] as const;

export type EtapaPersonalizacao = (typeof etapasPersonalizacao)[number]["value"];

export const labelEtapa = (v: string) =>
  etapasPersonalizacao.find((e) => e.value === v)?.label ?? v;

export const TAMANHOS_CHINELO = [
  "27/28", "29/30", "31/32", "33/34", "35/36", "37/38", "39/40", "41/42", "43/44", "45/46",
];

export type LinhaGrade = { modelo: string; tamanho: string; quantidade: number };

/** Linhas da grade com quantidade positiva (inteira), descartando tamanhos em branco. */
export function montarGrade(modelo: string, qtds: Record<string, string>): LinhaGrade[] {
  return Object.entries(qtds)
    .map(([tamanho, v]) => ({ modelo, tamanho, quantidade: Math.floor(Number(v.replace(",", "."))) }))
    .filter((l) => Number.isFinite(l.quantidade) && l.quantidade > 0);
}

export const totalGrade = (g: LinhaGrade[]) => g.reduce((s, l) => s + l.quantidade, 0);

/** A produção só começa com a arte aprovada; volta só uma etapa por vez e não pula etapas. */
export function proximaEtapa(etapa: string, arte: string): EtapaPersonalizacao | null {
  const i = etapasPersonalizacao.findIndex((e) => e.value === etapa);
  if (i < 0 || i === etapasPersonalizacao.length - 1) return null;
  if (etapa === "aguardando_arte" && arte !== "aprovada") return null;
  return etapasPersonalizacao[i + 1]!.value;
}
