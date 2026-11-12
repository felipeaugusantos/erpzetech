/**
 * Leitura de balança pela porta serial (RS-232 ou USB serial) sem depender do navegador: separar o que a balança
 * manda em quadros, achar o peso em cada quadro e só aceitar quando o peso parou. Cada fabricante manda de um
 * jeito, então o formato é configurável e a tela de teste mostra os dados crus para ajustar no cliente.
 */

export type FormatoPeso = "decimal" | "inteiro";
export type ComandoPeso = "nenhum" | "enq";
export type UnidadePeso = "kg" | "g";

export type ConfigBalanca = {
  baudRate: number;
  paridade: "none" | "even" | "odd";
  /** "decimal": o quadro traz o número com ponto ou vírgula (1,250). "inteiro": só dígitos, com `casas` decimais implícitas (001250 → 1,250). */
  formato: FormatoPeso;
  casas: number;
  unidade: UnidadePeso;
  /** "enq": pede o peso a cada leitura mandando o caractere ENQ (0x05); "nenhum": a balança transmite sozinha. */
  comando: ComandoPeso;
  /** Quantas leituras iguais seguidas contam como peso parado. */
  estavel: number;
};

export const CONFIG_BALANCA_PADRAO: ConfigBalanca = {
  baudRate: 9600,
  paridade: "none",
  formato: "decimal",
  casas: 3,
  unidade: "kg",
  comando: "nenhum",
  estavel: 3,
};

export const BAUDS_BALANCA = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;
export const PESO_MAXIMO_LEITURA_G = 30_000;

/** Confere e limpa uma configuração vinda do armazenamento do navegador; o que não valer volta ao padrão. */
export function lerConfigBalanca(bruto: unknown): ConfigBalanca {
  const p = CONFIG_BALANCA_PADRAO;
  const o = (typeof bruto === "object" && bruto !== null ? bruto : {}) as Record<string, unknown>;
  const num = (v: unknown, padrao: number, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : padrao;
  return {
    baudRate: (BAUDS_BALANCA as readonly number[]).includes(o["baudRate"] as number)
      ? (o["baudRate"] as number)
      : p.baudRate,
    paridade: ["none", "even", "odd"].includes(o["paridade"] as string)
      ? (o["paridade"] as ConfigBalanca["paridade"])
      : p.paridade,
    formato: o["formato"] === "inteiro" ? "inteiro" : p.formato,
    casas: num(o["casas"], p.casas, 0, 4),
    unidade: o["unidade"] === "g" ? "g" : p.unidade,
    comando: o["comando"] === "enq" ? "enq" : p.comando,
    estavel: num(o["estavel"], p.estavel, 2, 10),
  };
}

// LF, CR, STX e ETX
const TERMINADORES = new Set([10, 13, 2, 3]);
function indiceDoTerminador(texto: string): number {
  for (let i = 0; i < texto.length; i++) if (TERMINADORES.has(texto.charCodeAt(i))) return i;
  return -1;
}

/** Junta os pedaços que chegam da porta e entrega cada quadro completo (terminado por CR, LF, STX ou ETX). */
export class ExtratorDeQuadros {
  private resto = "";
  private readonly limite: number;
  /** Sem nenhum terminador, um quadro com mais que isto é entregue como está (balança que não termina a linha). */
  constructor(limite = 64) {
    this.limite = limite;
  }

  empurrar(texto: string): string[] {
    const quadros: string[] = [];
    let acumulado = this.resto + texto;
    for (;;) {
      const i = indiceDoTerminador(acumulado);
      if (i < 0) break;
      const q = acumulado.slice(0, i);
      if (q.trim() !== "") quadros.push(q);
      acumulado = acumulado.slice(i + 1);
    }
    if (acumulado.length > this.limite) {
      quadros.push(acumulado);
      acumulado = "";
    }
    this.resto = acumulado;
    return quadros;
  }
}

/** Mostra caracteres de controle de um jeito legível: `<STX>001250<ETX>`. */
export function quadroVisivel(texto: string): string {
  const nomes: Record<number, string> = {
    2: "STX",
    3: "ETX",
    5: "ENQ",
    10: "LF",
    13: "CR",
    6: "ACK",
    21: "NAK",
  };
  return [...texto]
    .map((c) => {
      const n = c.charCodeAt(0);
      if (n >= 32 && n < 127) return c;
      return `<${nomes[n] ?? `0x${n.toString(16).toUpperCase().padStart(2, "0")}`}>`;
    })
    .join("");
}

/** Peso do quadro em gramas inteiros; null se não achar um número válido (zero, negativo ou acima do limite não valem). */
export function pesoDoQuadro(
  quadro: string,
  c: Pick<ConfigBalanca, "formato" | "casas" | "unidade">,
): number | null {
  let valor: number;
  if (c.formato === "inteiro") {
    const m = /\d{2,}/.exec(quadro);
    if (!m) return null;
    valor = Number(m[0]) / 10 ** c.casas;
  } else {
    // número com ponto ou vírgula; um "-" colado antes é peso negativo (tara) e não vale
    const m = /(-?)(\d+(?:[.,]\d+)?)/.exec(quadro);
    if (!m || m[1] === "-") return null;
    valor = Number(m[2]!.replace(",", "."));
  }
  if (!Number.isFinite(valor)) return null;
  const g = Math.round(c.unidade === "kg" ? valor * 1000 : valor);
  return g >= 1 && g <= PESO_MAXIMO_LEITURA_G ? g : null;
}

/** Diz quando o peso parou: `n` leituras iguais seguidas (qualquer leitura diferente ou inválida reinicia a contagem). */
export class EstabilizadorDePeso {
  private ultimo: number | null = null;
  private seguidas = 0;
  private readonly n: number;
  constructor(n: number) {
    this.n = n;
  }

  /** Devolve o peso em gramas quando ele estabilizou; null enquanto não. Leitura inválida (null) zera a contagem. */
  ler(pesoG: number | null): number | null {
    if (pesoG == null) {
      this.ultimo = null;
      this.seguidas = 0;
      return null;
    }
    this.seguidas = pesoG === this.ultimo ? this.seguidas + 1 : 1;
    this.ultimo = pesoG;
    return this.seguidas >= this.n ? pesoG : null;
  }
}

/** "0,850" (o que o campo de peso das etiquetas espera). */
export const pesoParaCampo = (g: number) =>
  (g / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
    useGrouping: false,
  });
