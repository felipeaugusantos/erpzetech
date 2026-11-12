// Simulação do IBS/CBS de um item, com a MESMA conta da emissão da NF-e (base, alíquotas do ano, redução da
// classificação). Sem tela, para os testes rodarem no Node.
import {
  TRIBUTACAO_INTEGRAL,
  calcularItemIbsCbs,
  crtDoRegime,
  exigenciaIbsCbs,
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
