// Agenda de exames da clínica: situações e agrupamento por dia (horário de Brasília).
export type SituacaoAgendaExame = "agendado" | "coletado" | "resultado" | "cancelado" | "faltou";

export const SITUACOES_AGENDA_EXAME: Record<SituacaoAgendaExame, string> = {
  agendado: "Agendado",
  coletado: "Coletado",
  resultado: "Resultado pronto",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

const fmtDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

/** Dia (AAAA-MM-DD) em Brasília. */
export const diaBrasilia = (iso: string) => fmtDia.format(new Date(iso));
export const horaBrasilia = (iso: string) => fmtHora.format(new Date(iso));

/** Data e hora digitadas na tela (horário de Brasília, UTC-3) para ISO. */
export const isoDeBrasilia = (dia: string, hora: string) => `${dia}T${hora}:00-03:00`;

export function agruparPorDia<T extends { agendado_para: string }>(itens: T[]) {
  const mapa = new Map<string, T[]>();
  for (const i of itens) {
    const d = diaBrasilia(i.agendado_para);
    mapa.set(d, [...(mapa.get(d) ?? []), i]);
  }
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
}
