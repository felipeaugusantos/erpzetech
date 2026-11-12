// Simulação do IBS/CBS de um item, com a MESMA conta da emissão da NF-e (base, alíquotas do ano, redução da
// classificação). Sem tela, para os testes rodarem no Node.
import {
  TRIBUTACAO_INTEGRAL,
  calcularItemIbsCbs,
  crtDoRegime,
  exigenciaIbsCbs,
  totaisIbsCbs,
  type ExigenciaIbsCbs,
  type ResultadoItemIbsCbs,
} from "./ibs-cbs.ts";

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Base do IBS/CBS (UB16), como na emissão: valor do item menos desconto e menos PIS, COFINS e ICMS destacados.
 * Nunca negativa.
 */
export function baseIbsCbs(e: {
  total: number;
  desconto?: number;
  pis?: number;
  cofins?: number;
  icms?: number;
}): number {
  return Math.max(
    0,
    centavos(
      centavos(e.total) -
        centavos(e.desconto ?? 0) -
        centavos(e.pis ?? 0) -
        centavos(e.cofins ?? 0) -
        centavos(e.icms ?? 0),
    ),
  );
}

export type SimulacaoItem =
  | { ok: true; resultado: ResultadoItemIbsCbs; base: number }
  | { ok: false; motivo: string; base: number };

/** Calcula o IBS/CBS de um item; devolve o motivo (em vez de lançar) quando a combinação não é calculada. */
export function simularItemIbsCbs(e: {
  /** Em branco = tributação integral (como o produto sem classificação). */
  cst: string;
  cClassTrib: string;
  total: number;
  desconto?: number;
  pis?: number;
  cofins?: number;
  icms?: number;
  ano: number;
}): SimulacaoItem {
  const base = baseIbsCbs(e);
  const cst = e.cst && e.cClassTrib ? e.cst : TRIBUTACAO_INTEGRAL.cst;
  const cClassTrib = e.cst && e.cClassTrib ? e.cClassTrib : TRIBUTACAO_INTEGRAL.cClassTrib;
  try {
    return {
      ok: true,
      base,
      resultado: calcularItemIbsCbs({ cst, cClassTrib, baseCalculo: base, ano: e.ano }),
    };
  } catch (erro) {
    return {
      ok: false,
      base,
      motivo: erro instanceof Error ? erro.message : "Não foi possível calcular.",
    };
  }
}

/** O que a emissão faz com o IBS/CBS neste regime e nesta data (mesma regra de `transmitirNfe`). */
export function situacaoIbsCbs(
  regime: string | null | undefined,
  dataIso: string,
): ExigenciaIbsCbs {
  return exigenciaIbsCbs(crtDoRegime(regime), dataIso);
}

export type ItemEstimativa = {
  id: string;
  descricao: string;
  /** Valor do item já sem o desconto do próprio item. */
  total: number;
  /** Classificação do produto; em branco = tributação integral (como na emissão). */
  cst: string | null | undefined;
  cClassTrib: string | null | undefined;
};

export type EstimativaPedido = {
  itens: { id: string; descricao: string; sim: SimulacaoItem }[];
  totais: ReturnType<typeof totaisIbsCbs>;
  /** Itens que a emissão ainda não calcula (a nota deles seria recusada). */
  comErro: { id: string; descricao: string; motivo: string }[];
};

/**
 * Estimativa de IBS/CBS de um pedido, antes de existir a nota. Usa a mesma conta da emissão, mas a base é o valor
 * do item: ICMS, PIS e COFINS só existem depois que a nota é calculada, então a estimativa fica um pouco acima do
 * valor da nota. O desconto do pedido inteiro também não é rateado aqui.
 */
export function estimarIbsCbsPedido(
  itens: readonly ItemEstimativa[],
  ano: number,
): EstimativaPedido {
  const linhas = itens.map((i) => ({
    id: i.id,
    descricao: i.descricao,
    sim: simularItemIbsCbs({
      cst: i.cst ?? "",
      cClassTrib: i.cClassTrib ?? "",
      total: i.total,
      ano,
    }),
  }));
  return {
    itens: linhas,
    totais: totaisIbsCbs(linhas.flatMap((l) => (l.sim.ok ? [l.sim.resultado] : []))),
    comErro: linhas.flatMap((l) =>
      l.sim.ok ? [] : [{ id: l.id, descricao: l.descricao, motivo: l.sim.motivo }],
    ),
  };
}
