/**
 * O sistema é brasileiro: "hoje" e os horários mostrados são os de Brasília, e não os do aparelho ou
 * do servidor (que costuma estar em UTC, onde a partir das 21h de Brasília já é o dia seguinte).
 */
export const FUSO_HORARIO = "America/Sao_Paulo";

const formatadorDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_HORARIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data (AAAA-MM-DD) do instante informado, no fuso de Brasília. */
export function isoBrasilia(instante: Date = new Date()): string {
  return formatadorDia.format(instante);
}
