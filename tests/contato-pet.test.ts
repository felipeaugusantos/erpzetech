import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MENSAGEM_PADRAO,
  MENSAGEM_REFORCO,
  linkWhatsApp,
  listaEmTexto,
  montarMensagem,
  telefoneWhatsApp,
} from "../src/lib/contato-pet.ts";

test("telefone brasileiro vira número do WhatsApp com 55", () => {
  assert.equal(telefoneWhatsApp("(16) 99999-1234"), "5516999991234");
  assert.equal(telefoneWhatsApp("16 3333-4444"), "551633334444");
  assert.equal(telefoneWhatsApp("+55 (16) 99999-1234"), "5516999991234");
  assert.equal(telefoneWhatsApp("016 99999-1234"), "5516999991234");
});

test("telefone que não dá para usar", () => {
  assert.equal(telefoneWhatsApp(""), null);
  assert.equal(telefoneWhatsApp(null), null);
  assert.equal(telefoneWhatsApp("1234"), null);
  assert.equal(telefoneWhatsApp("(16) 9999-123"), null);
});

test("link do WhatsApp codifica a mensagem", () => {
  const l = linkWhatsApp("(16) 99999-1234", "Oi, João! 🎉 Banho?");
  assert.equal(l, `https://wa.me/5516999991234?text=${encodeURIComponent("Oi, João! 🎉 Banho?")}`);
  assert.equal(linkWhatsApp("abc", "x"), null);
});

test("mensagem usa o primeiro nome do tutor e preenche os campos", () => {
  const t = montarMensagem(MENSAGEM_PADRAO.retorno, {
    tutor: "Maria da Silva",
    pet: "Thor",
    loja: "Pet Feliz",
    dias: 45,
  });
  assert.match(t, /Oi, Maria!/);
  assert.match(t, /Pet Feliz/);
  assert.match(t, /Faz 45 dias do último banho do Thor/);
  assert.doesNotMatch(t, /\{/);
});

test("campo sem valor mantém o marcador", () => {
  assert.equal(
    montarMensagem("Oi {tutor}, {pet} em {data}", { pet: "Rex" }),
    "Oi {tutor}, Rex em {data}",
  );
});

test("mensagem de reforço lista os itens e a data", () => {
  const t = montarMensagem(MENSAGEM_REFORCO, {
    tutor: "Ana Souza",
    pet: "Thor",
    loja: "Clínica Vida",
    data: "10/10/2026",
    itens: listaEmTexto(["V10", "Vermífugo"]),
  });
  assert.match(t, /Oi, Ana!/);
  assert.match(t, /O Thor está com V10 e Vermífugo para tomar em 10\/10\/2026/);
});

test("lista em texto", () => {
  assert.equal(listaEmTexto([]), "");
  assert.equal(listaEmTexto(["A"]), "A");
  assert.equal(listaEmTexto(["A", "B"]), "A e B");
  assert.equal(listaEmTexto(["A", "B", "C"]), "A, B e C");
});

test("{itens} sem valor fica como está", () => {
  assert.equal(montarMensagem("Com {itens}", { pet: "x" }), "Com {itens}");
});
