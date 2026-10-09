import { code128Svg } from "./code128.ts";
import { codigoComanda } from "./leitor-comanda.ts";

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Página de impressão da etiqueta da comanda: número, mesa e código de barras que o leitor do PDV reconhece. */
export function htmlEtiquetaComanda(e: {
  numero: number;
  mesa?: string | null;
  cliente?: string | null;
  loja?: string | null;
}): string {
  const codigo = codigoComanda(e.numero);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comanda ${e.numero}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: Arial, sans-serif; width: 72mm; margin: 0 auto; text-align: center; color: #000; }
  h1 { font-size: 34px; margin: 6px 0 0; }
  p { margin: 2px 0; font-size: 14px; }
  .loja { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  svg { max-width: 100%; height: auto; margin-top: 8px; }
  .codigo { font-family: monospace; font-size: 13px; }
</style></head><body>
  ${e.loja ? `<p class="loja">${escapar(e.loja)}</p>` : ""}
  <h1>Comanda ${e.numero}</h1>
  ${e.mesa ? `<p>Mesa ${escapar(e.mesa)}</p>` : ""}
  ${e.cliente ? `<p>${escapar(e.cliente)}</p>` : ""}
  ${code128Svg(codigo, { modulo: 2, altura: 60 })}
  <p class="codigo">${escapar(codigo)}</p>
</body></html>`;
}
