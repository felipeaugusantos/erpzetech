// Cópia de consulta da visita (o que o veterinário baixa antes de sair): tipos, validade e resumo. A cópia vence; a fila de pendências não.

export const VALIDADE_COPIA_DIAS = 7;

export type CopiaVisita = {
  /** Quando o servidor gerou a cópia. */
  geradaEm: string;
  /** Até quando ela vale no notebook. */
  validaAte: string;
  dados: {
    de: string;
    ate: string;
    veterinario: { id: string; nome: string; crmv: string; crmv_uf: string };
    agenda: unknown[];
    catalogo_vacinas: { lotes?: unknown[] }[];
    modelos_exame: unknown[];
    aplicadores: unknown[];
  };
};

export function validadeDaCopia(geradaEm: Date): string {
  return new Date(geradaEm.getTime() + VALIDADE_COPIA_DIAS * 86_400_000).toISOString();
}

export function copiaVencida(
  copia: Pick<CopiaVisita, "validaAte">,
  agora: Date = new Date(),
): boolean {
  return new Date(copia.validaAte).getTime() <= agora.getTime();
}

export function resumoDaCopia(copia: CopiaVisita) {
  const d = copia.dados;
  return {
    consultas: d.agenda.length,
    vacinas: d.catalogo_vacinas.length,
    lotes: d.catalogo_vacinas.reduce((n, v) => n + (v.lotes?.length ?? 0), 0),
    modelos: d.modelos_exame.length,
  };
}
