import assert from "node:assert/strict";
import { test } from "node:test";

import {
  etapaDelivery,
  formatarEndereco,
  formatarTelefone,
  htmlPedidoDelivery,
  soDigitos,
  telefoneValido,
  trocoNecessario,
} from "../src/lib/delivery.ts";

test("telefone: formata e valida", () => {
  assert.equal(soDigitos("(11) 99999-8888"), "11999998888");
  assert.equal(formatarTelefone("11999998888"), "(11) 99999-8888");
  assert.equal(formatarTelefone("1133334444"), "(11) 3333-4444");
  assert.equal(formatarTelefone("12345"), "12345");
  assert.equal(formatarTelefone(null), "");
  assert.equal(telefoneValido(""), true);
  assert.equal(telefoneValido("(11) 3333-4444"), true);
  assert.equal(telefoneValido("1234"), false);
});

test("etapas do pedido de delivery", () => {
  assert.equal(etapaDelivery("aguardando", []), "montando");
  // bebida sem preparo já sai entregue: o pedido só com ela está pronto para sair
  assert.equal(etapaDelivery("aguardando", ["entregue"]), "pronto");
  assert.equal(etapaDelivery("aguardando", ["pendente", "entregue"]), "montando");
  assert.equal(etapaDelivery("aguardando", ["enviado", "entregue"]), "cozinha");
  assert.equal(etapaDelivery("aguardando", ["preparando"]), "cozinha");
  assert.equal(etapaDelivery("aguardando", ["pronto", "entregue"]), "pronto");
  assert.equal(etapaDelivery("aguardando", ["cancelado", "pronto"]), "pronto");
  assert.equal(etapaDelivery("aguardando", ["cancelado"]), "montando");
  assert.equal(etapaDelivery("saiu", ["entregue"]), "em_rota");
  assert.equal(etapaDelivery("entregue", ["entregue"]), "entregue");
});

test("troco que o entregador leva", () => {
  assert.equal(trocoNecessario(52, 100), 48);
  assert.equal(trocoNecessario(52, 50), 0);
  assert.equal(trocoNecessario(52, null), 0);
  assert.equal(trocoNecessario(52.4, 100), 47.6);
});

test("endereço com bairro e referência", () => {
  assert.equal(
    formatarEndereco({
      endereco: "Rua das Flores, 100",
      bairro: "Centro",
      referencia: "Casa azul",
    }),
    "Rua das Flores, 100 — Centro (ref.: Casa azul)",
  );
  assert.equal(formatarEndereco({ endereco: "Av. Brasil, 2000" }), "Av. Brasil, 2000");
});

test("pedido para imprimir: dados, troco e texto escapado", () => {
  const html = htmlPedidoDelivery({
    numero: 12,
    loja: "Bar & Cia",
    cliente: "<b>Ana</b>",
    telefone: "11999998888",
    endereco: "Rua das Flores, 100",
    bairro: "Centro",
    pagamento: "dinheiro",
    trocoPara: 100,
    itens: [
      { quantidade: 2, nome: "Pizza", opcoes: ["Borda recheada"], total: 40 },
      { quantidade: 1, nome: "Taxa de entrega", total: 12 },
    ],
    total: 52,
  });
  assert.match(html, /DELIVERY 12/);
  assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
  assert.match(html, /Bar &amp; Cia/);
  assert.match(html, /\(11\) 99999-8888/);
  assert.match(html, /2× Pizza/);
  assert.match(html, /Borda recheada/);
  assert.match(html, /LEVAR TROCO: R\$ 48,00/);
  assert.match(html, /Total<\/span><span>R\$ 52,00/);
  const pago = htmlPedidoDelivery({
    numero: 1,
    cliente: "Bia",
    endereco: "Rua A, 1",
    pagamento: "pago_online",
    itens: [],
    total: 10,
  });
  assert.match(pago, /PEDIDO JÁ PAGO/);
  assert.doesNotMatch(pago, /LEVAR TROCO/);
});
