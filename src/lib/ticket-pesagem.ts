import { code128Svg } from "./code128.ts";
import { codigoComanda } from "./leitor-comanda.ts";
import { kgTexto } from "./pesagem.ts";

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type EntradaTicketPesagem = {
  loja?: string | null;
  comanda: number;
  item: string;
  brutoG: number;
  taraG: number;
  taraNome?: string | null;
  liquidoG: number;
  precoKg: number;
  valor: number;
  tetoBuffet: boolean;
  emitidoEm: string;
};

/** Ticket do prato pesado (bobina de 80 mm): peso, tara, valor e o código de barras da comanda para o caixa bipar. */
export function htmlTicketPesagem(e: EntradaTicketPesagem): string {
  const codigo = codigoComanda(e.comanda);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pesagem — comanda ${e.comanda}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: Arial, sans-serif; width: 72mm; margin: 0 auto; text-align: center; color: #000; }
  p { margin: 2px 0; font-size: 13px; }
  .loja { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  h1 { font-size: 26px; margin: 4px 0; }
  .valor { font-size: 34px; font-weight: bold; margin: 8px 0; }
  table { width: 100%; font-size: 13px; border-collapse: collapse; margin-top: 6px; }
  td { padding: 1px 0; text-align: left; } td + td { text-align: right; }
  svg { max-width: 100%; height: auto; margin-top: 8px; }
  .codigo { font-family: monospace; font-size: 13px; }
  .nota { font-size: 11px; margin-top: 4px; }
</style></head><body>
  ${e.loja ? `<p class="loja">${escapar(e.loja)}</p>` : ""}
  <h1>Comanda ${e.comanda}</h1>
  <p>${escapar(e.item)}</p>
  <table>
    <tr><td>Peso bruto</td><td>${kgTexto(e.brutoG)}</td></tr>
    <tr><td>Tara${e.taraNome ? ` (${escapar(e.taraNome)})` : ""}</td><td>- ${kgTexto(e.taraG)}</td></tr>
    <tr><td>Peso líquido</td><td>${kgTexto(e.liquidoG)}</td></tr>
    <tr><td>Preço do kg</td><td>${brl(e.precoKg)}</td></tr>
  </table>
  <p class="valor">${brl(e.valor)}</p>
  ${e.tetoBuffet ? `<p class="nota">Valor limitado ao preço do buffet livre</p>` : ""}
  ${code128Svg(codigo, { modulo: 2, altura: 60 })}
  <p class="codigo">${escapar(codigo)}</p>
  <p class="nota">${escapar(e.emitidoEm)}</p>
</body></html>`;
}
