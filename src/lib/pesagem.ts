// Pesagem do restaurante (balança). As regras de verdade ficam no banco (restaurante_pesagem_calcular);
// aqui ficam a conta de pré-visualização — mesma regra, em gramas e centavos inteiros — e os textos.

export type EntradaPesagem = {
  brutoG: number;
  taraG: number;
  /** preço do KG, em reais */
  precoKg: number;
  /** teto do buffet livre, em reais (ausente = sem teto) */
  buffetLivre?: number | null;
};

export type ResultadoPesagem = {
  liquidoG: number;
  valorSemTeto: number;
  valor: number;
  tetoAplicado: boolean;
};

const centavos = (reais: number) => Math.round((reais + Number.EPSILON) * 100);

/** Peso líquido × preço do KG, arredondado no centavo (meio centavo para cima, como o numeric do banco). */
export function calcularPesagem(e: EntradaPesagem): ResultadoPesagem | null {
  const liquidoG = Math.round(e.brutoG) - Math.round(e.taraG);
  if (!Number.isFinite(liquidoG) || liquidoG < 1) return null;
  const semTeto = Math.floor((liquidoG * centavos(e.precoKg) + 500) / 1000);
  const teto = e.buffetLivre != null && e.buffetLivre > 0 ? centavos(e.buffetLivre) : null;
  const tetoAplicado = teto !== null && semTeto > teto;
  return {
    liquidoG,
    valorSemTeto: semTeto / 100,
    valor: (tetoAplicado ? teto : semTeto) / 100,
    tetoAplicado,
  };
}

/** "1,250 kg" a partir de gramas. */
export const kgTexto = (g: number) =>
  `${(g / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;

/**
 * Peso digitado ou vindo da balança (que "digita" como um teclado) em gramas.
 * Em kg aceita "0,850", "0.850" e "1,25"; em gramas, só número inteiro ("850").
 */
export function pesoEmGramas(texto: string, unidade: "g" | "kg"): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  const g = unidade === "kg" ? Math.round(n * 1000) : Math.round(n);
  return g >= 1 && g <= 30000 ? g : null;
}
