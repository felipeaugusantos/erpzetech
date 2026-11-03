// Cobrança no caixa da ordem de serviço do pet e da internação, sem dependência de tela.
// O banco confere de novo no vínculo (pet_os_cobrar, clinica_internacao_cobrar); aqui só se avisa antes de fechar a venda.

export type LinhaCobrada = {
  produto_id: string;
  descricao: string;
  quantidade: number;
  preco: number;
};
export type LinhaDoCaixa = { produto_id: string; quantidade: number; preco: number };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * A venda precisa manter cada item cobrado, na quantidade (pode ter mais) e pelo valor combinado.
 * Devolve a mensagem do primeiro que falta ou mudou; null quando está tudo.
 */
export function erroDasLinhasCobradas(
  linhas: readonly LinhaDoCaixa[],
  exigidas: readonly LinhaCobrada[],
): string | null {
  for (const e of exigidas) {
    const l = linhas.find((x) => x.produto_id === e.produto_id);
    if (!l || l.quantidade < e.quantidade - 0.0005 || Math.abs(l.preco - e.preco) > 0.001)
      return `Mantenha "${e.descricao}" na venda, ${qtd(e.quantidade)} un. por ${brl(e.preco)}`;
  }
  return null;
}
