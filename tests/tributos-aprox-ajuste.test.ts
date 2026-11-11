import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ajusteVigente,
  regraComAjuste,
  textoTributos,
  tributosDoItem,
  type AjusteTributos,
  type RegraTributos,
} from "../src/lib/tributos-aprox.ts";

const base: RegraTributos = {
  ncm: "84713012",
  aliq_nacional_federal: 10,
  aliq_importado_federal: 15,
  aliq_estadual: 18,
  aliq_municipal: 0,
  vigencia_fim: "2026-11-30",
  versao: "26.2.C",
  fonte: "IBPT/empresometro.com.br",
};
const ajuste: AjusteTributos = {
  ncm: "84713012",
  aliq_nacional_federal: 5,
  aliq_importado_federal: 8,
  aliq_estadual: 12,
  aliq_municipal: 1,
  valido_ate: "2026-12-31",
};

test("ajuste vigente vale no lugar da IBPT e marca a regra como ajustada", () => {
  const r = regraComAjuste(base, ajuste, "2026-11-15")!;
  assert.equal(r.ajustada, true);
  assert.equal(r.aliq_estadual, 12);
  assert.equal(r.vigencia_fim, "2026-12-31");
  // versão e fonte da IBPT seguem rastreáveis, e a linha original não muda
  assert.equal(r.versao, "26.2.C");
  assert.equal(base.aliq_estadual, 18);
  assert.equal(base.ajustada, undefined);
});

test("ajuste vencido, removido ou de outro NCM não vale: fica a regra da IBPT", () => {
  assert.equal(regraComAjuste(base, ajuste, "2027-01-01"), base);
  assert.equal(
    regraComAjuste(base, { ...ajuste, removido_em: "2026-11-10T10:00:00Z" }, "2026-11-15"),
    base,
  );
  assert.equal(regraComAjuste(base, { ...ajuste, ncm: "84713019" }, "2026-11-15"), base);
  assert.equal(regraComAjuste(base, null, "2026-11-15"), base);
});

test("sem linha da IBPT não há regra: o ajuste sozinho não é aplicado", () => {
  assert.equal(regraComAjuste(null, ajuste, "2026-11-15"), null);
  assert.equal(regraComAjuste(undefined, ajuste, "2026-11-15"), null);
});

test("ajusteVigente: nunca sem data, vale no último dia", () => {
  assert.equal(ajusteVigente(ajuste, "2026-12-31"), true);
  assert.equal(ajusteVigente(ajuste, "2027-01-01"), false);
  assert.equal(ajusteVigente({ ...ajuste, valido_ate: "" }, "2026-11-15"), false);
  assert.equal(ajusteVigente(undefined, "2026-11-15"), false);
});

test("a alíquota ajustada entra no cálculo do item", () => {
  const r = regraComAjuste(base, ajuste, "2026-11-15")!;
  const t = tributosDoItem(100, 0, r);
  assert.deepEqual(t, { federal: 5, estadual: 12, municipal: 1, total: 18 });
});

test("o texto da nota diz que o valor ajustado não é da IBPT", () => {
  const totais = { federal: 5, estadual: 12, municipal: 1, total: 18, baseTotal: 100 };
  const com = textoTributos(totais, base.fonte!, base.versao, ["84713012"]);
  assert.match(com, /ajustadas pelo contribuinte \(não são da IBPT\).*84713012/);
  assert.match(com, /Fonte: IBPT\/empresometro\.com\.br \(versão 26\.2\.C\)/);
  const sem = textoTributos(totais, base.fonte!, base.versao);
  assert.doesNotMatch(sem, /ajustadas/);
});
