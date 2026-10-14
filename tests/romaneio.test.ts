import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dataDoRomaneio,
  htmlRomaneio,
  linhasRomaneio,
  totalRomaneio,
  type EntregaRomaneio,
  type ItemPedidoRomaneio,
} from "../src/lib/romaneio.ts";

const itens: ItemPedidoRomaneio[] = [
  {
    id: "i1",
    quantidade: 10,
    unidade: "sc",
    produtos: { descricao: "Cimento CP-II 50kg", codigo_interno: "CIM-50", localizacao: "A-01" },
  },
  { id: "i2", quantidade: 4, produtos: { descricao: "Areia <média>", unidade: "m³" } },
];

const entrega = (
  id: string,
  numero: number,
  situacao: string,
  data: string,
  its: [string, number][],
): EntregaRomaneio => ({
  id,
  numero,
  situacao,
  data_entrega: data,
  previsao_data: null,
  entrega_itens: its.map(([pedido_item_id, quantidade]) => ({ pedido_item_id, quantidade })),
});

const e1 = entrega("e1", 1, "entregue", "2026-10-01T12:00:00Z", [["i1", 4]]);
const e2 = entrega("e2", 2, "entregue", "2026-10-02T12:00:00Z", [
  ["i1", 4],
  ["i2", 4],
]);
const e3 = {
  ...entrega("e3", 3, "planejada", "2026-10-02T12:00:00Z", [["i1", 2]]),
  previsao_data: "2026-10-05",
};
const todas = [e1, e2, e3];

test("mostra o que já saiu antes, o que sai agora e o que falta depois", () => {
  const l = linhasRomaneio(e2, todas, itens);
  const cimento = l[0]!;
  assert.deepEqual([cimento.pedido, cimento.antes, cimento.nesta, cimento.saldo], [10, 4, 4, 2]);
  const areia = l[1]!;
  assert.deepEqual([areia.pedido, areia.antes, areia.nesta, areia.saldo], [4, 0, 4, 0]);
});

test("a primeira retirada não tem saída anterior", () => {
  const l = linhasRomaneio(e1, todas, itens);
  assert.deepEqual([l[0]!.antes, l[0]!.nesta, l[0]!.saldo], [0, 4, 6]);
});

test("entrega agendada considera tudo que já saiu e nada do que ainda está agendado", () => {
  const l = linhasRomaneio(e3, todas, itens);
  assert.deepEqual([l[0]!.antes, l[0]!.nesta, l[0]!.saldo], [8, 2, 0]);
});

test("entrega de outro pedido item desconhecido ou quantidade zero não entra", () => {
  const e = entrega("x", 9, "planejada", "2026-10-03T00:00:00Z", [
    ["nao-existe", 3],
    ["i1", 0],
  ]);
  assert.equal(linhasRomaneio(e, [e], itens).length, 0);
});

test("saldo nunca fica negativo", () => {
  const demais = entrega("d", 4, "planejada", "2026-10-03T00:00:00Z", [["i1", 9]]);
  assert.equal(linhasRomaneio(demais, [e1, e2, demais], itens)[0]!.saldo, 0);
});

test("totais do rodapé", () => {
  const t = totalRomaneio(linhasRomaneio(e2, todas, itens));
  assert.deepEqual(t, { itens: 2, quantidade: 8, pendente: 2 });
});

test("data: saída concluída usa a data da saída; agendada usa a previsão", () => {
  assert.equal(dataDoRomaneio(e2).rotulo, "Saída em");
  assert.deepEqual(dataDoRomaneio(e3), { rotulo: "Previsão", texto: "05/10/2026" });
  assert.equal(dataDoRomaneio({ ...e3, previsao_data: null }).texto, "sem data");
});

test("o romaneio impresso traz quantidade, item e data e escapa o texto", () => {
  const html = htmlRomaneio({
    loja: "Casa & Obra",
    pedidoNumero: 123,
    cliente: "Construtora <X>",
    obra: "Obra Centro",
    entrega: { ...e2, tipo: "retirada", recebedor: "João" },
    linhas: linhasRomaneio(e2, todas, itens),
  });
  assert.match(html, /Romaneio de retirada nº 0002/);
  assert.match(html, /Pedido 123/);
  assert.match(html, /Cimento CP-II 50kg/);
  assert.match(html, /Areia &lt;média&gt;/);
  assert.match(html, /Construtora &lt;X&gt;/);
  assert.match(html, /Casa &amp; Obra/);
  assert.match(html, /Saída em/);
  assert.match(html, /Recebido por:<\/b> João/);
  assert.doesNotMatch(html, /<média>/);
});
