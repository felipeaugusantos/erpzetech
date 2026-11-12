import { digitoEan13 } from "./ean.ts";

// Padrões de módulos (1 = barra) de cada dígito nos conjuntos A (L), B (G) e C (R) do EAN-13.
const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];
// Conjunto usado nos 6 dígitos da esquerda, definido pelo primeiro dígito.
const PARIDADE = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

export function ean13Valido(codigo: string): boolean {
  return /^\d{13}$/.test(codigo) && digitoEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

/** Módulos do EAN-13 (1 = barra, 0 = espaço), 95 no total, sem a zona de silêncio. */
export function ean13Modulos(codigo: string): string {
  if (!ean13Valido(codigo)) throw new Error("EAN-13 inválido");
  const d = [...codigo].map(Number);
  const par = PARIDADE[d[0]!]!;
  let m = "101";
  for (let i = 0; i < 6; i++) m += (par[i] === "L" ? L : G)[d[i + 1]!]!;
  m += "01010";
  for (let i = 7; i < 13; i++) m += R[d[i]!]!;
  return m + "101";
}

/**
 * SVG do EAN-13 em módulos (viewBox 95 × `altura`), sem tamanho fixo: quem usa define a largura em mm.
 * Sem os números (a etiqueta imprime o código por escrito em texto).
 */
export function ean13Svg(codigo: string, altura = 40): string {
  const m = ean13Modulos(codigo);
  let ret = "";
  for (let i = 0; i < m.length; ) {
    if (m[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (m[j] === "1") j++;
    ret += `<rect x="${i}" y="0" width="${j - i}" height="${altura}"/>`;
    i = j;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 95 ${altura}" preserveAspectRatio="none" fill="#000" shape-rendering="crispEdges" role="img" aria-label="Código de barras ${codigo}">${ret}</svg>`;
}
