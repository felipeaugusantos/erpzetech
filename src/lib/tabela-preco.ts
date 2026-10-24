// Tabelas de preço por cliente: regra do preço de venda aplicado a um produto.

export type TabelaPreco = {
  id: string;
  nome: string;
  ajuste_percentual: number;
  ativa: boolean;
};

const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Preço do produto para quem tem esta tabela: o preço fixado para o produto, se houver; senão o preço de venda
 * com o ajuste percentual da tabela (negativo = desconto). Tabela inativa ou ausente não muda o preço.
 */
export function precoNaTabela(
  precoVenda: number,
  tabela: Pick<TabelaPreco, "ajuste_percentual" | "ativa"> | null | undefined,
  precoFixo?: number | null,
): number {
  if (!tabela || !tabela.ativa) return precoVenda;
  if (precoFixo != null && Number.isFinite(precoFixo) && precoFixo >= 0)
    return arredondar(precoFixo);
  return Math.max(0, arredondar(precoVenda * (1 + tabela.ajuste_percentual / 100)));
}

/** Texto do ajuste da tabela para listas: "10% de desconto", "5% de acréscimo" ou "preço normal". */
export function rotuloAjuste(ajuste: number): string {
  if (!ajuste) return "Preço normal";
  const valor = Math.abs(ajuste).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return ajuste < 0 ? `${valor}% de desconto` : `${valor}% de acréscimo`;
}
