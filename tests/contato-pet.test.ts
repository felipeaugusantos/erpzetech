import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MENSAGEM_PADRAO,
  linkWhatsApp,
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
