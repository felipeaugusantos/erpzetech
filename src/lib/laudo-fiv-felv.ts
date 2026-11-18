export const RESULTADOS_TESTE = ["Positivo", "Negativo", "Inválido"] as const;
export type DadosFivFelv = {
  amostra: string; data: string; produto: string; lote: string; validade: string;
  fiv: string; felv: string; observacao: string;
};
export function corpoLaudoFivFelv(d: DadosFivFelv): string {
  if (![d.amostra, d.produto, d.lote, d.validade].every((v) => v.trim()) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.data) ||
      !RESULTADOS_TESTE.some((r) => r === d.fiv) || !RESULTADOS_TESTE.some((r) => r === d.felv))
    throw new Error("Preencha a amostra, data, produto, lote, validade e os dois resultados.");
  const [ano, mes, dia] = d.data.split("-");
  return [
    "INFORMAÇÕES SOBRE O TESTE",
    `Amostra utilizada: ${d.amostra.trim()}`,
    `Data de execução do teste: ${dia}/${mes}/${ano}`,
    `Produto: ${d.produto.trim()}`,
    `Lote: ${d.lote.trim()}     Validade: ${d.validade.trim()}`,
    "", "RESULTADO",
    `FIV: ${d.fiv}`, `FeLV: ${d.felv}`,
    ...(d.observacao.trim() ? ["", `Observações: ${d.observacao.trim()}`] : []),
  ].join("\n");
}