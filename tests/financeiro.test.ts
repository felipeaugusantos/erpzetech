import assert from "node:assert/strict";
import { mock, test } from "node:test";

// Os usuários estão no Brasil: "hoje" é a data de Brasília, não a de Greenwich.
process.env["TZ"] = "America/Sao_Paulo";

import {
  corConta,
  entradaCaixa,
  estaVencida,
  hojeISO,
  labelConta,
  labelForma,
  podeReceber,
  proximasCompra,
  somaDias,
} from "../src/lib/financeiro.ts";

test("hojeISO é a data local, inclusive à noite (quando em UTC já é o dia seguinte)", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T01:30:00Z") }); // 22:30 em Brasília
  try {
    assert.equal(hojeISO(), "2026-10-03");
  } finally {
    mock.timers.reset();
  }
});

test("conta que vence hoje não aparece como vencida à noite", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T01:30:00Z") });
  try {
    assert.equal(estaVencida("aberto", "2026-10-03"), false);
    assert.equal(estaVencida("aberto", "2026-10-02"), true);
    assert.equal(estaVencida("parcial", "2026-10-02"), true);
    assert.equal(estaVencida("pago", "2026-10-02"), false);
    assert.equal(estaVencida("cancelado", "2026-10-02"), false);
    assert.equal(labelConta("aberto", "2026-10-02"), "Vencido");
    assert.equal(labelConta("aberto", "2026-10-03"), "Aberto");
    assert.equal(labelConta("pago", "2026-10-02"), "Pago");
    assert.match(corConta("aberto", "2026-10-02"), /destructive/);
    assert.match(corConta("pago", "2026-10-02"), /success/);
  } finally {
    mock.timers.reset();
  }
});

test("somaDias atravessa mês e ano", () => {
  assert.equal(somaDias("2026-10-31", 1), "2026-11-01");
  assert.equal(somaDias("2026-10-03", 30), "2026-11-02");
  assert.equal(somaDias("2026-12-31", 1), "2027-01-01");
  assert.equal(somaDias("2026-03-01", -1), "2026-02-28");
});

test("proximasCompra segue o fluxo da compra", () => {
  assert.deepEqual(proximasCompra("rascunho"), ["cotacao", "aprovado", "cancelado"]);
  assert.deepEqual(proximasCompra("aprovado"), ["pedido_enviado", "cancelado"]);
  assert.deepEqual(proximasCompra("pedido_enviado"), ["cancelado"]);
  assert.deepEqual(proximasCompra("recebido"), []);
  assert.deepEqual(proximasCompra("cancelado"), []);
  assert.deepEqual(proximasCompra("desconhecida"), []);
});

test("podeReceber só nas situações com pedido aprovado ou enviado", () => {
  for (const s of ["aprovado", "pedido_enviado", "parcialmente_recebido"]) {
    assert.equal(podeReceber(s), true, s);
  }
  for (const s of ["rascunho", "cotacao", "recebido", "cancelado"]) {
    assert.equal(podeReceber(s), false, s);
  }
});

test("entradaCaixa separa o que entra do que sai", () => {
  for (const t of ["abertura", "entrada", "suprimento", "venda", "recebimento"]) {
    assert.equal(entradaCaixa(t), true, t);
  }
  for (const t of ["saida", "sangria", "pagamento"]) assert.equal(entradaCaixa(t), false, t);
});

test("labelForma devolve travessão para forma desconhecida", () => {
  assert.equal(labelForma("pix"), "PIX");
  assert.equal(labelForma("cartao_credito"), "Cartão de crédito");
  assert.equal(labelForma(null), "—");
  assert.equal(labelForma("xyz"), "—");
});
