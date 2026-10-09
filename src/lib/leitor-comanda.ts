// Leitor do PDV do restaurante: o operador bipa o código de barras da comanda ou digita o número da mesa.
// O leitor USB age como um teclado: digita o código e aperta Enter.
//   C123      → comanda número 123 (é o que a etiqueta impressa leva no código de barras)
//   12, M12   → mesa 12
//   Varanda   → mesa com esse nome
export type Leitura =
  { tipo: "vazio" } | { tipo: "comanda"; numero: number } | { tipo: "mesa"; numero: string };

/** Texto que vai no código de barras da etiqueta da comanda. */
export const codigoComanda = (numero: number) => `C${numero}`;

export function interpretarLeitura(texto: string): Leitura {
  const t = texto.trim();
  if (!t) return { tipo: "vazio" };
  const comanda = t.match(/^C\s*0*(\d{1,12})$/i);
  if (comanda) {
    const n = Number(comanda[1]);
    return n > 0 ? { tipo: "comanda", numero: n } : { tipo: "vazio" };
  }
  const mesaComPrefixo = t.match(/^M(?:ESA)?\s*(\d{1,6})$/i);
  if (mesaComPrefixo) return { tipo: "mesa", numero: mesaComPrefixo[1]! };
  return { tipo: "mesa", numero: t };
}

const semZeros = (s: string) => (/^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s.toLowerCase());

/** Acha a mesa pelo número digitado: "05" e "5" são a mesma mesa; nomes não diferenciam maiúsculas. */
export function acharMesa<T extends { numero: string }>(
  mesas: T[],
  digitado: string,
): T | undefined {
  const alvo = semZeros(digitado.trim());
  return mesas.find((m) => semZeros(m.numero.trim()) === alvo);
}
