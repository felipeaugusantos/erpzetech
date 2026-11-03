import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlTicketPesagem } from "../src/lib/ticket-pesagem.ts";

const base = {
  loja: "Bistrô <Teste>",
  comanda: 123,
  item: "Buffet por kg",
  brutoG: 850,
  taraG: 350,
  taraNome: "Prato",
  liquidoG: 500,
  precoKg: 60,
  valor: 30,
  tetoBuffet: false,
  emitidoEm: "01/11/2026 12:00",
};

test("ticket da pesagem traz peso, tara, valor e o código da comanda", () => {
  const html = htmlTicketPesagem(base);
  assert.match(html, /Comanda 123/);
  assert.match(html, /0,850 kg/);
  assert.match(html, /- 0,350 kg/);
  assert.match(html, /0,500 kg/);
  assert.match(html, /C123/);
  assert.doesNotMatch(html, /buffet livre/);
});

test("ticket escapa o texto e avisa o teto do buffet livre", () => {
  const html = htmlTicketPesagem({ ...base, tetoBuffet: true });
  assert.match(html, /Bistrô &lt;Teste&gt;/);
  assert.match(html, /limitado ao preço do buffet livre/);
});
