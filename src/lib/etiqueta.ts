import { code128Svg } from "./code128.ts";
import { ean13Svg, ean13Valido } from "./ean13.ts";

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Um tipo de etiqueta física. Térmica = um rótulo por página; folha = grade numa A4 (laser/jato). */
export type ModeloEtiqueta = {
  id: string;
  nome: string;
  tipo: "termica" | "folha";
  /** Tamanho de cada etiqueta, em mm. */
  larguraMm: number;
  alturaMm: number;
  /** Só folha: colunas, linhas e margens da folha, em mm. */
  colunas?: number;
  linhas?: number;
  margemSuperiorMm?: number;
  margemEsquerdaMm?: number;
  /** Espaço entre etiquetas (horizontal e vertical), em mm. */
  espacoHMm?: number;
  espacoVMm?: number;
};

export const MODELOS_ETIQUETA: ModeloEtiqueta[] = [
  { id: "t-40x25", nome: "Térmica 40 × 25 mm", tipo: "termica", larguraMm: 40, alturaMm: 25 },
  { id: "t-50x30", nome: "Térmica 50 × 30 mm", tipo: "termica", larguraMm: 50, alturaMm: 30 },
  { id: "t-60x40", nome: "Térmica 60 × 40 mm", tipo: "termica", larguraMm: 60, alturaMm: 40 },
  { id: "t-100x50", nome: "Térmica 100 × 50 mm", tipo: "termica", larguraMm: 100, alturaMm: 50 },
  {
    id: "f-3x10",
    nome: "Folha A4 — 3 × 10 (66,7 × 25,4 mm)",
    tipo: "folha",
    larguraMm: 66.7,
    alturaMm: 25.4,
    colunas: 3,
    linhas: 10,
    margemSuperiorMm: 12.7,
    margemEsquerdaMm: 4.7,
    espacoHMm: 2.5,
    espacoVMm: 0,
  },
  {
    id: "f-2x7",
    nome: "Folha A4 — 2 × 7 (99,1 × 38,1 mm)",
    tipo: "folha",
    larguraMm: 99.1,
    alturaMm: 38.1,
    colunas: 2,
    linhas: 7,
    margemSuperiorMm: 15.1,
    margemEsquerdaMm: 4.7,
    espacoHMm: 2.5,
    espacoVMm: 0,
  },
  {
    id: "f-3x7",
    nome: "Folha A4 — 3 × 7 (63,5 × 38,1 mm)",
    tipo: "folha",
    larguraMm: 63.5,
    alturaMm: 38.1,
    colunas: 3,
    linhas: 7,
    margemSuperiorMm: 15.1,
    margemEsquerdaMm: 7.2,
    espacoHMm: 2.5,
    espacoVMm: 0,
  },
];

export const modeloEtiqueta = (id: string): ModeloEtiqueta | undefined =>
  MODELOS_ETIQUETA.find((m) => m.id === id);

export type DadosEtiqueta = {
  descricao: string;
  /** EAN-13 válido sai como EAN-13; qualquer outro texto imprimível sai como Code 128. */
  codigo?: string | null;
  preco?: number | null;
  unidade?: string | null;
  validade?: string | null;
  lote?: string | null;
  /** Quantas vias imprimir (1 a 500). */
  copias?: number;
};

export type OpcoesEtiqueta = {
  mostrarPreco?: boolean;
  mostrarCodigo?: boolean;
  /** Só folha: quantas posições já usadas da primeira folha ficam em branco (etiqueta parcial reaproveitada). */
  pular?: number;
};

export const precoEtiqueta = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function svgDoCodigo(codigo: string, altura: number): string {
  const c = codigo.trim();
  if (ean13Valido(c)) return ean13Svg(c, altura);
  return code128Svg(c, { modulo: 1, altura }).replace(
    /width="\d+" height="\d+"/,
    'preserveAspectRatio="none"',
  );
}

/** Código que dá para desenhar (Code 128 aceita ASCII 32 a 126). */
const desenhavel = (c: string) => c.length > 0 && /^[\x20-\x7e]+$/.test(c);

function corpoEtiqueta(m: ModeloEtiqueta, d: DadosEtiqueta, o: OpcoesEtiqueta): string {
  const pequena = m.alturaMm < 30;
  const codigo = (d.codigo ?? "").trim();
  const barras = o.mostrarCodigo !== false && desenhavel(codigo);
  const extras = [d.validade && `Val ${d.validade}`, d.lote && `Lote ${d.lote}`]
    .filter(Boolean)
    .join(" · ");
  const alturaBarras = Math.max(6, m.alturaMm * (pequena ? 0.3 : 0.32));
  return `<div class="e${pequena ? " p" : ""}">
  <div class="desc">${escapar(d.descricao)}</div>
  ${extras ? `<div class="ext">${escapar(extras)}</div>` : ""}
  ${o.mostrarPreco !== false && d.preco != null ? `<div class="preco">${escapar(precoEtiqueta(d.preco))}${d.unidade ? `<small> / ${escapar(d.unidade)}</small>` : ""}</div>` : ""}
  ${barras ? `<div class="cod" style="height:${alturaBarras.toFixed(1)}mm">${svgDoCodigo(codigo, 40)}</div><div class="num">${escapar(codigo)}</div>` : ""}
</div>`;
}

const ESTILO_ETIQUETA = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; color: #000; }
  .e { width: 100%; height: 100%; padding: 1.2mm 1.5mm; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; text-align: center; }
  .desc { font-size: 9pt; font-weight: 700; line-height: 1.1; max-height: 2.3em; overflow: hidden; }
  .ext { font-size: 7pt; }
  .preco { font-size: 14pt; font-weight: 800; line-height: 1; }
  .preco small { font-size: 7pt; font-weight: 400; }
  .cod { width: 80%; margin: 0 auto; }
  .cod svg { width: 100%; height: 100%; display: block; }
  .num { font-family: monospace; font-size: 7pt; line-height: 1; }
  .p .desc { font-size: 7pt; max-height: 2.2em; }
  .p .preco { font-size: 11pt; }
  .p .ext, .p .num { font-size: 6pt; }`;

/** Expande as vias de cada item numa lista de etiquetas (limite de 500 por item). */
export function expandirEtiquetas(itens: DadosEtiqueta[]): DadosEtiqueta[] {
  const saida: DadosEtiqueta[] = [];
  for (const i of itens) {
    const n = Math.min(500, Math.max(1, Math.floor(i.copias ?? 1)));
    for (let k = 0; k < n; k++) saida.push(i);
  }
  return saida;
}

/**
 * Página de impressão das etiquetas. Térmica: uma etiqueta por página, no tamanho do rolo (o driver da
 * impressora precisa estar com o mesmo tamanho). Folha: grade A4 com as medidas do modelo, para laser/jato.
 */
export function htmlEtiquetas(
  modelo: ModeloEtiqueta,
  itens: DadosEtiqueta[],
  opcoes: OpcoesEtiqueta = {},
): string {
  const lista = expandirEtiquetas(itens);
  if (lista.length === 0) throw new Error("Nenhuma etiqueta para imprimir");
  const titulo = "Etiquetas";
  if (modelo.tipo === "termica") {
    const paginas = lista
      .map((d) => `<section class="pg">${corpoEtiqueta(modelo, d, opcoes)}</section>`)
      .join("");
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title><style>
  @page { size: ${modelo.larguraMm}mm ${modelo.alturaMm}mm; margin: 0; }
  ${ESTILO_ETIQUETA}
  .pg { width: ${modelo.larguraMm}mm; height: ${modelo.alturaMm}mm; page-break-after: always; break-after: page; overflow: hidden; }
  .pg:last-child { page-break-after: auto; break-after: auto; }
</style></head><body>${paginas}</body></html>`;
  }
  const colunas = modelo.colunas ?? 1;
  const linhas = modelo.linhas ?? 1;
  const porFolha = colunas * linhas;
  const pular = Math.min(Math.max(0, Math.floor(opcoes.pular ?? 0)), porFolha - 1);
  const celulas: (DadosEtiqueta | null)[] = [...Array(pular).fill(null), ...lista];
  const folhas: string[] = [];
  for (let i = 0; i < celulas.length; i += porFolha) {
    const grupo = celulas.slice(i, i + porFolha);
    folhas.push(
      `<section class="folha">${grupo
        .map((d) => `<div class="cel">${d ? corpoEtiqueta(modelo, d, opcoes) : ""}</div>`)
        .join("")}</section>`,
    );
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title><style>
  @page { size: A4 portrait; margin: 0; }
  ${ESTILO_ETIQUETA}
  .folha { width: 210mm; height: 297mm; padding: ${modelo.margemSuperiorMm ?? 0}mm 0 0 ${modelo.margemEsquerdaMm ?? 0}mm; display: grid;
    grid-template-columns: repeat(${colunas}, ${modelo.larguraMm}mm); grid-auto-rows: ${modelo.alturaMm}mm;
    column-gap: ${modelo.espacoHMm ?? 0}mm; row-gap: ${modelo.espacoVMm ?? 0}mm; align-content: start;
    page-break-after: always; break-after: page; overflow: hidden; }
  .folha:last-child { page-break-after: auto; break-after: auto; }
  .cel { width: ${modelo.larguraMm}mm; height: ${modelo.alturaMm}mm; overflow: hidden; }
</style></head><body>${folhas.join("")}</body></html>`;
}
