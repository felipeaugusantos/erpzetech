/**
 * Conferência física da nota de entrada: quando o fornecedor fatura menos do que mandou
 * (itens fora da nota, quantidade genérica ou valor menor que o pago), o valor real pago
 * é distribuído entre tudo o que entrou fisicamente, proporcional ao valor de cada linha.
 */
export type LinhaRateio = {
  /** quantidade que entra no estoque */
  quantidade: number;
  /** valor de referência da linha (custo da nota, ou quantidade × preço de referência do item extra) */
  base: number;
};

/** Custo unitário de cada linha. Sem valor real, mantém a base. Sem base, divide pela quantidade. */
export function ratearValorReal(linhas: LinhaRateio[], valorReal: number | null): number[] {
  const validas = linhas.map((l) => ({ q: Math.max(0, l.quantidade), b: Math.max(0, l.base) }));
  if (valorReal == null || !(valorReal > 0)) {
    return validas.map((l) => (l.q > 0 ? round6(l.b / l.q) : 0));
  }
  const somaBase = validas.reduce((s, l) => s + l.b, 0);
  const algumaSemBase = validas.some((l) => l.q > 0 && l.b <= 0);
  if (somaBase <= 0 || algumaSemBase) {
    const somaQ = validas.reduce((s, l) => s + l.q, 0);
    return validas.map((l) => (l.q > 0 && somaQ > 0 ? round6(valorReal / somaQ) : 0));
  }
  return validas.map((l) => (l.q > 0 ? round6((valorReal * (l.b / somaBase)) / l.q) : 0));
}

/** Diferença entre o que foi pago e o valor fiscal da nota. */
export function ajusteComercial(valorFiscal: number, valorReal: number | null) {
  if (valorReal == null || !(valorReal > 0)) return 0;
  return Math.round((valorReal - valorFiscal) * 100) / 100;
}

function round6(v: number) {
  return Math.round(v * 1e6) / 1e6;
}
