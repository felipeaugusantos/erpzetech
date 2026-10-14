import assert from "node:assert/strict";
import { test } from "node:test";
import { comDesfazer } from "../src/lib/desfazer.ts";

test("sem falha, nada é desfeito e o resultado volta", async () => {
  const feito: string[] = [];
  const r = await comDesfazer(async (desfazerSe) => {
    desfazerSe(async () => void feito.push("a"));
    return 42;
  });
  assert.equal(r, 42);
  assert.deepEqual(feito, []);
});

test("na falha, desfaz do último para o primeiro e repassa o erro original", async () => {
  const feito: string[] = [];
  await assert.rejects(
    comDesfazer(async (desfazerSe) => {
      desfazerSe(async () => void feito.push("empresa"));
      desfazerSe(async () => void feito.push("usuario"));
      throw new Error("falhou o papel");
    }),
    /falhou o papel/,
  );
  assert.deepEqual(feito, ["usuario", "empresa"]);
});

test("só desfaz as etapas que chegaram a ser registradas", async () => {
  const feito: string[] = [];
  await assert.rejects(
    comDesfazer(async (desfazerSe) => {
      desfazerSe(async () => void feito.push("1"));
      throw new Error("x");
      // a etapa 2 nunca registrou
    }),
  );
  assert.deepEqual(feito, ["1"]);
});

test("um desfazer que falha não impede os outros nem troca o erro", async () => {
  const feito: string[] = [];
  await assert.rejects(
    comDesfazer(async (desfazerSe) => {
      desfazerSe(async () => void feito.push("primeiro"));
      desfazerSe(async () => {
        throw new Error("não deu para desfazer");
      });
      throw new Error("erro original");
    }),
    /erro original/,
  );
  assert.deepEqual(feito, ["primeiro"]);
});
