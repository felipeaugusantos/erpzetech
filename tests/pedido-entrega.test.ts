import assert from "node:assert/strict";
import { test } from "node:test";

import { enderecoPedido, labelEntrega } from "../src/lib/entrega.ts";
import { corSituacao, labelSituacao, proximas } from "../src/lib/pedido.ts";

test("pedido: o fluxo de situações permite avançar, voltar à separação e cancelar", () => {
  assert.deepEqual(proximas("aguardando_pagamento"), ["aprovado", "cancelado"]);
  assert.deepEqual(proximas("separado"), ["conferencia", "separacao", "cancelado"]);
  assert.deepEqual(proximas("conferencia"), ["pronto_entrega", "separacao", "cancelado"]);
  assert.deepEqual(proximas("em_rota"), ["entregue", "cancelado"]);
  assert.deepEqual(proximas("entregue"), ["concluido"]);
});

test("pedido: situações finais não têm próximo passo", () => {
  assert.deepEqual(proximas("concluido"), []);
  assert.deepEqual(proximas("cancelado"), []);
  assert.deepEqual(proximas("inexistente"), []);
});

test("pedido: só cancelado e concluído terminam; toda situação pode chegar ao fim", () => {
  const todas = [
    "aguardando_pagamento",
    "aprovado",
    "separacao",
    "separado",
    "conferencia",
    "pronto_entrega",
    "em_rota",
    "entregue",
  ];
  for (const inicio of todas) {
    const vistos = new Set<string>();
    const fila = [inicio];
    let chegaAoFim = false;
    while (fila.length > 0) {
      const atual = fila.shift() as string;
      if (vistos.has(atual)) continue;
      vistos.add(atual);
      if (atual === "concluido" || atual === "cancelado") chegaAoFim = true;
      fila.push(...proximas(atual));
    }
    assert.equal(chegaAoFim, true, `${inicio} fica sem saída`);
  }
});

test("pedido: rótulos e cores têm padrão para valor desconhecido", () => {
  assert.equal(labelSituacao("em_rota"), "Em rota");
  assert.equal(labelSituacao("outra"), "outra");
  assert.match(corSituacao("cancelado"), /destructive/);
  assert.match(corSituacao("outra"), /secondary/);
});

test("entrega: rótulo da situação", () => {
  assert.equal(labelEntrega("insucesso"), "Sem sucesso");
  assert.equal(labelEntrega("outra"), "outra");
});

test("enderecoPedido monta a linha de entrega ou indica retirada", () => {
  assert.equal(
    enderecoPedido({
      entrega_endereco: "Rua das Flores",
      entrega_numero: "120",
      entrega_bairro: "Centro",
      entrega_cidade: "Campinas",
      entrega_estado: "SP",
    }),
    "Rua das Flores, 120 — Centro · Campinas · SP",
  );
  assert.equal(enderecoPedido({ entrega_cidade: "Campinas" }), "Campinas");
  assert.equal(enderecoPedido({}), "Retirada na loja");
  assert.equal(enderecoPedido({ entrega_endereco: "", entrega_numero: null }), "Retirada na loja");
});
