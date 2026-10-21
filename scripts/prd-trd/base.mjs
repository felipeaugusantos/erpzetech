// Peças comuns da geração do PRD e do TRD: estilo, ajudantes de HTML e geração do PDF (Chromium via Playwright).
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `texto` aceita **negrito** e `código`. */
export const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(
      /&lt;span class="sit ([a-z]*)"&gt;(.*?)&lt;\/span&gt;/g,
      '<span class="sit $1">$2</span>',
    );

export const h1 = (t) => `<h1>${esc(t)}</h1>`;
export const h2 = (t) => `<h2>${esc(t)}</h2>`;
export const p = (t) => `<p>${inline(t)}</p>`;
export const ul = (itens) => `<ul>${itens.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
export const ol = (itens) => `<ol>${itens.map((i) => `<li>${inline(i)}</li>`).join("")}</ol>`;
export const nota = (t) => `<div class="nota">${inline(t)}</div>`;

const SIT = {
  Implementado: "ok",
  Parcial: "parcial",
  "Em revisão": "revisao",
  Planejado: "plan",
  Bloqueado: "bloq",
};
export const sit = (s) => `<span class="sit ${SIT[s] ?? ""}">${esc(s)}</span>`;

/** Tabela genérica: cabeçalho e linhas de células (texto simples com **negrito** e `código`). */
export const tabela = (cab, linhas, larguras = []) =>
  `<table>${larguras.length ? `<colgroup>${larguras.map((l) => `<col style="width:${l}">`).join("")}</colgroup>` : ""}<thead><tr>${cab
    .map((c) => `<th>${esc(c)}</th>`)
    .join("")}</tr></thead><tbody>${linhas
    .map((l) => `<tr>${l.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

/** Tabela de requisitos: [id, texto, prioridade, situação]. A situação pode vir com a referência: "Em revisão · #94". */
export const requisitos = (linhas) =>
  `<table class="rf"><colgroup><col style="width:13%"><col><col style="width:9%"><col style="width:17%"></colgroup><thead><tr><th>ID</th><th>Requisito</th><th>Prioridade</th><th>Situação</th></tr></thead><tbody>${linhas
    .map(([id, t, pr, s]) => {
      const [nome, ref] = s.split(" · ");
      return `<tr><td class="id">${esc(id)}</td><td>${inline(t)}</td><td>${esc(pr)}</td><td>${sit(nome)}${ref ? `<br><span class="ref">${esc(ref)}</span>` : ""}</td></tr>`;
    })
    .join("")}</tbody></table>`;

export const capa = ({ titulo, subtitulo, linhas }) =>
  `<section class="capa"><p class="marca">ERP Ze Tech</p><h1 class="titulo">${esc(titulo)}</h1><p class="sub">${esc(subtitulo)}</p>${tabela(["", ""], linhas, ["25%", "75%"]).replace(/<thead>.*?<\/thead>/, "")}</section>`;

export const ESTILO = `
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Arial, "Liberation Sans", sans-serif; font-size: 10pt; line-height: 1.45; color: #1f2933; }
h1 { font-size: 19pt; margin: 0 0 8pt; color: #12355b; page-break-before: always; break-after: avoid; }
h1.titulo, .capa h1 { page-break-before: avoid; }
h2 { font-size: 12.5pt; margin: 16pt 0 6pt; color: #1b4f8a; break-after: avoid; }
h3 { font-size: 11pt; margin: 12pt 0 4pt; color: #1b4f8a; break-after: avoid; }
p { margin: 0 0 6pt; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin-bottom: 2pt; }
code { font-family: "DejaVu Sans Mono", Menlo, monospace; font-size: 8.8pt; background: #eef2f6; padding: 0 2pt; border-radius: 2pt; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9pt; }
th { text-align: left; background: #e7eef7; color: #12355b; padding: 4pt 5pt; border: 1px solid #c9d6e6; }
td { vertical-align: top; padding: 4pt 5pt; border: 1px solid #dbe3ee; }
tr { break-inside: avoid; }
td.id { font-family: "DejaVu Sans Mono", Menlo, monospace; font-size: 8.4pt; white-space: nowrap; }
.sit { display: inline-block; padding: 1pt 5pt; border-radius: 8pt; font-size: 8pt; font-weight: 600; white-space: nowrap; }
.sit.ok { background: #dff3e4; color: #1d6b34; }
.sit.parcial { background: #fff1d6; color: #8a5a00; }
.sit.revisao { background: #dfeafc; color: #1b4f8a; }
.sit.plan { background: #eceff3; color: #52606d; }
.sit.bloq { background: #fde0e0; color: #a12626; }
.ref { font-size: 7.8pt; color: #52606d; }
.nota { border-left: 3pt solid #1b4f8a; background: #f2f6fb; padding: 6pt 9pt; margin: 8pt 0; font-size: 9.3pt; }
.capa { margin-top: 70pt; }
.capa .marca { font-size: 13pt; color: #1b4f8a; font-weight: 700; margin-bottom: 4pt; }
.capa .titulo { font-size: 26pt; margin-bottom: 4pt; }
.capa .sub { font-size: 13pt; color: #52606d; margin-bottom: 30pt; }
.capa table td { font-size: 10pt; }
.capa table td:first-child { font-weight: 700; color: #12355b; width: 25%; }
.sumario li { margin-bottom: 1pt; }
`;

export async function gerar({ html, saida, rodape }) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = require(
      join(process.env["NODE_GLOBAL"] ?? "/opt/node22/lib/node_modules", "playwright"),
    ));
  }
  const arquivo = join(raiz, "docs", saida);
  mkdirSync(dirname(arquivo), { recursive: true });
  const navegador = await chromium.launch({ executablePath: process.env["CHROMIUM"] ?? undefined });
  const pagina = await navegador.newPage();
  await pagina.setContent(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(rodape)}</title><style>${ESTILO}</style></head><body>${html}</body></html>`,
  );
  const pdf = await pagina.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font-size:8px;color:#52606d;text-align:center;font-family:Arial,sans-serif;">${esc(rodape)} — página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  writeFileSync(arquivo, pdf);
  await navegador.close();
  return arquivo;
}
