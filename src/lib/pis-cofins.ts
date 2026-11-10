// PIS e COFINS na NF-e: o grupo do XML depende do CST (tabela de CST da NF-e), e o valor sai da base e da
// alíquota. Regras puras, sem rede nem banco. O PIS e a COFINS usam a mesma tabela de CST e a mesma estrutura.

export type Tributo = "PIS" | "COFINS";
export type GrupoCst = "Aliq" | "Qtde" | "NT" | "Outr";

const NT = ["04", "05", "06", "07", "08", "09"];
const OUTR = [
  "49",
  "50", "51", "52", "53", "54", "55", "56",
  "60", "61", "62", "63", "64", "65", "66", "67",
  "70", "71", "72", "73", "74", "75",
  "98", "99",
]; // prettier-ignore

/** Grupo do XML para o CST, ou null se o CST não existe na tabela. */
export function grupoDoCst(cst: unknown): GrupoCst | null {
  const c = String(cst ?? "").trim();
  if (c === "01" || c === "02") return "Aliq";
  if (c === "03") return "Qtde";
  if (NT.includes(c)) return "NT";
  if (OUTR.includes(c)) return "Outr";
  return null;
}

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export type EntradaTributo = {
  /** CST informado no item (ou o padrão da configuração fiscal). */
  cst: unknown;
  /** Base de cálculo do item. */
  base: number;
  /** Alíquota em percentual (ex.: 1,65). */
  aliquota: number;
};

/**
 * Grupo `PIS`/`COFINS` do item e o valor que ele leva (para somar nos totais da nota).
 * - CST 01/02: tributável por alíquota (vBC, p, v);
 * - CST 04 a 09: não tributado/isento/suspenso etc., só o CST e valor 0;
 * - demais CSTs válidos (49, 50 a 56, 60 a 67, 70 a 75, 98, 99): "Outras operações", com base e alíquota;
 * - CST 03 (alíquota por unidade) não é suportado: o cadastro não tem a quantidade nem a alíquota em reais,
 *   e emitir errado é pior que recusar.
 */
export function grupoPisCofins(
  tributo: Tributo,
  e: EntradaTributo,
): { grupo: Record<string, unknown>; valor: number } {
  const cst = String(e.cst ?? "").trim();
  const g = grupoDoCst(cst);
  if (!g)
    throw new Error(
      `CST de ${tributo} inválido: "${cst}". Corrija no produto ou na configuração fiscal.`,
    );
  if (g === "Qtde") {
    throw new Error(
      `CST 03 de ${tributo} (alíquota em reais por unidade) ainda não é suportado. Use outro CST ou emita fora do sistema.`,
    );
  }
  const chave = (sufixo: string) => `${tributo}${sufixo}`;
  if (g === "NT") return { grupo: { [chave("NT")]: { CST: cst } }, valor: 0 };

  const base = arred(Number(e.base) || 0);
  const aliquota = Number(e.aliquota) || 0;
  const valor = arred((base * aliquota) / 100);
  const campoAliquota = tributo === "PIS" ? "pPIS" : "pCOFINS";
  const campoValor = tributo === "PIS" ? "vPIS" : "vCOFINS";
  const corpo = { CST: cst, vBC: base, [campoAliquota]: aliquota, [campoValor]: valor };
  return { grupo: { [chave(g === "Aliq" ? "Aliq" : "Outr")]: corpo }, valor };
}
