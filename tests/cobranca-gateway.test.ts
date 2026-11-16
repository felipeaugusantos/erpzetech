import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acaoDoEvento,
  dataDeVencimento,
  documentoLimpo,
  formaDoGateway,
  lerEventoAsaas,
  lerSituacaoAssinatura,
  montarClienteAsaas,
  montarCobrancaAsaas,
  type FaturaPendente,
} from "../src/lib/cobranca-gateway.ts";

const fatura: FaturaPendente = {
  fatura_id: "f1",
  cliente_id: "c1",
  descricao: "Mensalidade plano Loja",
  valor: "299.00",
  vencimento: "2026-12-10",
  cliente_nome: "  Loja Exemplo  ",
  documento: "12.345.678/0001-90",
  email: "dono@loja.com.br",
  whatsapp: "+55 (16) 98854-7561",
  gateway_cliente_id: null,
};

describe("cobrança: pedidos ao gateway", () => {
  it("monta o cliente com documento e telefone limpos", () => {
    const c = montarClienteAsaas(fatura);
    assert.deepEqual(c, {
      name: "Loja Exemplo",
      cpfCnpj: "12345678000190",
      externalReference: "c1",
      email: "dono@loja.com.br",
      mobilePhone: "16988547561",
    });
  });

  it("recusa documento inválido e ignora e-mail e telefone malformados", () => {
    assert.throws(() => montarClienteAsaas({ ...fatura, documento: "123" }), /CPF ou CNPJ/);
    assert.throws(() => montarClienteAsaas({ ...fatura, documento: null }), /CPF ou CNPJ/);
    const c = montarClienteAsaas({ ...fatura, email: "nao-e-email", whatsapp: "123" });
    assert.equal(c.email, undefined);
    assert.equal(c.mobilePhone, undefined);
    assert.equal(documentoLimpo("123.456.789-09"), "12345678909");
    assert.equal(documentoLimpo("12.ABC.345/0001-95"), "12ABC345000195");
  });

  it("monta a cobrança com a fatura como referência e o pagador escolhendo a forma", () => {
    const c = montarCobrancaAsaas(fatura, "cus_1", "2026-12-01");
    assert.deepEqual(c, {
      customer: "cus_1",
      billingType: "UNDEFINED",
      value: 299,
      dueDate: "2026-12-10",
      description: "Mensalidade plano Loja",
      externalReference: "f1",
    });
  });

  it("vencimento já passado usa a data de hoje; valor inválido é recusado", () => {
    assert.equal(dataDeVencimento("2026-11-01", "2026-12-01"), "2026-12-01");
    assert.equal(dataDeVencimento("2026-12-10", "2026-12-01"), "2026-12-10");
    assert.throws(() => dataDeVencimento("10/12/2026", "2026-12-01"));
    assert.throws(
      () => montarCobrancaAsaas({ ...fatura, valor: 0 }, "cus_1", "2026-12-01"),
      /Valor/,
    );
    assert.throws(() => montarCobrancaAsaas(fatura, "", "2026-12-01"), /Cliente do gateway/);
  });
});

describe("cobrança: eventos do webhook", () => {
  it("só o dinheiro disponível dá baixa; cartão confirmado também", () => {
    assert.equal(acaoDoEvento("PAYMENT_RECEIVED", "PIX"), "baixar");
    assert.equal(acaoDoEvento("PAYMENT_CONFIRMED", "CREDIT_CARD"), "baixar");
    assert.equal(acaoDoEvento("PAYMENT_CONFIRMED", "BOLETO"), "status");
    assert.equal(acaoDoEvento("PAYMENT_CONFIRMED", "PIX"), "status");
  });

  it("estorno e contestação desfazem a baixa; vencida e apagada só anotam; o resto é ignorado", () => {
    for (const e of [
      "PAYMENT_REFUNDED",
      "PAYMENT_CHARGEBACK_REQUESTED",
      "PAYMENT_RECEIVED_IN_CASH_UNDONE",
    ])
      assert.equal(acaoDoEvento(e, "PIX"), "estornar", e);
    for (const e of ["PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"])
      assert.equal(acaoDoEvento(e, "PIX"), "status", e);
    assert.equal(acaoDoEvento("PAYMENT_CREATED", "PIX"), "ignorar");
    assert.equal(acaoDoEvento("INVOICE_CREATED", "PIX"), "ignorar");
  });

  it("lê o corpo do Asaas", () => {
    const e = lerEventoAsaas({
      id: "evt_1",
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "pay_1",
        value: 299,
        billingType: "PIX",
        status: "RECEIVED",
        paymentDate: "2026-12-10",
      },
    });
    assert.deepEqual(e, {
      eventoId: "evt_1",
      evento: "PAYMENT_RECEIVED",
      cobrancaId: "pay_1",
      status: "RECEIVED",
      valor: 299,
      forma: "pix",
      data: "2026-12-10",
      acao: "baixar",
    });
  });

  it("recusa corpo fora do formato e descarta data ruim", () => {
    for (const ruim of [
      null,
      [],
      {},
      { id: "e", event: "X" },
      { id: "e", event: "X", payment: {} },
      { id: "e", event: "X", payment: [] },
    ])
      assert.equal(lerEventoAsaas(ruim), null);
    const e = lerEventoAsaas({
      id: "e",
      event: "PAYMENT_RECEIVED",
      payment: { id: "p", value: "abc", paymentDate: "ontem" },
    });
    assert.equal(e?.valor, 0);
    assert.equal(e?.data, null);
    assert.equal(formaDoGateway("BOLETO"), "boleto");
    assert.equal(formaDoGateway("DEBIT_CARD"), "cartao");
    assert.equal(formaDoGateway(undefined), "outro");
  });
});

describe("cobrança: situação da assinatura", () => {
  it("lê o retorno da função do banco", () => {
    const s = lerSituacaoAssinatura({
      bloqueado: false,
      em_atraso: true,
      dias_atraso: 4,
      valor_em_aberto: 299,
      tolerancia_dias: 10,
      faturas: [
        {
          id: "f",
          descricao: "Mensalidade",
          valor: 299,
          vencimento: "2026-12-10",
          url: "https://www.asaas.com/i/abc",
        },
      ],
    });
    assert.equal(s?.emAtraso, true);
    assert.equal(s?.diasAtraso, 4);
    assert.equal(s?.faturas[0]?.url, "https://www.asaas.com/i/abc");
  });

  it("formato inesperado nunca bloqueia; link que não é https é descartado", () => {
    assert.equal(lerSituacaoAssinatura(null), null);
    assert.equal(lerSituacaoAssinatura({ bloqueado: "sim" }), null);
    const s = lerSituacaoAssinatura({
      bloqueado: true,
      em_atraso: true,
      faturas: [
        { id: "f", descricao: "x", valor: 1, vencimento: "2026-12-10", url: "javascript:alert(1)" },
        "lixo",
      ],
    });
    assert.equal(s?.faturas.length, 1);
    assert.equal(s?.faturas[0]?.url, null);
  });
});
