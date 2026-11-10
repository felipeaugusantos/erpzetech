import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anoDaInutilizacao,
  normalizarTexto,
  notasQueImpedemInutilizacao,
  situacaoDoEvento,
  validarCorrecao,
  validarInutilizacao,
} from "../src/lib/nfe-eventos.ts";

const ok = {
  serie: 1,
  numeroInicial: 10,
  numeroFinal: 12,
  justificativa: "Numeração pulada por falha do sistema",
};

test("normalizarTexto tira quebra de linha, espaço repetido e controle", () => {
  assert.equal(normalizarTexto("  a\n\n b\t\tc \u0000d "), "a b c d");
  assert.equal(normalizarTexto(null), "");
});

test("validarCorrecao exige 15 a 1000 caracteres depois de normalizar", () => {
  assert.throws(() => validarCorrecao("curto"), /pelo menos 15/);
  assert.throws(() => validarCorrecao("a\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nb"), /pelo menos 15/);
  assert.throws(() => validarCorrecao("x".repeat(1001)), /no máximo 1000/);
  assert.equal(
    validarCorrecao("  Endereço de entrega:   Rua A, 10  "),
    "Endereço de entrega: Rua A, 10",
  );
});

test("validarInutilizacao aceita faixa válida e normaliza", () => {
  assert.deepEqual(validarInutilizacao({ ...ok, serie: "1", numeroInicial: "10" }), ok);
});

test("validarInutilizacao recusa série, faixa e justificativa inválidas", () => {
  assert.throws(() => validarInutilizacao({ ...ok, serie: 1000 }), /série/);
  assert.throws(() => validarInutilizacao({ ...ok, serie: -1 }), /série/);
  assert.throws(() => validarInutilizacao({ ...ok, numeroInicial: 0 }), /entre 1 e/);
  assert.throws(() => validarInutilizacao({ ...ok, numeroFinal: 1.5 }), /entre 1 e/);
  assert.throws(
    () => validarInutilizacao({ ...ok, numeroInicial: 20, numeroFinal: 10 }),
    /menor que o inicial/,
  );
  assert.throws(
    () => validarInutilizacao({ ...ok, numeroInicial: 1, numeroFinal: 501 }),
    /no máximo 500/,
  );
  assert.doesNotThrow(() => validarInutilizacao({ ...ok, numeroInicial: 1, numeroFinal: 500 }));
  assert.throws(() => validarInutilizacao({ ...ok, justificativa: "curta" }), /pelo menos 15/);
  assert.throws(
    () => validarInutilizacao({ ...ok, justificativa: "x".repeat(256) }),
    /no máximo 255/,
  );
});

test("notasQueImpedemInutilizacao só considera notas da faixa que já existem na Sefaz", () => {
  const notas = [
    { numero: 9, situacao: "autorizada" },
    { numero: 10, situacao: "rejeitada" },
    { numero: 11, situacao: "autorizada" },
    { numero: 12, situacao: "cancelada" },
    { numero: 13, situacao: "transmitida" },
    { numero: null, situacao: "autorizada" },
  ];
  assert.deepEqual(
    notasQueImpedemInutilizacao(notas, 10, 12).map((n) => n.numero),
    [11, 12],
  );
});

test("situacaoDoEvento só reconhece o que o emissor devolve", () => {
  assert.equal(situacaoDoEvento("registrado"), "registrado");
  assert.equal(situacaoDoEvento("REJEITADO"), "rejeitado");
  assert.equal(situacaoDoEvento("erro"), "erro");
  assert.equal(situacaoDoEvento("pendente"), "pendente");
  assert.equal(situacaoDoEvento(undefined), "pendente");
});

test("anoDaInutilizacao usa o ano de São Paulo, mesmo na virada em UTC", () => {
  assert.equal(anoDaInutilizacao(new Date("2027-01-01T01:00:00Z")), 2026);
  assert.equal(anoDaInutilizacao(new Date("2027-01-01T03:00:00Z")), 2027);
});
