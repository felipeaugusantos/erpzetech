export type ContagemPendencia = { chave: string; to: string; titulo: string; total: number };

/** Só mostra pendência de tela que a pessoa já vê no menu e que tem algo a fazer; ordem fixa. */
export function pendenciasVisiveis(
  contagens: ContagemPendencia[],
  telasPermitidas: string[],
): ContagemPendencia[] {
  const ok = new Set(telasPermitidas);
  return contagens.filter((c) => c.total > 0 && ok.has(c.to));
}

/** Data de 48 h atrás (orçamento parado). */
export function limiteOrcamentoParado(agora = new Date()): string {
  return new Date(agora.getTime() - 48 * 3600 * 1000).toISOString();
}
