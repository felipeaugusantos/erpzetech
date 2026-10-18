import assert from "node:assert/strict";
import { test } from "node:test";
import { eanInterno } from "../src/lib/ean.ts";
import { gtinValido } from "../src/lib/gtin.ts";

test("gera EAN-13 interno com prefixo 2 e dígito certo", () => {
  assert.equal(eanInterno("00021"), "2000000000213");
  assert.equal(eanInterno("123"), "2000000001234");
  assert.ok(gtinValido(eanInterno("00020")));
});
test("recusa código sem números", () => assert.throws(() => eanInterno("ABC")));
