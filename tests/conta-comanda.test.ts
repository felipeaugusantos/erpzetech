import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlContaComanda, valoresContaImpressa } from "../src/lib/conta-comanda.ts";

const base = {
  numero: 12,
  mesa: "5",
  itens: [
    { nome: "Pizza", quantidade: 1, total: 60 },
    { nome: "Suco <laranja>", quantidade: 2, total: 20.15, opcoes: ["sem gelo"] },
  ],
  pessoas: 2,
  couvertPorPessoa: 0,
  taxaServicoPercentual: 10,
  emitidaEm: "19/10/2026 20:00",
};

test("pré-conta mostra o total sem e com o serviço opcional", () => {
  const v = valoresContaImpressa({ ...base, servico: "opcional" });
  assert.equal(v.sem.total, 80.15);
  assert.equal(v.com.servico, 8.02); // meio centavo para cima, como no banco
  assert.equal(v.com.total, 88.17);
  const html = htmlContaComanda({ ...base, servico: "opcional" });
  assert.match(html, /Serviço 10% \(opcional\)/);
  assert.match(html, /Total sem serviço/);
  assert.match(html, /Total com serviço/);
  assert.match(html, /pague com ou sem ele/);
  assert.match(html, /Suco &lt;laranja&gt;/);
});

test("serviço dispensado não entra no total", () => {
  const html = htmlContaComanda({ ...base, servico: "dispensado" });
  assert.match(html, /não cobrado/);
  assert.doesNotMatch(html, /Total com serviço/);
  assert.match(html, /R\$\s80,15/);
});

test("serviço cobrado, couvert artístico e valor já recebido", () => {
  const html = htmlContaComanda({
    ...base,
    servico: "cobrado",
    couvertPorPessoa: 15,
    jaPago: 30,
  });
  assert.match(html, /Couvert artístico \(2 x R\$\s15,00\)/);
  assert.match(html, /Já recebido/);
  assert.match(html, /A pagar/);
  const v = valoresContaImpressa({ ...base, servico: "cobrado", couvertPorPessoa: 15, jaPago: 30 });
  assert.equal(v.com.couvert, 30);
  assert.equal(v.com.total, 118.17);
  assert.equal(v.final.restante, 88.17);
});

test("sem couvert a linha não aparece", () => {
  assert.doesNotMatch(htmlContaComanda({ ...base, servico: "opcional" }), /Couvert/);
});
