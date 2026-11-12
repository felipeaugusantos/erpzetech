import type { PontoEvolucao } from "./exames.ts";

/** Only earlier compatible records returned by the protected history RPC; current exam appears once. */
export function pontosDoLaudo(
  historico: readonly PontoEvolucao[],
  atual: PontoEvolucao,
): PontoEvolucao[] {
  const anteriores = [...new Map(historico
    .filter(p => p.exame_id !== atual.exame_id && p.data_coleta <= atual.data_coleta && Number.isFinite(p.valor))
    .map(p => [p.exame_id, p])).values()]
    .sort((a, b) => a.data_coleta.localeCompare(b.data_coleta) || a.exame_id.localeCompare(b.exame_id))
    .slice(-3);
  return anteriores.length && Number.isFinite(atual.valor) ? [...anteriores, atual] : [];
}