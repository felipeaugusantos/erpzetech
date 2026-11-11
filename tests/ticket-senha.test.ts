import assert from "node:assert/strict";
import { test } from "node:test";

import { etapaSenha } from "../src/lib/restaurante.ts";
import { htmlTicketSenha } from "../src/lib/ticket-senha.ts";

test("ticket da senha traz o número, os itens e o código da comanda", () => {
  const html = htmlTicketSenha({
    loja: "Praça <Sul>",
    senha: 42,
    comanda: 123,
    itens: [
      { nome: "X-Burger", quantidade: 2, observacao: "sem cebola" },
      { nome: "Suco", quantidade: 1 },
    ],
    emitidoEm: "01/11/2026 12:00",
  });
  assert.match(html, /<p class="senha">42<\/p>/);
  assert.match(html, /2× X-Burger/);
  assert.match(html, /sem cebola/);
  assert.match(html, /C123/);
  assert.match(html, /Praça &lt;Sul&gt;/);
});

test("etapaSenha: preparo, pronto ou fora do painel", () => {
  assert.equal(etapaSenha(["enviado"]), "preparo");
  assert.equal(etapaSenha(["pronto", "preparando"]), "preparo");
  assert.equal(etapaSenha(["pronto", "entregue"]), "pronto");
  assert.equal(etapaSenha(["entregue", "entregue"]), null);
  assert.equal(etapaSenha(["pendente"]), null);
  assert.equal(etapaSenha(["cancelado", "pronto"]), "pronto");
  assert.equal(etapaSenha([]), null);
});
