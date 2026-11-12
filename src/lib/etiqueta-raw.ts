import { code128Larguras } from "./code128.ts";
import { ean13Valido } from "./ean13.ts";
import {
  desenhavel,
  precoEtiqueta,
  type DadosEtiqueta,
  type ModeloEtiqueta,
  type OpcoesEtiqueta,
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

function zplEtiqueta(
  modelo: ModeloEtiqueta,
  d: DadosEtiqueta,
  imp: ImpressoraEtiqueta,
  o: OpcoesEtiqueta,
): string {
  const { W, H, d: pt, m, pequena } = medidas(modelo, imp);
  const util = W - 2 * m;
  const hd = Math.round((pequena ? 2.6 : 3.2) * pt);
  const l: string[] = ["^XA", "^CI28", `^PW${W}`, `^LL${H}`, "^LH0,0"];
  let y = m;
  l.push(`^FO${m},${y}^A0N,${hd},${hd}^FB${util},2,0,C,0^FD${limpar(d.descricao, "zpl")}^FS`);
  y += Math.round(hd * 2.2);
  const extra = textoExtra(d);
  if (extra) {
    const he = Math.round(hd * 0.8);
    l.push(`^FO${m},${y}^A0N,${he},${he}^FB${util},1,0,C,0^FD${limpar(extra, "zpl")}^FS`);
    y += Math.round(he * 1.2);
  }
  if (o.mostrarPreco !== false && d.preco != null) {
    const hp = Math.round((pequena ? 4 : 5) * pt);
    const txt = precoEtiqueta(d.preco) + (d.unidade ? ` / ${d.unidade}` : "");
    l.push(`^FO${m},${y}^A0N,${hp},${hp}^FB${util},1,0,C,0^FD${limpar(txt, "zpl")}^FS`);
    y += Math.round(hp * 1.15);
  }
  const cb = o.mostrarCodigo === false ? null : codigoDeBarras(d.codigo);
  if (cb) {
    const modulos = cb.tipo === "ean13" ? 95 : code128Larguras(cb.valor).reduce((a, b) => a + b, 0);
    const mod = moduloQueCabe(util, modulos, imp);
    const altura = Math.max(Math.round(4 * pt), H - y - m - Math.round(3.5 * pt));
    const x = Math.max(0, Math.round((W - modulos * mod) / 2));
    const cmd = cb.tipo === "ean13" ? `^BEN,${altura},Y,N` : `^BCN,${altura},Y,N,N`;
    l.push(`^BY${mod}`, `^FO${x},${y}${cmd}^FD${cb.valor}^FS`);
  }
  l.push(`^PQ${qtd(d)},0,1,N`, "^XZ");
  return l.join("\n");
}

function tsplEtiqueta(
  modelo: ModeloEtiqueta,
  d: DadosEtiqueta,
  imp: ImpressoraEtiqueta,
  o: OpcoesEtiqueta,
): string {
  const { W, H, d: pt, m, pequena } = medidas(modelo, imp);
  const util = W - 2 * m;
  // Fontes internas 3 (16×24) e 4 (24×32) em pontos; centralizamos calculando a largura do texto.
  const centro = (txt: string, larguraChar: number) =>
    Math.max(m, Math.round((W - txt.length * larguraChar) / 2));
  const l: string[] = [
    `SIZE ${modelo.larguraMm} mm,${modelo.alturaMm} mm`,
    "GAP 2 mm,0 mm",
    "DIRECTION 1",
    "CODEPAGE 1252",
    "CLS",
  ];
  let y = m;
  for (const linha of quebrarTexto(limpar(d.descricao, "tspl"), Math.floor(util / 16), 2)) {
    l.push(`TEXT ${centro(linha, 16)},${y},"3",0,1,1,"${linha}"`);
    y += 26;
  }
  const extra = limpar(textoExtra(d), "tspl");
  if (extra) {
    const t = extra.slice(0, Math.floor(util / 16));
    l.push(`TEXT ${centro(t, 16)},${y},"3",0,1,1,"${t}"`);
    y += 26;
  }
  if (o.mostrarPreco !== false && d.preco != null) {
    const txt = limpar(precoEtiqueta(d.preco) + (d.unidade ? ` / ${d.unidade}` : ""), "tspl");
    const t = txt.slice(0, Math.floor(util / 24));
    l.push(`TEXT ${centro(t, 24)},${y},"4",0,1,1,"${t}"`);
    y += pequena ? 34 : 36;
  }
  const cb = o.mostrarCodigo === false ? null : codigoDeBarras(d.codigo);
  if (cb) {
    const modulos = cb.tipo === "ean13" ? 95 : code128Larguras(cb.valor).reduce((a, b) => a + b, 0);
    const mod = moduloQueCabe(util, modulos, imp);
    const altura = Math.max(Math.round(4 * pt), H - y - m - Math.round(3.5 * pt));
    const x = Math.max(0, Math.round((W - modulos * mod) / 2));
    const tipo = cb.tipo === "ean13" ? "EAN13" : "128";
    l.push(`BARCODE ${x},${y},"${tipo}",${altura},1,0,${mod},${mod * 2},"${cb.valor}"`);
  }
  l.push(`PRINT ${qtd(d)},1`);
  return l.join("\r\n");
}

/** Texto dos comandos (ZPL ou TSPL) para imprimir direto na térmica: uma etiqueta por item, com `^PQ`/`PRINT` para as vias. */
export function comandosEtiquetas(
  modelo: ModeloEtiqueta,
  itens: DadosEtiqueta[],
  imp: ImpressoraEtiqueta,
  opcoes: OpcoesEtiqueta = {},
): string {
  if (itens.length === 0) throw new Error("Nenhuma etiqueta para imprimir");
  const f = imp.linguagem === "zpl" ? zplEtiqueta : tsplEtiqueta;
  const sep = imp.linguagem === "zpl" ? "\n" : "\r\n";
  return itens.map((i) => f(modelo, i, imp, opcoes)).join(sep) + sep;
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
