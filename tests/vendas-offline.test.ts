import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conciliarVendas,
  saldoAposFila,
  chaveFilaPdv,
  caixaDoPdv,
  type VendaPendente,
} from "../src/lib/vendas-offline.ts";
import { contextoSemServiceWorker } from "../src/lib/pwa.ts";
const venda = (id: string): VendaPendente => ({
  id,
  em: "2026-11-15",
  total: 30,
  params: {
    p_chave: id,
    p_forma: "dinheiro",
    p_itens: [{ produto_id: "p", quantidade: 3 }],
    p_deposito_id: "d",
  },
});
test("PDV usa o caixa do vendedor mesmo quando outro operador abriu um depois", () => {
  const caixas = [
    { id: "caixa-B", aberto_por: "operador-B" },
    { id: "caixa-A", aberto_por: "operador-A" },
  ];
  assert.equal(caixaDoPdv(caixas, "operador-A")?.id, "caixa-A");
  assert.equal(caixaDoPdv(caixas, "operador-B")?.id, "caixa-B");
});
test("sem caixa próprio, PDV mantém o caixa mais recente como o servidor", () => {
  assert.equal(caixaDoPdv([
    { id: "caixa-recente", aberto_por: "operador-B" },
    { id: "caixa-antigo", aberto_por: "operador-C" },
  ], "operador-A")?.id, "caixa-recente");
});
test("PDV não seleciona caixa sem sessão ou sem caixa aberto", () => {
  assert.equal(caixaDoPdv([], "operador-A"), null);
  assert.equal(caixaDoPdv([{ id: "caixa-B", aberto_por: "operador-B" }], ""), null);
});
test("sincronização conserva vendas feitas enquanto o envio aguarda", () => {
  assert.deepEqual(conciliarVendas([venda("1"), venda("2")], [venda("1")], []), [venda("2")]);
});
test("recusa permanece guardada com pagamento e chave originais", () => {
  const v = venda("1");
  const recusada = { ...v, erro: "Estoque insuficiente" };
  assert.deepEqual(conciliarVendas([v], [v], [recusada]), [recusada]);
  assert.equal(recusada.params["p_chave"], "1");
  assert.equal(recusada.params["p_forma"], "dinheiro");
});
test("alteração concorrente na fila não é apagada", () => {
  const modificada = { ...venda("1"), total: 40 };
  assert.deepEqual(conciliarVendas([modificada], [venda("1")], []), [modificada]);
});
test("saldo desconta vendas locais apenas do mesmo depósito e nunca fica negativo", () => {
  assert.equal(saldoAposFila(10, "p", "d", [venda("1"), venda("2")]), 4);
  assert.equal(saldoAposFila(10, "p", "outro", [venda("1")]), 10);
  assert.equal(saldoAposFila(2, "p", "d", [venda("1")]), 0);
});
test("filas isoladas por conta e empresa", () => {
  assert.notEqual(chaveFilaPdv("a", "t"), chaveFilaPdv("b", "t"));
  assert.notEqual(chaveFilaPdv("a", "t"), chaveFilaPdv("a", "u"));
});
test("offline só registra no publicado, nunca na prévia ou iframe", () => {
  for (const host of [
    "id-preview--123.lovable.app",
    "preview-v2--123.gpt-eng.com",
    "project--123-dev.lovable.app",
    "x.lovableproject.com",
    "beta.lovable.dev",
  ]) {
    assert.equal(contextoSemServiceWorker(host, true, false, false), true);
  }
  assert.equal(contextoSemServiceWorker("erpzetech.lovable.app", true, false, false), false);
  assert.equal(contextoSemServiceWorker("preview-v2--shop.example.com", true, false, false), false);
  assert.equal(contextoSemServiceWorker("erpzetech.lovable.app", false, false, false), true);
  assert.equal(contextoSemServiceWorker("erpzetech.lovable.app", true, true, false), true);
  assert.equal(contextoSemServiceWorker("erpzetech.lovable.app", true, false, true), true);
});
