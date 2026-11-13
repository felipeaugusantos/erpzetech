import { z } from "zod";

export const excluirExameSchema = z.object({
  id: z.guid(),
  motivo: z.string().trim().min(1).max(500),
  confirmado: z.literal(true),
});

type ArquivoPendente = { id: string; caminho: string };
export async function limparArquivosExcluidos(
  arquivos: ArquivoPendente[],
  remover: (caminho: string) => Promise<boolean>,
  registrar: (id: string, sucesso: boolean) => Promise<void>,
) {
  let pendentes = 0;
  for (const arquivo of arquivos) {
    let sucesso = false;
    try { sucesso = await remover(arquivo.caminho); } catch { /* Keep durable retry row. */ }
    await registrar(arquivo.id, sucesso);
    if (!sucesso) pendentes++;
  }
  return { pendentes };
}