import assert from "node:assert/strict";
import { test } from "node:test";

import { gtinValido, interpretarCosmos } from "../src/lib/gtin.ts";

test("gtinValido confere tamanho e dígito verificador", () => {
  assert.equal(gtinValido("7891910000197"), true); // EAN-13
  assert.equal(gtinValido("96385074"), true); // EAN-8
  assert.equal(gtinValido("036000291452"), true); // UPC-A
  assert.equal(gtinValido("7891910000198"), false); // dígito errado
  assert.equal(gtinValido("12345"), false);
  assert.equal(gtinValido("789191000019A"), false);
  assert.equal(gtinValido(""), false);
});

test("interpretarCosmos lê nome, marca e NCM", () => {
  const r = interpretarCosmos({
    description: " CIMENTO CP II 50KG ",
    brand: { name: "Votoran" },
    ncm: { code: "2523.29.10", description: "Cimento" },
  });
  assert.deepEqual(r, { descricao: "CIMENTO CP II 50KG", marca: "Votoran", ncm: "25232910" });
});

test("interpretarCosmos tolera campos ausentes e respostas inválidas", () => {
  assert.deepEqual(interpretarCosmos({ description: "Prego 17x27" }), {
    descricao: "Prego 17x27",
    marca: "",
    ncm: "",
  });
  assert.equal(interpretarCosmos({}), null);
  assert.equal(interpretarCosmos(null), null);
  assert.equal(interpretarCosmos("x"), null);
});
