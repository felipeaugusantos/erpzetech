import assert from "node:assert/strict";
import { test } from "node:test";

import { contaPareceOutra, dataOfx, lerOfx, valorOfx } from "../src/lib/ofx.ts";

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0341<BRANCHID>1234<ACCTID>56789-0<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000[-3:BRT]<TRNAMT>1500.00<FITID>A1<MEMO>PIX RECEBIDO CLIENTE
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-89,90<FITID>A2<CHECKNUM>77<NAME>TARIFA &amp; CIA
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test("lê OFX em SGML: conta, datas, valores com sinal e descrição", () => {
  const r = lerOfx(SGML);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.conta, { banco: "0341", agencia: "1234", conta: "56789-0" });
  assert.equal(r.transacoes.length, 2);
  assert.deepEqual(r.transacoes[0], {
    fitid: "A1",
    data: "2026-10-05",
    valor: 1500,
    descricao: "PIX RECEBIDO CLIENTE",
    documento: null,
  });
  assert.equal(r.transacoes[1]?.valor, -89.9);
  assert.equal(r.transacoes[1]?.descricao, "TARIFA & CIA");
  assert.equal(r.transacoes[1]?.documento, "77");
});

test("lê OFX em XML (versão 2)", () => {
  const xml = `<?xml version="1.0"?><OFX><STMTTRN><DTPOSTED>20261101</DTPOSTED><TRNAMT>-10.50</TRNAMT><FITID>X9</FITID><MEMO>Café</MEMO></STMTTRN></OFX>`;
  const r = lerOfx(xml);
  assert.deepEqual(r.erros, []);
  assert.equal(r.transacoes[0]?.valor, -10.5);
  assert.equal(r.transacoes[0]?.data, "2026-11-01");
});

test("valores com vírgula e milhar", () => {
  assert.equal(valorOfx("1.234,56"), 1234.56);
  assert.equal(valorOfx("-1,234.56"), -1234.56);
  assert.equal(valorOfx("-0,5"), -0.5);
  assert.equal(valorOfx("abc"), null);
  assert.equal(valorOfx(null), null);
});

test("datas inválidas são recusadas", () => {
  assert.equal(dataOfx("20261301"), null);
  assert.equal(dataOfx("20260231"), null);
  assert.equal(dataOfx("2026"), null);
  assert.equal(dataOfx("20261231235959[0:GMT]"), "2026-12-31");
});

test("linhas ruins viram erro e não entram; FITID repetido é recusado", () => {
  const r = lerOfx(`<OFX>
<STMTTRN><DTPOSTED>20261001<TRNAMT>10<FITID>1</STMTTRN>
<STMTTRN><DTPOSTED>20261001<TRNAMT>10<FITID>1</STMTTRN>
<STMTTRN><DTPOSTED>xx<TRNAMT>10<FITID>2</STMTTRN>
<STMTTRN><DTPOSTED>20261001<TRNAMT>0<FITID>3</STMTTRN>
<STMTTRN><DTPOSTED>20261001<TRNAMT>5</STMTTRN>
</OFX>`);
  assert.equal(r.transacoes.length, 1);
  assert.equal(r.erros.length, 4);
});

test("arquivo que não é OFX", () => {
  assert.equal(lerOfx("data;valor\n1;2").erros.length, 1);
  assert.equal(lerOfx("<OFX></OFX>").transacoes.length, 0);
});

test("aviso quando o número da conta não bate", () => {
  const cad = { conta: "56789", conta_digito: "0" };
  assert.equal(contaPareceOutra({ banco: null, agencia: null, conta: "56789-0" }, cad), false);
  assert.equal(contaPareceOutra({ banco: null, agencia: null, conta: "000056789" }, cad), false);
  assert.equal(contaPareceOutra({ banco: null, agencia: null, conta: "11111-1" }, cad), true);
  assert.equal(contaPareceOutra({ banco: null, agencia: null, conta: null }, cad), false);
});
