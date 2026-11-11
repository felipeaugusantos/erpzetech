import { code128Svg } from "./code128.ts";
import { codigoComanda } from "./leitor-comanda.ts";

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export type EntradaTicketSenha = {
  loja?: string | null;
  senha: number;
  comanda: number;
  itens: { nome: string; quantidade: number; observacao?: string | null }[];
  emitidoEm: string;
};

/** Senha do pedido de balcão (bobina de 80 mm): número grande, itens e o código da comanda para o caixa. */
export function htmlTicketSenha(e: EntradaTicketSenha): string {
  const codigo = codigoComanda(e.comanda);
  const qtd = (n: number) => String(Number.isInteger(n) ? n : n.toLocaleString("pt-BR"));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Senha ${e.senha}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: Arial, sans-serif; width: 72mm; margin: 0 auto; text-align: center; color: #000; }
  p { margin: 2px 0; font-size: 13px; }
  .loja { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .rotulo { font-size: 14px; margin-top: 6px; }
  .senha { font-size: 72px; font-weight: bold; line-height: 1; margin: 2px 0 8px; }
  ul { list-style: none; padding: 0; margin: 6px 0; text-align: left; font-size: 14px; }
  li small { display: block; font-size: 11px; margin-left: 18px; }
  svg { max-width: 100%; height: auto; margin-top: 8px; }
  .codigo { font-family: monospace; font-size: 13px; }
  .nota { font-size: 11px; margin-top: 4px; }
</style></head><body>
  ${e.loja ? `<p class="loja">${escapar(e.loja)}</p>` : ""}
  <p class="rotulo">Sua senha</p>
  <p class="senha">${e.senha}</p>
  <ul>
    ${e.itens
      .map(
        (i) =>
          `<li>${qtd(i.quantidade)}× ${escapar(i.nome)}${i.observacao ? `<small>${escapar(i.observacao)}</small>` : ""}</li>`,
      )
      .join("\n    ")}
  </ul>
  ${code128Svg(codigo, { modulo: 2, altura: 50 })}
  <p class="codigo">${escapar(codigo)}</p>
  <p class="nota">Acompanhe pelo painel. Pagamento no caixa.</p>
  <p class="nota">${escapar(e.emitidoEm)}</p>
</body></html>`;
}
