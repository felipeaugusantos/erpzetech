import assert from "node:assert/strict";
import test from "node:test";

import {
  erroDosSinais,
  evolucaoDoPeso,
  faltaParaFechar,
  formDoAtendimento,
  type AtendimentoClinico,
} from "../src/lib/clinica.ts";

const sinais = { peso_kg: "", temperatura_c: "", freq_cardiaca: "", freq_respiratoria: "" };

test("para fechar o atendimento precisa de queixa e conduta", () => {
  assert.deepEqual(faltaParaFechar({ queixa: "", conduta: "" }), ["queixa", "conduta"]);
  assert.deepEqual(faltaParaFechar({ queixa: " vômito ", conduta: "  " }), ["conduta"]);
  assert.deepEqual(faltaParaFechar({ queixa: "a", conduta: "b" }), []);
});

test("sinais vitais: aceita vírgula, vazio e confere os limites do banco", () => {
  assert.equal(erroDosSinais(sinais), null);
  assert.equal(
    erroDosSinais({ ...sinais, peso_kg: "12,5", temperatura_c: "38,7", freq_cardiaca: "110" }),
    null,
  );
  assert.match(erroDosSinais({ ...sinais, peso_kg: "500" }) ?? "", /Peso/);
  assert.match(erroDosSinais({ ...sinais, temperatura_c: "20" }) ?? "", /Temperatura/);
  assert.match(erroDosSinais({ ...sinais, freq_cardiaca: "9" }) ?? "", /cardíaca/);
  assert.match(erroDosSinais({ ...sinais, freq_respiratoria: "abc" }) ?? "", /número/);
});

test("o formulário mostra números com vírgula e campos vazios como texto vazio", () => {
  const f = formDoAtendimento({
    queixa: "Tosse",
    peso_kg: 12.5,
    temperatura_c: null,
    retorno_em: "2026-11-01",
  } as unknown as AtendimentoClinico);
  assert.equal(f.queixa, "Tosse");
  assert.equal(f.peso_kg, "12,5");
  assert.equal(f.temperatura_c, "");
  assert.equal(f.conduta, "");
  assert.equal(f.retorno_em, "2026-11-01");
});

test("evolução do peso ignora atendimento sem peso e ordena do mais antigo", () => {
  const r = evolucaoDoPeso([
    { aberto_em: "2026-05-01T10:00:00Z", peso_kg: 11 },
    { aberto_em: "2026-01-01T10:00:00Z", peso_kg: 10 },
    { aberto_em: "2026-03-01T10:00:00Z", peso_kg: null },
  ]);
  assert.deepEqual(
    r.map((x) => x.peso),
    [10, 11],
  );
});
