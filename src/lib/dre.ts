/**
 * DRE gerencial: monta as linhas devolvidas por `financeiro_dre` (já somadas no banco) nos subtotais.
 * Vendas pela data do pedido; demais receitas e despesas pelo vencimento e pela categoria.
 * Os valores das linhas são sempre positivos; o sinal vem da posição no demonstrativo.
 */
export type LinhaDre = {
  secao: string;
  categoria_id: string | null;
  categoria: string;
  valor: number | string;
};

export type ItemDre = { categoriaId: string | null; nome: string; valor: number };

export type Dre = {
  vendas: number;
  outrasReceitas: ItemDre[];
  receitaBruta: number;
  devolucoes: number;
  deducoes: ItemDre[];
  receitaLiquida: number;
  cmv: number;
  custosDiretos: ItemDre[];
  lucroBruto: number;
  despesasOperacionais: ItemDre[];
  resultadoOperacional: number;
  receitasFinanceiras: ItemDre[];
  despesasFinanceiras: ItemDre[];
  resultadoFinanceiro: number;
  resultadoAntesImpostos: number;
  impostosLucro: ItemDre[];
  resultadoLiquido: number;
  /** O que entrou sem categoria (aparece como "Sem categoria" no demonstrativo). */
  semCategoria: { receitas: number; despesas: number };
};

const soma = (itens: readonly ItemDre[]) => itens.reduce((s, i) => s + i.valor, 0);
/** Evita 0,1 + 0,2 = 0,30000000000000004 nos subtotais. */
const cent = (n: number) => Math.round(n * 100) / 100;

export function montarDre(linhas: readonly LinhaDre[]): Dre {
  const por = (secao: string): ItemDre[] =>
    linhas
      .filter((l) => l.secao === secao)
      .map((l) => ({ categoriaId: l.categoria_id, nome: l.categoria, valor: Number(l.valor) }))
      .sort((a, b) => b.valor - a.valor);

  const vendas = soma(por("vendas"));
  const outrasReceitas = por("receita_outras");
  const devolucoes = soma(por("devolucoes"));
  const deducoes = por("despesa_deducao");
  const cmv = soma(por("cmv"));
  const custosDiretos = por("despesa_custo");
  const despesasOperacionais = por("despesa_operacional");
  const receitasFinanceiras = por("receita_financeira");
  const despesasFinanceiras = por("despesa_financeira");
  const impostosLucro = por("despesa_impostos_lucro");

  const receitaBruta = cent(vendas + soma(outrasReceitas));
  const receitaLiquida = cent(receitaBruta - devolucoes - soma(deducoes));
  const lucroBruto = cent(receitaLiquida - cmv - soma(custosDiretos));
  const resultadoOperacional = cent(lucroBruto - soma(despesasOperacionais));
  const resultadoFinanceiro = cent(soma(receitasFinanceiras) - soma(despesasFinanceiras));
  const resultadoAntesImpostos = cent(resultadoOperacional + resultadoFinanceiro);
  const resultadoLiquido = cent(resultadoAntesImpostos - soma(impostosLucro));

  const sem = (secoes: string[]) =>
    cent(
      secoes
        .flatMap(por)
        .filter((i) => i.categoriaId === null)
        .reduce((s, i) => s + i.valor, 0),
    );

  return {
    vendas: cent(vendas),
    outrasReceitas,
    receitaBruta,
    devolucoes: cent(devolucoes),
    deducoes,
    receitaLiquida,
    cmv: cent(cmv),
    custosDiretos,
    lucroBruto,
    despesasOperacionais,
    resultadoOperacional,
    receitasFinanceiras,
    despesasFinanceiras,
    resultadoFinanceiro,
    resultadoAntesImpostos,
    impostosLucro,
    resultadoLiquido,
    semCategoria: {
      receitas: sem(["receita_outras", "receita_financeira"]),
      despesas: sem([
        "despesa_deducao",
        "despesa_custo",
        "despesa_operacional",
        "despesa_financeira",
        "despesa_impostos_lucro",
      ]),
    },
  };
}

/** Percentual de um valor sobre a base (receita bruta), ou null sem base. */
export const percentualDe = (valor: number, base: number): number | null =>
  base === 0 ? null : (valor / base) * 100;

/** Períodos prontos para o filtro: dia 1 e último dia, no calendário (sem depender de fuso). */
export function periodoDoMes(hoje: string, mesesAtras = 0): { de: string; ate: string } {
  const [a, m] = hoje.split("-").map(Number) as [number, number];
  const base = new Date(Date.UTC(a, m - 1 - mesesAtras, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return { de: base.toISOString().slice(0, 10), ate: ultimo.toISOString().slice(0, 10) };
}

export function periodoDoAno(hoje: string): { de: string; ate: string } {
  const a = hoje.slice(0, 4);
  return { de: `${a}-01-01`, ate: `${a}-12-31` };
}
