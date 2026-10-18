/** Personalização sob encomenda: grade por tamanho, aprovação da arte e etapas de produção. */

export const etapasPersonalizacao = [
  { value: "aguardando_arte", label: "Aguardando aprovação da arte" },
  { value: "impressao", label: "Impressão das folhas" },
  { value: "prensa", label: "Prensa" },
  { value: "montagem", label: "Montagem das tiras" },
  { value: "pronto", label: "Pronto para retirada/entrega" },
  { value: "entregue", label: "Entregue" },
] as const;

export type EtapaPersonalizacao = (typeof etapasPersonalizacao)[number]["value"];

export const labelEtapa = (v: string) =>
  etapasPersonalizacao.find((e) => e.value === v)?.label ?? v;

export const TAMANHOS_CHINELO = [
  "27/28",
  "29/30",
  "31/32",
  "33/34",
  "35/36",
  "37/38",
  "39/40",
  "41/42",
  "43/44",
  "45/46",
];

export type LinhaGrade = { modelo: string; tamanho: string; quantidade: number };

/** Linhas da grade com quantidade positiva (inteira), descartando tamanhos em branco. */
export function montarGrade(modelo: string, qtds: Record<string, string>): LinhaGrade[] {
  return Object.entries(qtds)
    .map(([tamanho, v]) => ({
      modelo,
      tamanho,
      quantidade: Math.floor(Number(v.replace(",", "."))),
    }))
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

/** Item de nota de entrada que é tira de chinelo (pede a grade de tamanhos na importação). */
export const ehTira = (descricao: string) => /\bTIRAS?\b/i.test(descricao);

/** Tamanho já escrito na descrição (ex.: "TIRA TRADICIONAL 45/46" → "45/46"). */
export function tamanhoNaDescricao(descricao: string): string | null {
  return TAMANHOS_CHINELO.find((t) => descricao.includes(t)) ?? null;
}

export type GradeEntrada = { tamanho: string; quantidade: number }[];

/** Grade da entrada a partir dos campos digitados (só tamanhos com pares). */
export function gradeEntrada(qtds: Record<string, string>): GradeEntrada {
  return montarGrade("", qtds).map(({ tamanho, quantidade }) => ({ tamanho, quantidade }));
}

/** Posição do tamanho na numeração de chinelo (tamanhos desconhecidos vão para o fim). */
export const ordemTamanho = (t: string) => {
  const i = TAMANHOS_CHINELO.indexOf(t);
  return i < 0 ? 999 : i;
};

export type CustoParEntrada = {
  tira: number;
  tirasPorPar: number;
  solado: number;
  soladosPorPar: number;
  folha: number;
  paresPorFolha: number;
  outros: number;
};

/** Custo de um par: tira e solado pela quantidade usada, folha dividida pelos pares que ela rende, mais outros gastos. */
export function custoPar(e: CustoParEntrada) {
  const tira = e.tira * e.tirasPorPar;
  const solado = e.solado * e.soladosPorPar;
  const folha = e.paresPorFolha > 0 ? e.folha / e.paresPorFolha : 0;
  const total = tira + solado + folha + e.outros;
  return { tira, solado, folha, outros: e.outros, total };
}

/** Margem sobre o preço de venda, em %. */
export const margemPar = (preco: number, custo: number) =>
  preco > 0 ? ((preco - custo) / preco) * 100 : 0;

export const etapasProducao = ["impressao", "prensa", "montagem"] as const;

/** Situação de uma etapa de produção em relação à etapa atual do pedido. */
export function statusEtapa(
  atual: string,
  etapa: string,
): "concluida" | "andamento" | "aguardando" {
  const ordem = etapasPersonalizacao.map((e) => e.value as string);
  const a = ordem.indexOf(atual),
    e = ordem.indexOf(etapa);
  return a > e ? "concluida" : a === e ? "andamento" : "aguardando";
}

export type SacolinhaEntrada = {
  precoMetroVoil: number;
  sacolinhasPorMetro: number;
  costura: number;
  precoRoloFita: number;
  sacolinhasPorRolo: number;
  folha: number;
  folhasPorSacolinha: number;
};

/** Padrões da oficina: voil R$13,50/m rende 16,5; costura R$1,00; rolo de fita R$16,90 rende 100; 2 folhas. */
export const SACOLINHA_PADRAO = {
  precoMetroVoil: 13.5,
  sacolinhasPorMetro: 16.5,
  costura: 1,
  precoRoloFita: 16.9,
  sacolinhasPorRolo: 100,
  folhasPorSacolinha: 2,
};

/** Custo de uma sacolinha voil pronta: tecido + costura + fita de cetim + folhas transfer. */
export function custoSacolinha(e: SacolinhaEntrada) {
  const tecido = e.sacolinhasPorMetro > 0 ? e.precoMetroVoil / e.sacolinhasPorMetro : 0;
  const fita = e.sacolinhasPorRolo > 0 ? e.precoRoloFita / e.sacolinhasPorRolo : 0;
  const folhas = e.folha * e.folhasPorSacolinha;
  const total = tecido + e.costura + fita + folhas;
  return { tecido, costura: e.costura, fita, folhas, total };
}
