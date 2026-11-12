import assert from "node:assert/strict";
import { test } from "node:test";
import { apurarIbsCbs, type NotaApuracao } from "../src/lib/apuracao-ibs-cbs.ts";

const nota = (
  efeito: string | null,
  ibs: number,
  cbs: number,
  situacao = "autorizada",
): NotaApuracao => ({
  situacao,
  valor_ibs: ibs,
  valor_cbs: cbs,
  ibs_cbs_efeito: efeito,
});

test("apuração: débito das vendas menos crédito das compras, IBS e CBS separados", () => {
  const a = apurarIbsCbs({
    notas: [nota("debito", 10, 90), nota("debito", 5, 45)],
    credito: { ibs: 4, cbs: 36 },
  });
  assert.deepEqual(a.debito, { ibs: 15, cbs: 135 });
  assert.deepEqual(a.credito, { ibs: 4, cbs: 36 });
  assert.deepEqual(a.saldo, { ibs: 11, cbs: 99 });
  assert.equal(a.notas, 2);
});

test("devolução de venda estorna o débito e devolução de compra estorna o crédito", () => {
  const a = apurarIbsCbs({
    notas: [nota("debito", 10, 90), nota("estorno_debito", 2, 18), nota("estorno_credito", 1, 9)],
    credito: { ibs: 4, cbs: 36 },
  });
  assert.deepEqual(a.debitoLiquido, { ibs: 8, cbs: 72 });
  assert.deepEqual(a.creditoLiquido, { ibs: 3, cbs: 27 });
  assert.deepEqual(a.saldo, { ibs: 5, cbs: 45 });
  assert.equal(a.notas, 3);
});

test("saldo negativo quando o crédito passa do débito, e IBS não compensa CBS", () => {
  const a = apurarIbsCbs({ notas: [nota("debito", 1, 20)], credito: { ibs: 5, cbs: 2 } });
  assert.deepEqual(a.saldo, { ibs: -4, cbs: 18 });
});

test("só notas autorizadas e com efeito entram", () => {
  const a = apurarIbsCbs({
    notas: [
      nota("debito", 10, 90),
      nota("debito", 99, 99, "cancelada"),
      nota("debito", 99, 99, "rascunho"),
      nota("debito", 99, 99, "rejeitada"),
      nota("debito", 99, 99, "transmitida"),
      nota(null, 99, 99),
      nota("outro", 99, 99),
    ],
    credito: { ibs: 0, cbs: 0 },
  });
  assert.deepEqual(a.debito, { ibs: 10, cbs: 90 });
  assert.equal(a.notas, 1);
});

test("valores inválidos ou negativos contam como zero e o resultado fecha em centavos", () => {
  const a = apurarIbsCbs({
    notas: [
      nota("debito", -5, 0.004),
      { situacao: "autorizada", valor_ibs: "abc", valor_cbs: null, ibs_cbs_efeito: "debito" },
      nota("debito", 0.1, 0.2),
      nota("debito", 0.2, 0.1),
    ],
    credito: { ibs: Number.NaN, cbs: -1 },
  });
  assert.deepEqual(a.debito, { ibs: 0.3, cbs: 0.3 });
  assert.deepEqual(a.credito, { ibs: 0, cbs: 0 });
  assert.deepEqual(a.saldo, { ibs: 0.3, cbs: 0.3 });
});

test("sem notas nem crédito, tudo zero", () => {
  const a = apurarIbsCbs({ notas: [], credito: { ibs: 0, cbs: 0 } });
  assert.deepEqual(a.saldo, { ibs: 0, cbs: 0 });
  assert.equal(a.notas, 0);
});
