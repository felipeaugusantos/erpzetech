type UnidadesProduto = {
  unidade: string;
  unidade_compra: string | null;
  fator_conversao: number;
};

const normalizar = (v: string | null) => (v ?? "").trim().toUpperCase();

/** Só converte automaticamente quando a nota está na unidade de compra cadastrada. */
export function fatorEntrada(unidadeNota: string, produto?: UnidadesProduto): number {
  if (!produto || normalizar(unidadeNota) === normalizar(produto.unidade)) return 1;
  if (normalizar(unidadeNota) !== normalizar(produto.unidade_compra)) return 1;
  return Number.isFinite(produto.fator_conversao) && produto.fator_conversao > 0
    ? produto.fator_conversao
    : 1;
}

export function quantidadeEntrada(embalagens: number, fator: number): number {
  if (!Number.isFinite(fator) || fator <= 0) throw new Error("Informe um fator de conversão maior que zero.");
  return Math.round(embalagens * fator * 1e6) / 1e6;
}