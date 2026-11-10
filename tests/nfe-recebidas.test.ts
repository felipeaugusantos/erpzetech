import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cnpjParaDistribuicao,
  configRecebidasValida,
  exigirCnpjPermitido,
  validarManifestacao,
} from "../src/lib/nfe-recebidas.ts";

const CHAVE = "35261000574422000170550010000130801293016607";

test("ciência e confirmação não pedem justificativa", () => {
  assert.deepEqual(validarManifestacao({ chave: CHAVE, tipo: "210210" }), {
    chave: CHAVE,
    tipo: "210210",
    justificativa: null,
  });
  assert.equal(
    validarManifestacao({ chave: CHAVE, tipo: "210200", justificativa: "x" }).justificativa,
    null,
  );
});

test("desconhecimento e operação não realizada exigem justificativa de 15 a 255 caracteres", () => {
  for (const tipo of ["210220", "210240"]) {
    assert.throws(() => validarManifestacao({ chave: CHAVE, tipo }), /justificativa/);
    assert.throws(
      () => validarManifestacao({ chave: CHAVE, tipo, justificativa: "curta" }),
      /justificativa/,
    );
    assert.throws(
      () => validarManifestacao({ chave: CHAVE, tipo, justificativa: "a".repeat(256) }),
      /justificativa/,
    );
    assert.equal(
      validarManifestacao({ chave: CHAVE, tipo, justificativa: "  Mercadoria não recebida  " })
        .justificativa,
      "Mercadoria não recebida",
    );
  }
});

test("recusa chave fora de 44 dígitos e evento desconhecido", () => {
  assert.throws(() => validarManifestacao({ chave: "123", tipo: "210210" }), /44 dígitos/);
  assert.throws(() => validarManifestacao({ chave: CHAVE, tipo: "999999" }), /inválido/);
  assert.equal(
    validarManifestacao({ chave: `${CHAVE.slice(0, 4)} ${CHAVE.slice(4)}`, tipo: "210210" }).chave,
    CHAVE,
  );
});

test("só CNPJ de 14 caracteres, e só de empresa do usuário", () => {
  assert.equal(cnpjParaDistribuicao("00.564.267/0002-92"), "00564267000292");
  assert.throws(() => cnpjParaDistribuicao("123.456.789-09"), /14/);
  assert.equal(exigirCnpjPermitido("00564267000292", ["00.564.267/0002-92"]), "00564267000292");
  assert.throws(
    () => exigirCnpjPermitido("13322613000197", ["00.564.267/0002-92"]),
    /não encontrado/,
  );
});

test("busca automática: intervalo de 1 a 24 horas; ciência automática é opt-in", () => {
  assert.deepEqual(configRecebidasValida({}), {
    distribuicao_automatica: false,
    distribuicao_intervalo_horas: 24,
    ciencia_automatica: false,
  });
  assert.equal(
    configRecebidasValida({ distribuicao_intervalo_horas: 1 }).distribuicao_intervalo_horas,
    1,
  );
  assert.throws(() => configRecebidasValida({ distribuicao_intervalo_horas: 0 }), /1 a 24/);
  assert.throws(() => configRecebidasValida({ distribuicao_intervalo_horas: 25 }), /1 a 24/);
});
