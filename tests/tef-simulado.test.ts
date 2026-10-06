import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CREDENCIADORA_SIMULADA,
  ehSimulado,
  gerarRespostaSimulada,
} from "../src/lib/tef-simulado.ts";

test("resposta simulada tem NSU SIM-, autorização de 6 dígitos e bandeira", () => {
  const r = gerarRespostaSimulada({ agora: new Date(1_000_000_123_000), sorteio: () => 0.5 });
  assert.equal(r.credenciadora, CREDENCIADORA_SIMULADA);
  assert.match(r.nsu, /^SIM-\d{6}$/);
  assert.equal(r.autorizacao, "500000");
  assert.equal(r.bandeira, "Mastercard");
  assert.equal(r.simulada, true);
});

test("a bandeira escolhida é respeitada", () => {
  assert.equal(gerarRespostaSimulada({ bandeira: "Elo" }).bandeira, "Elo");
});

test("sorteio no limite superior não estoura a lista de bandeiras", () => {
  const r = gerarRespostaSimulada({ sorteio: () => 0.999999 });
  assert.equal(r.bandeira, "Elo");
  assert.match(r.autorizacao, /^\d{6}$/);
});

test("ehSimulado reconhece só NSU de teste", () => {
  assert.equal(ehSimulado("SIM-000123"), true);
  assert.equal(ehSimulado("123456"), false);
  assert.equal(ehSimulado(null), false);
});
