import { z } from "zod";

/** Um serviço só gera item de cobrança quando escolhido explicitamente. */
export function dadosServicoCobrado(servicoId: string) {
  const id = servicoId.trim();
  return id ? { servico_id: z.guid().parse(id) } : {};
}

/** Dados informados na aplicação, sem criar lote nem saldo de estoque. */
export function dadosLoteManual(lote: string, validade: string, aplicadaEm: string) {
  const nome = lote.trim();
  if (nome.length > 120) throw new Error("O lote deve ter até 120 caracteres");
  if (!validade.trim()) return { lote: nome || null, validade_lote: null };
  const data = new Date(`${validade}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(validade) ||
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== validade
  )
    throw new Error("Informe um vencimento válido");
  if (validade < aplicadaEm) throw new Error("O lote está vencido na data da aplicação");
  return { lote: nome || null, validade_lote: validade };
}
