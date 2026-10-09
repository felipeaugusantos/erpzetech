// Ficha técnica: consumo real dos insumos, custo do prato e margem. A baixa de estoque é feita no banco
// (restaurante_movimentar_insumos); aqui ficam as contas que a tela mostra, com a mesma fórmula.

export type LinhaFicha = {
  /** por unidade vendida, na unidade de estoque do insumo */
  quantidade: number;
  perda_percentual: number;
  /** custo do insumo por unidade de estoque */
  custoUnitario: number;
};

const arredonda = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Consumo real de um insumo por prato: a quantidade da ficha mais a perda de preparo (qtd ÷ (1 − perda)). */
export function consumoReal(quantidade: number, perdaPercentual: number): number {
  const perda = Math.min(Math.max(perdaPercentual, 0), 89.99);
  return arredonda((quantidade * 100) / (100 - perda), 4);
}

/** Custo de um insumo: o custo médio do depósito do restaurante, ou o custo do cadastro se ainda não houver. */
export function custoDoInsumo(
  custoMedioDeposito: number | null | undefined,
  custoCadastro: number | null | undefined,
) {
  const medio = Number(custoMedioDeposito ?? 0);
  return medio > 0 ? medio : Number(custoCadastro ?? 0);
}

/** Custo de produzir uma unidade do prato. */
export function custoDoPrato(linhas: LinhaFicha[]): number {
  const total = linhas.reduce(
    (s, l) => s + consumoReal(l.quantidade, l.perda_percentual) * l.custoUnitario,
    0,
  );
  return arredonda(total, 2);
}

export type Margem = {
  custo: number;
  lucro: number;
  /** custo ÷ preço (CMV) */
  cmvPercentual: number;
  /** lucro ÷ preço */
  margemPercentual: number;
};

/** Margem do prato; sem preço não há percentual. */
export function margemDoPrato(preco: number, custo: number): Margem | null {
  if (!(preco > 0)) return null;
  const lucro = arredonda(preco - custo, 2);
  return {
    custo: arredonda(custo, 2),
    lucro,
    cmvPercentual: arredonda((custo / preco) * 100, 1),
    margemPercentual: arredonda((lucro / preco) * 100, 1),
  };
}

/** Faixa de alerta: custo acima de 40% do preço aperta a margem de um restaurante. */
export function faixaCmv(cmvPercentual: number): "bom" | "atencao" | "alto" {
  if (cmvPercentual <= 35) return "bom";
  if (cmvPercentual <= 45) return "atencao";
  return "alto";
}
