import assert from "node:assert/strict";
import { test } from "node:test";
import { planejadoPorItem, saldoItem, validaSaida } from "../src/lib/saldo-pedido.ts";

const base = { quantidade: 100, quantidade_separada: 100, quantidade_conferida: 100 };

test("pedido de 100 com 40 entregues deixa 60 pendentes", () => {
  const s = saldoItem({ ...base, quantidade_entregue: 40, planejado: 0 });
  assert.equal(s.pendente, 60);
  assert.equal(s.disponivelParaSaida, 60);
});

test("o que já está agendado em entrega não pode sair de novo", () => {
  const s = saldoItem({ ...base, quantidade_entregue: 40, planejado: 50 });
  assert.equal(s.disponivelParaSaida, 10);
  assert.notEqual(validaSaida(s, 11), null);
  assert.equal(validaSaida(s, 10), null);
});

test("não permite sair acima do saldo pendente", () => {
  const s = saldoItem({ ...base, quantidade_entregue: 100, planejado: 0 });
  assert.notEqual(validaSaida(s, 1), null);
});

test("aceita quantidade fracionada dentro do saldo", () => {
  const s = saldoItem({ ...base, quantidade: 2.5, quantidade_entregue: 1.25, planejado: 0 });
  assert.equal(validaSaida(s, 1.25), null);
});

test("só entregas agendadas ou em rota contam como programadas", () => {
  const mapa = planejadoPorItem([
    { situacao: "planejada", entrega_itens: [{ pedido_item_id: "a", quantidade: 5 }] },
    { situacao: "em_rota", entrega_itens: [{ pedido_item_id: "a", quantidade: 3 }] },
    { situacao: "entregue", entrega_itens: [{ pedido_item_id: "a", quantidade: 9 }] },
  ]);
  assert.equal(mapa["a"], 8);
});
