// Código de barras Code 128 (conjunto B, ASCII 32 a 126), usado na etiqueta da comanda do restaurante.
// Cada padrão tem 6 larguras (barra, espaço, barra, espaço, barra, espaço) que somam 11 módulos; o final
// (parada) tem 7 larguras e soma 13.
const PADROES = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
];
const PARADA = "2331112";
const INICIO_B = 104;

/** Larguras alternadas (barra, espaço, ...) em módulos, começando por uma barra. */
export function code128Larguras(texto: string): number[] {
  if (texto.length === 0) throw new Error("Código vazio");
  const valores = [INICIO_B];
  for (const ch of texto) {
    const cod = ch.charCodeAt(0);
    if (cod < 32 || cod > 126) throw new Error(`Caractere não suportado no código: ${ch}`);
    valores.push(cod - 32);
  }
  // dígito verificador: início + soma(posição × valor), módulo 103
  const soma = valores.reduce((s, v, i) => s + (i === 0 ? v : v * i), 0);
  valores.push(soma % 103);
  const larguras: number[] = [];
  for (const v of valores) for (const d of PADROES[v]!) larguras.push(Number(d));
  for (const d of PARADA) larguras.push(Number(d));
  return larguras;
}

/** Mesmo código como sequência de módulos (1 = barra, 0 = espaço), útil para conferir e desenhar. */
export function code128Modulos(texto: string): string {
  let barra = true;
  let saida = "";
  for (const w of code128Larguras(texto)) {
    saida += (barra ? "1" : "0").repeat(w);
    barra = !barra;
  }
  return saida;
}

/** SVG do código de barras (módulo em pixels, com margem de 10 módulos nas laterais). */
export function code128Svg(
  texto: string,
  opcoes: { modulo?: number; altura?: number } = {},
): string {
  const modulo = opcoes.modulo ?? 2;
  const altura = opcoes.altura ?? 70;
  const larguras = code128Larguras(texto);
  const margem = 10 * modulo;
  let x = margem;
  let barra = true;
  let retangulos = "";
  for (const w of larguras) {
    if (barra) retangulos += `<rect x="${x}" y="0" width="${w * modulo}" height="${altura}"/>`;
    x += w * modulo;
    barra = !barra;
  }
  const largura = x + margem;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" fill="#000" shape-rendering="crispEdges" role="img" aria-label="Código de barras ${texto}">${retangulos}</svg>`;
}
