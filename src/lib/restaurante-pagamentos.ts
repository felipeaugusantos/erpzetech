// Linhas de pagamento das telas do restaurante: formato digitado e o que vai para o banco.
export type LinhaPagamento = { forma: string; valor: string; pagante: string };

export const paraNumero = (v: string) => Number(v.replace(",", ".")) || 0;
export const paraTexto = (n: number) => n.toFixed(2).replace(".", ",");
export const linhaInicial = (): LinhaPagamento => ({ forma: "dinheiro", valor: "", pagante: "" });

/** Pagamentos preenchidos, no formato das funções do banco. */
export const pagamentosParaEnvio = (linhas: LinhaPagamento[]) =>
  linhas
    .filter((l) => paraNumero(l.valor) > 0)
    .map((l) => ({
      forma: l.forma,
      valor: paraNumero(l.valor),
      pagante: l.pagante.trim() || null,
    }));

/** Soma em reais, sem erro de ponto flutuante. */
export const somaPagamentos = (linhas: LinhaPagamento[]) =>
  Math.round(linhas.reduce((s, l) => s + paraNumero(l.valor), 0) * 100) / 100;
