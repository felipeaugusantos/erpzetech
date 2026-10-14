// Romaneio de uma entrega ou retirada: o que sai, quanto, em que data e o que ainda falta do pedido.
// Serve para imprimir, conferir na doca e assinar quem leva.
import { dateBR, dateTimeBR, num } from "./format.ts";

export type ItemPedidoRomaneio = {
  id: string;
  quantidade: number;
  unidade?: string | null;
  produtos?: {
    descricao?: string | null;
    codigo_interno?: string | null;
    unidade?: string | null;
    localizacao?: string | null;
  } | null;
};

export type EntregaRomaneio = {
  id: string;
  numero: number | null;
  tipo?: string | null;
  situacao: string;
  data_entrega: string;
  previsao_data: string | null;
  endereco_entrega?: string | null;
  responsavel?: string | null;
  recebedor?: string | null;
  observacao?: string | null;
  entrega_itens?: { pedido_item_id: string; quantidade: number }[] | null;
};

export type LinhaRomaneio = {
  codigo: string;
  descricao: string;
  unidade: string;
  localizacao: string;
  /** Quanto o pedido tem deste item. */
  pedido: number;
  /** O que já tinha saído em entregas concluídas antes desta. */
  antes: number;
  /** O que sai nesta entrega. */
  nesta: number;
  /** O que ainda falta sair do pedido depois desta entrega. */
  saldo: number;
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const arred = (v: number) => Math.round(v * 1000) / 1000;

/** Entrega concluída e que veio antes de `alvo` (data e, no empate, número). */
function veioAntes(outra: EntregaRomaneio, alvo: EntregaRomaneio): boolean {
  if (outra.id === alvo.id || outra.situacao !== "entregue") return false;
  if (alvo.situacao !== "entregue") return true;
  const a = new Date(outra.data_entrega).getTime();
  const b = new Date(alvo.data_entrega).getTime();
  if (a !== b) return a < b;
  return n(outra.numero) < n(alvo.numero);
}

/** Uma linha por item da entrega, com o saldo do pedido antes e depois dela. */
export function linhasRomaneio(
  entrega: EntregaRomaneio,
  entregasDoPedido: EntregaRomaneio[],
  itens: ItemPedidoRomaneio[],
): LinhaRomaneio[] {
  const anteriores = entregasDoPedido.filter((e) => veioAntes(e, entrega));
  const linhas: LinhaRomaneio[] = [];
  for (const ei of entrega.entrega_itens ?? []) {
    const item = itens.find((i) => i.id === ei.pedido_item_id);
    if (!item || n(ei.quantidade) <= 0) continue;
    const antes = anteriores.reduce(
      (soma, e) =>
        soma +
        (e.entrega_itens ?? [])
          .filter((x) => x.pedido_item_id === item.id)
          .reduce((s, x) => s + n(x.quantidade), 0),
      0,
    );
    const pedido = n(item.quantidade);
    const nesta = n(ei.quantidade);
    linhas.push({
      codigo: item.produtos?.codigo_interno ?? "",
      descricao: item.produtos?.descricao ?? "—",
      unidade: item.unidade ?? item.produtos?.unidade ?? "",
      localizacao: item.produtos?.localizacao ?? "",
      pedido,
      antes: arred(antes),
      nesta: arred(nesta),
      saldo: arred(Math.max(pedido - antes - nesta, 0)),
    });
  }
  return linhas;
}

/** O que ainda falta do pedido inteiro depois desta saída, inclusive dos itens que não estão nela. */
export function pendenteDoPedido(
  entrega: EntregaRomaneio,
  entregasDoPedido: EntregaRomaneio[],
  itens: ItemPedidoRomaneio[],
): number {
  const anteriores = entregasDoPedido.filter((e) => veioAntes(e, entrega));
  const soma = (lista: EntregaRomaneio[], itemId: string) =>
    lista.reduce(
      (t, e) =>
        t +
        (e.entrega_itens ?? [])
          .filter((x) => x.pedido_item_id === itemId)
          .reduce((s, x) => s + n(x.quantidade), 0),
      0,
    );
  return arred(
    itens.reduce(
      (t, i) => t + Math.max(n(i.quantidade) - soma(anteriores, i.id) - soma([entrega], i.id), 0),
      0,
    ),
  );
}

/** Totais do rodapé: quantos itens, quanto sai nesta entrega e quanto ainda falta do pedido. */
export function totalRomaneio(linhas: LinhaRomaneio[]) {
  return {
    itens: linhas.length,
    quantidade: arred(linhas.reduce((s, l) => s + l.nesta, 0)),
    pendente: arred(linhas.reduce((s, l) => s + l.saldo, 0)),
  };
}

const SITUACAO: Record<string, string> = {
  planejada: "Agendada",
  em_rota: "Em rota",
  entregue: "Concluída",
  insucesso: "Não entregue",
  cancelada: "Cancelada",
};

/** Data que vale para o romaneio: a da saída, se já saiu; senão a previsão. */
export function dataDoRomaneio(e: EntregaRomaneio): { rotulo: string; texto: string } {
  if (e.situacao === "entregue") return { rotulo: "Saída em", texto: dateTimeBR(e.data_entrega) };
  return { rotulo: "Previsão", texto: e.previsao_data ? dateBR(e.previsao_data) : "sem data" };
}

const escapar = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export type DadosRomaneio = {
  loja?: string | null;
  pedidoNumero: number | string | null;
  cliente: string;
  obra?: string | null;
  endereco?: string | null;
  entrega: EntregaRomaneio;
  linhas: LinhaRomaneio[];
  /** Falta do pedido inteiro (com os itens que não estão nesta saída); sem isso, soma só as linhas. */
  pendentePedido?: number;
};

/** Romaneio em A4 pronto para imprimir: itens, quantidades, data, saldo do pedido e assinaturas. */
export function htmlRomaneio(d: DadosRomaneio): string {
  const e = d.entrega;
  const tipo = e.tipo === "retirada" ? "Retirada" : "Entrega";
  const numero = String(e.numero ?? "").padStart(4, "0");
  const data = dataDoRomaneio(e);
  const total = totalRomaneio(d.linhas);
  const endereco = e.endereco_entrega || d.endereco || "";
  const corpo = d.linhas
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td><td>${escapar(l.codigo)}</td><td>${escapar(l.descricao)}${
          l.localizacao ? `<br><small>Local: ${escapar(l.localizacao)}</small>` : ""
        }</td><td class="c">${escapar(l.unidade)}</td><td class="v">${num(l.pedido, 3)}</td><td class="v">${num(l.antes, 3)}</td><td class="v forte">${num(l.nesta, 3)}</td><td class="v">${num(l.saldo, 3)}</td><td class="c caixa">☐</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Romaneio ${tipo} ${numero}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: #000; font-size: 12px; margin: 0; }
  h1 { font-size: 20px; margin: 0; }
  .topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .loja { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .dados { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-bottom: 10px; }
  .dados p { margin: 1px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #555; padding: 4px 5px; vertical-align: top; }
  th { background: #eee; font-size: 11px; text-align: left; }
  td.v, th.v { text-align: right; white-space: nowrap; }
  td.c, th.c { text-align: center; }
  td.forte { font-weight: bold; font-size: 13px; }
  td.caixa { font-size: 18px; line-height: 1; }
  small { color: #333; }
  tfoot td { font-weight: bold; background: #f6f6f6; }
  .obs { margin-top: 8px; border: 1px solid #555; padding: 6px; min-height: 28px; }
  .ass { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 36px; }
  .ass div { border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 11px; }
  .rodape { margin-top: 14px; font-size: 10px; color: #444; }
</style></head><body>
  <div class="topo">
    <div>
      ${d.loja ? `<div class="loja">${escapar(d.loja)}</div>` : ""}
      <h1>Romaneio de ${tipo.toLowerCase()} nº ${numero}</h1>
    </div>
    <div style="text-align:right">
      <div><b>Pedido ${escapar(String(d.pedidoNumero ?? "—"))}</b></div>
      <div>${escapar(data.rotulo)}: <b>${escapar(data.texto)}</b></div>
      <div>${escapar(SITUACAO[e.situacao] ?? e.situacao)}</div>
    </div>
  </div>
  <div class="dados">
    <p><b>Cliente:</b> ${escapar(d.cliente)}</p>
    <p><b>Obra:</b> ${escapar(d.obra ?? "—")}</p>
    <p><b>Endereço:</b> ${escapar(endereco || "Retirada na loja")}</p>
    <p><b>Responsável na obra:</b> ${escapar(e.responsavel ?? "—")}</p>
    ${e.recebedor ? `<p><b>Recebido por:</b> ${escapar(e.recebedor)}</p>` : ""}
  </div>
  <table>
    <thead><tr>
      <th class="c">#</th><th>Código</th><th>Item</th><th class="c">Un.</th>
      <th class="v">Pedido</th><th class="v">Já saiu</th><th class="v">Nesta saída</th><th class="v">Falta depois</th><th class="c">Conf.</th>
    </tr></thead>
    <tbody>${corpo}</tbody>
    <tfoot><tr><td colspan="6">${total.itens} ${total.itens === 1 ? "item" : "itens"}</td><td class="v">${num(total.quantidade, 3)}</td><td class="v">${num(d.pendentePedido ?? total.pendente, 3)}</td><td></td></tr></tfoot>
  </table>
  <div class="obs"><b>Observações:</b> ${escapar(e.observacao ?? "")}</div>
  <div class="ass"><div>Separado por</div><div>Conferido por</div><div>Recebido por (nome, documento, data)</div></div>
  <p class="rodape">Falta depois = o que ainda resta do pedido depois desta saída; o total do rodapé inclui os itens que não estão nesta saída. Marque a coluna Conf. ao conferir cada item na doca.</p>
</body></html>`;
}
