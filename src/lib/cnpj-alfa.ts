// CNPJ alfanumérico (Receita, 2026): 12 primeiras posições com 0-9 ou A-Z e 2 dígitos verificadores numéricos.
// Arquivo à parte, sem dependências, para os testes rodarem no Node.

/** Deixa só letras e números, em maiúsculas (11.ABC.123/0001-45 → 11ABC12300014 5 sem espaços). */
export function limparDocumento(valor: string): string {
  return (valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

const pesos12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const pesos13 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Valor do caractere no cálculo do dígito: código ASCII − 48 (0-9 → 0-9, A-Z → 17-42). */
const valorChar = (c: string) => c.charCodeAt(0) - 48;

function dv(base: string): number {
  const pesos = base.length === 12 ? pesos12 : pesos13;
  const soma = [...base].reduce((s, c, i) => s + valorChar(c) * (pesos[i] ?? 0), 0);
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Valida CNPJ numérico ou alfanumérico, com ou sem máscara. */
export function cnpjAlfaValido(valor: string): boolean {
  const c = limparDocumento(valor);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return false;
  if (/^(.)\1{13}$/.test(c)) return false;
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

/** Tem 14 caracteres (números ou letras) — critério de "empresa com CNPJ". */
export const temCnpj = (valor?: string | null) => limparDocumento(valor ?? "").length >= 14;
