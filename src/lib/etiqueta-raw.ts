import { code128Larguras } from "./code128.ts";
import { ean13Valido } from "./ean13.ts";
import {
  camposDoModelo,
  desenhavel,
  fatorDoCampo,
  precoEtiqueta,
  type CampoEtiqueta,
  type DadosEtiqueta,
  type ModeloEtiqueta,
  type OpcoesEtiqueta,
  type TamanhoCampo,
} from "./etiqueta.ts";

/** Linguagem de comando da impressora térmica. Argox em modo PPLZ aceita ZPL; as Argox/TSC novas aceitam TSPL. */
export type LinguagemEtiqueta = "zpl" | "tspl";
export type ImpressoraEtiqueta = { linguagem: LinguagemEtiqueta; dpi: 203 | 300 };

export const LINGUAGENS_ETIQUETA: { id: LinguagemEtiqueta; nome: string; extensao: string }[] = [
  { id: "zpl", nome: "ZPL (Zebra; Argox em modo PPLZ)", extensao: "zpl" },
  { id: "tspl", nome: "TSPL (Argox e TSC novas)", extensao: "prn" },
];

const MARGEM_MM = 2;
const LIMITE_COPIAS = 500;

/** Remove o que a linguagem trataria como comando e quebra de linha. */
function limpar(texto: string, linguagem: LinguagemEtiqueta): string {
  const t = texto.replace(/[\r\n\t]+/g, " ");
  return linguagem === "zpl" ? t.replace(/[\^~]/g, " ") : t.replace(/"/g, "'");
}

/** Código que dá para imprimir como barras: EAN-13 válido ou texto ASCII que a linguagem não interpreta. */
function codigoDeBarras(
  c: string | null | undefined,
): { tipo: "ean13" | "code128"; valor: string } | null {
  const v = (c ?? "").trim();
  if (ean13Valido(v)) return { tipo: "ean13", valor: v };
  if (desenhavel(v) && !/[\^~"]/.test(v)) return { tipo: "code128", valor: v };
  return null;
}

/** Quebra em até `max` linhas de `colunas` caracteres, sem partir palavra (a última linha é cortada). */
export function quebrarTexto(texto: string, colunas: number, max: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const junto = atual ? `${atual} ${palavra}` : palavra;
    if (junto.length <= colunas) {
      atual = junto;
      continue;
    }
    if (atual) linhas.push(atual);
    atual = palavra.slice(0, colunas);
    if (linhas.length === max) break;
  }
  if (atual && linhas.length < max) linhas.push(atual);
  return linhas.slice(0, max);
}

type Medidas = {
  W: number;
  H: number;
  d: number; // pontos por mm
  m: number; // margem
  pequena: boolean;
};

function medidas(modelo: ModeloEtiqueta, imp: ImpressoraEtiqueta): Medidas {
  if (modelo.tipo !== "termica") {
    throw new Error("Impressão direta só vale para etiqueta térmica; a folha A4 sai pelo driver.");
  }
  const d = imp.dpi / 25.4;
  return {
    W: Math.round(modelo.larguraMm * d),
    H: Math.round(modelo.alturaMm * d),
    d,
    m: Math.round(MARGEM_MM * d),
    pequena: modelo.alturaMm < 30,
  };
}

/** Módulo (largura da barra mais fina, em pontos) que cabe em ~85% da etiqueta. */
function moduloQueCabe(largura: number, modulos: number, imp: ImpressoraEtiqueta): number {
  const maximo = imp.dpi >= 300 ? 5 : 4;
  return Math.max(1, Math.min(maximo, Math.floor((largura * 0.85) / modulos)));
}

const qtd = (d: DadosEtiqueta) => Math.min(LIMITE_COPIAS, Math.max(1, Math.floor(d.copias ?? 1)));

function textoExtra(d: DadosEtiqueta) {
  return [d.validade && `Val ${d.validade}`, d.lote && `Lote ${d.lote}`].filter(Boolean).join(" ");
}

/** Altura (em pontos) que cada campo ocupa; o código de barras fica com o que sobrar. */
type Bloco = { c: CampoEtiqueta; altura: number; texto: string };

/** Quanto as letras encolhem a cada passo quando o conteúdo não cabe (ZPL: fator; TSPL: degraus de fonte). */
const FATOR_REDUCAO = [1, 0.8, 0.65];
type Gerado = { texto: string; cabe: boolean };

function zplEtiqueta(
  modelo: ModeloEtiqueta,
  d: DadosEtiqueta,
  imp: ImpressoraEtiqueta,
  o: OpcoesEtiqueta,
  reducao = 0,
): Gerado {
  const { W, H, d: pt, m, pequena } = medidas(modelo, imp);
  const util = W - 2 * m;
  const hd = Math.round((pequena ? 2.6 : 3.2) * pt);
  const cb = o.mostrarCodigo === false ? null : codigoDeBarras(d.codigo);
  const extra = textoExtra(d);
  const mostraPreco = o.mostrarPreco !== false && d.preco != null;
  const campos = camposDoModelo(modelo);
  const blocos: Bloco[] = [];
  let usado = 0;
  for (const c of campos) {
    const f = fatorDoCampo(c) * FATOR_REDUCAO[reducao]!;
    let b: Bloco | null = null;
    if (c.campo === "descricao") {
      const h = Math.round(hd * f);
      b = {
        c,
        altura: Math.round(h * 2.2),
        texto: `^A0N,${h},${h}^FB${util},2,0,C,0^FD${limpar(d.descricao, "zpl")}^FS`,
      };
    } else if (c.campo === "extra" && extra) {
      const h = Math.round(hd * 0.8 * f);
      b = {
        c,
        altura: Math.round(h * 1.2),
        texto: `^A0N,${h},${h}^FB${util},1,0,C,0^FD${limpar(extra, "zpl")}^FS`,
      };
    } else if (c.campo === "preco" && mostraPreco) {
      const h = Math.round((pequena ? 4 : 5) * pt * f);
      const txt = precoEtiqueta(d.preco!) + (d.unidade ? ` / ${d.unidade}` : "");
      b = {
        c,
        altura: Math.round(h * 1.15),
        texto: `^A0N,${h},${h}^FB${util},1,0,C,0^FD${limpar(txt, "zpl")}^FS`,
      };
    } else if (c.campo === "codigo" && cb) {
      b = { c, altura: 0, texto: "" };
    }
    if (b) {
      blocos.push(b);
      usado += b.altura;
    }
  }
  const l: string[] = ["^XA", "^CI28", `^PW${W}`, `^LL${H}`, "^LH0,0"];
  let y = m;
  let cabe = true;
  for (const b of blocos) {
    if (b.c.campo !== "codigo") {
      l.push(`^FO${m},${y}${b.texto}`);
      y += b.altura;
      continue;
    }
    const modulos =
      cb!.tipo === "ean13" ? 95 : code128Larguras(cb!.valor).reduce((a, n) => a + n, 0);
    const mod = moduloQueCabe(util, modulos, imp);
    // o código de barras ocupa o que sobra, deixando a linha com o número e o que vem depois
    const sobra = H - m - usado - m - Math.round(3.5 * pt);
    const altura = Math.max(Math.round(4 * pt), sobra);
    if (sobra < Math.round(4 * pt)) cabe = false;
    const x = Math.max(0, Math.round((W - modulos * mod) / 2));
    const cmd = cb!.tipo === "ean13" ? `^BEN,${altura},Y,N` : `^BCN,${altura},Y,N,N`;
    l.push(`^BY${mod}`, `^FO${x},${y}${cmd}^FD${cb!.valor}^FS`);
    y += altura + Math.round(3.5 * pt);
  }
  if (y > H - m) cabe = false;
  l.push(`^PQ${qtd(d)},0,1,N`, "^XZ");
  return { texto: l.join("\n"), cabe };
}

// Fontes internas das TSPL: largura e altura de cada uma, em pontos.
const FONTES_TSPL = { "2": [12, 20], "3": [16, 24], "4": [24, 32], "5": [32, 48] } as const;
type FonteTspl = keyof typeof FONTES_TSPL;
const ORDEM_FONTES: FonteTspl[] = ["2", "3", "4", "5"];
/** Tamanho p/m/g do campo → fonte, a partir da fonte média de cada tipo de campo. */
const fonteTspl = (base: FonteTspl, t: TamanhoCampo = "m", reducao = 0): FonteTspl =>
  ORDEM_FONTES[
    Math.min(
      ORDEM_FONTES.length - 1,
      Math.max(0, ORDEM_FONTES.indexOf(base) + (t === "p" ? -1 : t === "g" ? 1 : 0) - reducao),
    )
  ]!;

function tsplEtiqueta(
  modelo: ModeloEtiqueta,
  d: DadosEtiqueta,
  imp: ImpressoraEtiqueta,
  o: OpcoesEtiqueta,
  reducao = 0,
): Gerado {
  const { W, H, d: pt, m } = medidas(modelo, imp);
  const util = W - 2 * m;
  const centro = (txt: string, larguraChar: number) =>
    Math.max(m, Math.round((W - txt.length * larguraChar) / 2));
  const cb = o.mostrarCodigo === false ? null : codigoDeBarras(d.codigo);
  const extra = limpar(textoExtra(d), "tspl");
  const mostraPreco = o.mostrarPreco !== false && d.preco != null;
  const humano = Math.round(3.5 * pt);
  // 1ª passada: o que cada campo ocupa, para o código de barras saber o que sobra
  type Linha = { x: number; y: number; fonte: FonteTspl; txt: string };
  const itens: ({ c: CampoEtiqueta; linhas: Linha[]; altura: number } | null)[] = [];
  let usado = 0;
  for (const c of camposDoModelo(modelo)) {
    let base: FonteTspl | null = null;
    let textos: string[] = [];
    if (c.campo === "descricao") {
      base = "3";
      const [lw] = FONTES_TSPL[fonteTspl(base, c.tamanho, reducao)];
      textos = quebrarTexto(limpar(d.descricao, "tspl"), Math.floor(util / lw), 2);
    } else if (c.campo === "extra" && extra) {
      base = "3";
      textos = [extra];
    } else if (c.campo === "preco" && mostraPreco) {
      base = "4";
      textos = [limpar(precoEtiqueta(d.preco!) + (d.unidade ? ` / ${d.unidade}` : ""), "tspl")];
    } else if (c.campo === "codigo" && cb) {
      itens.push({ c, linhas: [], altura: 0 });
      continue;
    }
    if (!base || textos.length === 0) continue;
    const fonte = fonteTspl(base, c.tamanho, reducao);
    const [lw, lh] = FONTES_TSPL[fonte];
    const linhas = textos.map((t) => {
      const cortado = t.slice(0, Math.floor(util / lw));
      return { x: centro(cortado, lw), y: 0, fonte, txt: cortado };
    });
    const altura = linhas.length * (lh + 2);
    itens.push({ c, linhas, altura });
    usado += altura;
  }
  const l: string[] = [
    `SIZE ${modelo.larguraMm} mm,${modelo.alturaMm} mm`,
    "GAP 2 mm,0 mm",
    "DIRECTION 1",
    "CODEPAGE 1252",
    "CLS",
  ];
  let y = m;
  let cabe = true;
  for (const it of itens) {
    if (!it) continue;
    if (it.c.campo !== "codigo") {
      const [, lh] = FONTES_TSPL[it.linhas[0]!.fonte];
      for (const ln of it.linhas) {
        l.push(`TEXT ${ln.x},${y},"${ln.fonte}",0,1,1,"${ln.txt}"`);
        y += lh + 2;
      }
      continue;
    }
    const modulos =
      cb!.tipo === "ean13" ? 95 : code128Larguras(cb!.valor).reduce((a, n) => a + n, 0);
    const mod = moduloQueCabe(util, modulos, imp);
    const sobra = H - m - usado - m - humano;
    const altura = Math.max(Math.round(4 * pt), sobra);
    if (sobra < Math.round(4 * pt)) cabe = false;
    const x = Math.max(0, Math.round((W - modulos * mod) / 2));
    const tipo = cb!.tipo === "ean13" ? "EAN13" : "128";
    l.push(`BARCODE ${x},${y},"${tipo}",${altura},1,0,${mod},${mod * 2},"${cb!.valor}"`);
    y += altura + humano;
  }
  if (y > H - m) cabe = false;
  l.push(`PRINT ${qtd(d)},1`);
  return { texto: l.join("\r\n"), cabe };
}

/** Gera a etiqueta; se não couber, encolhe as letras (até 2 passos) e devolve o primeiro que couber, ou o menor. */
function gerar(
  modelo: ModeloEtiqueta,
  d: DadosEtiqueta,
  imp: ImpressoraEtiqueta,
  o: OpcoesEtiqueta,
): Gerado {
  const f = imp.linguagem === "zpl" ? zplEtiqueta : tsplEtiqueta;
  let g = f(modelo, d, imp, o, 0);
  for (let r = 1; !g.cabe && r < FATOR_REDUCAO.length; r++) g = f(modelo, d, imp, o, r);
  return g;
}

/** Diz, para cada item, se o conteúdo cabe no tamanho do modelo (mesmo encolhendo as letras). */
export function cabeNaEtiqueta(
  modelo: ModeloEtiqueta,
  itens: DadosEtiqueta[],
  imp: ImpressoraEtiqueta,
  opcoes: OpcoesEtiqueta = {},
): boolean[] {
  return itens.map((i) => gerar(modelo, i, imp, opcoes).cabe);
}

/** Texto dos comandos (ZPL ou TSPL) para imprimir direto na térmica: uma etiqueta por item, com `^PQ`/`PRINT` para as vias. */
export function comandosEtiquetas(
  modelo: ModeloEtiqueta,
  itens: DadosEtiqueta[],
  imp: ImpressoraEtiqueta,
  opcoes: OpcoesEtiqueta = {},
): string {
  if (itens.length === 0) throw new Error("Nenhuma etiqueta para imprimir");
  const sep = imp.linguagem === "zpl" ? "\n" : "\r\n";
  return itens.map((i) => gerar(modelo, i, imp, opcoes).texto).join(sep) + sep;
}

/** Bytes a enviar: ZPL em UTF-8 (usa `^CI28`); TSPL em Windows-1252 (usa `CODEPAGE 1252`), o resto vira `?`. */
export function bytesEtiquetas(texto: string, linguagem: LinguagemEtiqueta): Uint8Array {
  if (linguagem === "zpl") return new TextEncoder().encode(texto);
  const cp1252: Record<string, number> = {
    "€": 0x80,
    "–": 0x96,
    "—": 0x97,
    "‘": 0x91,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "•": 0x95,
  };
  return Uint8Array.from(
    [...texto].map((c) => {
      const cod = c.codePointAt(0)!;
      return cod < 256 ? cod : (cp1252[c] ?? 0x3f);
    }),
  );
}
