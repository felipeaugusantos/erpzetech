import assert from "node:assert/strict";
import { test } from "node:test";

import {
  linhaInicial,
  pagamentosParaEnvio,
  paraNumero,
  paraTexto,
  somaPagamentos,
} from "../src/lib/restaurante-pagamentos.ts";

test("números digitados com vírgula e ponto", () => {
  assert.equal(paraNumero("54,50"), 54.5);
  assert.equal(paraNumero("54.5"), 54.5);
  assert.equal(paraNumero(""), 0);
  assert.equal(paraNumero("abc"), 0);
  assert.equal(paraTexto(54.5), "54,50");
});

test("pagamentos preenchidos vão para o banco e os vazios ficam de fora", () => {
  const linhas = [
    { forma: "pix", valor: "25,00", pagante: " Ana " },
    { forma: "dinheiro", valor: "", pagante: "" },
    { forma: "cartao_debito", valor: "10", pagante: "" },
  ];
  assert.deepEqual(pagamentosParaEnvio(linhas), [
    { forma: "pix", valor: 25, pagante: "Ana" },
    { forma: "cartao_debito", valor: 10, pagante: null },
  ]);
});

test("a soma dos pagamentos não tem erro de centavos", () => {
  const linhas = [
    { forma: "pix", valor: "0,10", pagante: "" },
    { forma: "pix", valor: "0,20", pagante: "" },
  ];
  assert.equal(somaPagamentos(linhas), 0.3);
  assert.deepEqual(linhaInicial(), { forma: "dinheiro", valor: "", pagante: "" });
});
