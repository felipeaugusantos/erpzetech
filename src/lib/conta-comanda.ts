import { calcularConta } from "./restaurante.ts";

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const brl = (n: number) =>
  `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type ItemConta = { nome: string; quantidade: number; total: number; opcoes?: string[] };

/**
 * Como o serviço aparece na conta:
 * - "opcional": ainda não decidido (conta para conferência); mostra o total sem e com o serviço;
 * - "cobrado" / "dispensado": decisão do cliente no fechamento.
 */
export type SituacaoServico = "opcional" | "cobrado" | "dispensado";

export type EntradaContaImpressa = {
  numero: number;
  mesa?: string | null;
  cliente?: string | null;
  loja?: string | null;
  itens: ItemConta[];
  pessoas: number | null;
  couvertPorPessoa: number;
  taxaServicoPercentual: number;
  servico: SituacaoServico;
  desconto?: number;
  jaPago?: number;
  /** texto da data e hora da impressão */
  emitidaEm: string;
};

/** Valores da conta impressa; o serviço é sempre calculado pela mesma regra do fechamento. */
export function valoresContaImpressa(e: EntradaContaImpressa) {
  const base = {
    subtotal: e.itens.reduce((s, i) => s + i.total, 0),
    pessoas: e.pessoas,
    couvertPorPessoa: e.couvertPorPessoa,
    taxaServicoPercentual: e.taxaServicoPercentual,
    desconto: e.desconto ?? 0,
    jaPago: e.jaPago ?? 0,
  };
  const sem = calcularConta({ ...base, cobrarServico: false });
  const com = calcularConta({ ...base, cobrarServico: true });
  const final = e.servico === "cobrado" ? com : sem;
  return { sem, com, final };
}

/** Página de impressão da conta da comanda (sem valor fiscal), com o serviço opcional destacado. */
export function htmlContaComanda(e: EntradaContaImpressa): string {
  const { sem, com, final } = valoresContaImpressa(e);
  const pct = String(e.taxaServicoPercentual).replace(".", ",");
  const linhas = e.itens
    .map(
      (i) =>
        `<tr><td>${i.quantidade}x ${escapar(i.nome)}${
          i.opcoes?.length ? `<br><small>${escapar(i.opcoes.join(", "))}</small>` : ""
        }</td><td class="v">${brl(i.total)}</td></tr>`,
    )
    .join("");
  const linha = (rotulo: string, valor: number, forte = false) =>
    `<tr${forte ? ' class="forte"' : ""}><td>${rotulo}</td><td class="v">${brl(valor)}</td></tr>`;

  let resumo = linha("Consumo", sem.subtotal);
  if (sem.couvert > 0)
    resumo += linha(`Couvert artístico (${e.pessoas} x ${brl(e.couvertPorPessoa)})`, sem.couvert);
  if (final.desconto > 0) resumo += linha("Desconto", -final.desconto);

  if (e.servico === "opcional") {
    resumo += linha("Total sem serviço", sem.total, true);
    resumo += linha(`Serviço ${pct}% (opcional)`, com.servico);
    resumo += linha("Total com serviço", com.total, true);
  } else if (e.servico === "cobrado") {
    resumo += linha(`Serviço ${pct}%`, com.servico);
    resumo += linha("Total", com.total, true);
  } else {
    resumo += `<tr><td>Serviço ${pct}%</td><td class="v">não cobrado</td></tr>`;
    resumo += linha("Total", sem.total, true);
  }
  if (final.jaPago > 0) {
    resumo += linha("Já recebido", -final.jaPago);
    resumo += linha("A pagar", final.restante, true);
  }

  const total = e.servico === "cobrado" ? com : sem;
  const porPessoa =
    e.pessoas && e.pessoas > 1
      ? `<p class="pp">${e.pessoas} pessoas${
          e.servico === "opcional"
            ? ` — por pessoa: ${brl(Math.floor((sem.restante / e.pessoas) * 100) / 100)} sem serviço, ${brl(
                Math.floor((com.restante / e.pessoas) * 100) / 100,
              )} com serviço`
            : ` — por pessoa: ${brl(Math.floor((total.restante / e.pessoas) * 100) / 100)}`
        }</p>`
      : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conta da comanda ${e.numero}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: Arial, sans-serif; width: 72mm; margin: 0 auto; color: #000; font-size: 13px; }
  h1 { font-size: 20px; margin: 6px 0 0; text-align: center; }
  p { margin: 2px 0; }
  .c { text-align: center; }
  .loja { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  td { padding: 2px 0; vertical-align: top; }
  td.v { text-align: right; white-space: nowrap; padding-left: 8px; }
  tr.forte td { font-weight: bold; border-top: 1px solid #000; padding-top: 4px; }
  small { color: #333; }
  .pp { margin-top: 8px; font-size: 12px; }
  .rodape { margin-top: 10px; font-size: 11px; text-align: center; }
</style></head><body>
  ${e.loja ? `<p class="c loja">${escapar(e.loja)}</p>` : ""}
  <h1>Conta — comanda ${e.numero}</h1>
  <p class="c">${e.mesa ? `Mesa ${escapar(e.mesa)}` : "Comanda avulsa"}${e.cliente ? ` — ${escapar(e.cliente)}` : ""}</p>
  <p class="c">${escapar(e.emitidaEm)}</p>
  <table>${linhas}</table>
  <table>${resumo}</table>
  ${porPessoa}
  <p class="rodape">${
    e.servico === "opcional" ? `O serviço de ${pct}% é opcional: pague com ou sem ele.<br>` : ""
  }Documento para conferência, sem valor fiscal.</p>
</body></html>`;
}
