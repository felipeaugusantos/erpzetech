/** Dados informados na aplicação, sem criar lote nem saldo de estoque. */
export function dadosLoteManual(lote: string, validade: string, aplicadaEm: string) {
  const nome = lote.trim();
  if (!nome) throw new Error("Informe o lote da vacina");
  if (nome.length > 120) throw new Error("O lote deve ter até 120 caracteres");
  const data = new Date(`${validade}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(validade) ||
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== validade
  )
    throw new Error("Informe um vencimento válido");
  if (validade < aplicadaEm) throw new Error("O lote está vencido na data da aplicação");
  return { lote: nome, validade_lote: validade };
}
