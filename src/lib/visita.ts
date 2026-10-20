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
    /** Serviços de consulta, para atender sem consulta marcada (cópias antigas não trazem). */
    servicos_consulta?: unknown[];
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

export type TutorDaCopia = { id: string; nome: string; telefone: string | null };

/** Tutores da agenda baixada, sem repetir, em ordem de nome (para o cadastro rápido de outro pet de um tutor que já existe). */
export function tutoresDaCopia(copia: Pick<CopiaVisita, "dados">): TutorDaCopia[] {
  const vistos = new Map<string, TutorDaCopia>();
  for (const item of copia.dados.agenda) {
    const t = (item as { tutor?: { id?: unknown; nome?: unknown; telefone?: unknown } } | null)
      ?.tutor;
    if (!t || typeof t.id !== "string" || typeof t.nome !== "string" || vistos.has(t.id)) continue;
    vistos.set(t.id, {
      id: t.id,
      nome: t.nome,
      telefone: typeof t.telefone === "string" ? t.telefone : null,
    });
  }
  return [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
