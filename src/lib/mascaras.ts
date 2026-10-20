// Máscaras dos campos de telefone, CPF, CNPJ e CEP: o que a pessoa digita (ou cola, com ou sem pontuação) vira o formato de leitura.
// Só dígitos entram; apagar volta sem sobrar pontuação no fim. Sem dependência de tela.

export type TipoMascara = "telefone" | "cpf" | "cnpj" | "cpfcnpj" | "cep";

export const somenteDigitos = (s: string) => s.replace(/\D/g, "");

/** (16) 3333-4444 ou (16) 99999-4444; número colado com +55 perde o 55. */
export function mascaraTelefone(valor: string): string {
  let d = somenteDigitos(valor);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  // 10 dígitos: fixo (4+4); 11: celular (5+4). Enquanto digita, o hífen entra depois do 4º ou do 5º dígito conforme o tamanho.
  const corte = d.length > 10 ? 5 : 4;
  return resto.length <= corte
    ? `(${ddd}) ${resto}`
    : `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

/** 000.000.000-00 */
export function mascaraCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  const partes = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean);
  const dv = d.slice(9);
  return partes.join(".") + (dv ? `-${dv}` : "");
}

/** Letras e números em maiúsculas: o CNPJ alfanumérico (a partir de 2026) tem letras nas 12 primeiras posições. */
const alfanumerico = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");

/** 00.000.000/0000-00; aceita letras nas 12 primeiras posições (CNPJ alfanumérico) e só números nos 2 dígitos verificadores. */
export function mascaraCnpj(valor: string): string {
  const bruto = alfanumerico(valor);
  let d = "";
  for (const c of bruto) {
    if (d.length >= 14) break;
    if (d.length >= 12 && !/\d/.test(c)) continue;
    d += c;
  }
  let s = d.slice(0, 2);
  if (d.length > 2) s += `.${d.slice(2, 5)}`;
  if (d.length > 5) s += `.${d.slice(5, 8)}`;
  if (d.length > 8) s += `/${d.slice(8, 12)}`;
  if (d.length > 12) s += `-${d.slice(12)}`;
  return s;
}

/** CPF (só números, até 11); com letra ou passando de 11 caracteres, vira CNPJ (campo "CNPJ ou CPF"). */
export function mascaraCpfCnpj(valor: string): string {
  const a = alfanumerico(valor);
  return /[A-Z]/.test(a) || a.length > 11 ? mascaraCnpj(valor) : mascaraCpf(valor);
}

/** 00000-000 */
export function mascaraCep(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function aplicarMascara(tipo: TipoMascara, valor: string): string {
  switch (tipo) {
    case "telefone":
      return mascaraTelefone(valor);
    case "cpf":
      return mascaraCpf(valor);
    case "cnpj":
      return mascaraCnpj(valor);
    case "cpfcnpj":
      return mascaraCpfCnpj(valor);
    case "cep":
      return mascaraCep(valor);
  }
}
