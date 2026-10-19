// Quem envia cada tipo de operação da fila da clínica ao banco. Cada etapa do trabalho sem internet registra aqui os seus tipos
// (cadastro, atendimento, vacina, exame); a chave de repetição da operação vai junto, para a função do banco aceitar o reenvio.
import type { OperacaoFila } from "@/lib/fila-clinica";

export type Executor = (payload: unknown, chave: string) => Promise<void>;

export const EXECUTORES: Record<string, Executor> = {};

export async function enviarOperacao(op: OperacaoFila): Promise<void> {
  const executor = EXECUTORES[op.tipo];
  if (!executor)
    throw new Error(
      `Operação "${op.tipo}" desconhecida neste sistema: atualize a página e tente de novo`,
    );
  await executor(op.payload, op.id);
}
