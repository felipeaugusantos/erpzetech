export const brl = (value: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));

export const num = (value: number | null | undefined, digits = 2) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));

export const dateBR = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("pt-BR") : "—";

export const dateTimeBR = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const initials = (name: string | null | undefined) =>
  (name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Ex.: 743 metros com fator 100 -> "7 ROLO + 43 M" */
export function formatConverted(
  quantity: number,
  unidade: string,
  unidadeCompra: string | null,
  fator: number | null,
) {
  const f = Number(fator ?? 1);
  if (!unidadeCompra || f <= 1) return `${num(quantity, 2)} ${unidade}`;
  const whole = Math.floor(quantity / f);
  const rest = Number((quantity - whole * f).toFixed(2));
  if (whole <= 0) return `${num(quantity, 2)} ${unidade}`;
  return rest > 0
    ? `${num(whole, 2)} ${unidadeCompra} + ${num(rest, 2)} ${unidade}`
    : `${num(whole, 2)} ${unidadeCompra}`;
}
