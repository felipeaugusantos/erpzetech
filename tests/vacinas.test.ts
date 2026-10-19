import assert from "node:assert/strict";
import test from "node:test";

import {
  ATALHOS_PROXIMA_DOSE,
  SUGESTOES_CATALOGO,
  dataDoAtalho,
  diasAte,
  resumoDoProtocolo,
  rotuloDose,
  situacaoDaDose,
} from "../src/lib/vacinas.ts";

test("rótulo da dose: série e reforços", () => {
  assert.equal(rotuloDose("serie", 1), "1ª dose");
  assert.equal(rotuloDose("serie", 3), "3ª dose");
  assert.equal(rotuloDose("reforco", 1), "Reforço");
  assert.equal(rotuloDose("reforco", 2), "2º reforço");
});

test("dias até a data atravessa mês e ano", () => {
  assert.equal(diasAte("2026-10-20", "2026-10-19"), 1);
  assert.equal(diasAte("2026-10-19", "2026-10-19"), 0);
  assert.equal(diasAte("2027-01-01", "2026-12-31"), 1);
  assert.equal(diasAte("2026-10-01", "2026-10-19"), -18);
});

test("situação da próxima dose: atrasada, próxima (30 dias) ou em dia", () => {
  const hoje = "2026-10-19";
  assert.equal(situacaoDaDose("2026-10-18", hoje), "atrasada");
  assert.equal(situacaoDaDose("2026-10-19", hoje), "proxima");
  assert.equal(situacaoDaDose("2026-11-18", hoje), "proxima");
  assert.equal(situacaoDaDose("2026-11-19", hoje), "em_dia");
});

test("resumo do protocolo", () => {
  assert.equal(
    resumoDoProtocolo({ doses_serie: 3, intervalo_serie_dias: 21, reforco_dias: 365 }),
    "3 doses a cada 21 dias, depois reforço a cada 365 dias",
  );
  assert.equal(
    resumoDoProtocolo({ doses_serie: 1, intervalo_serie_dias: null, reforco_dias: 90 }),
    "Reforço a cada 90 dias",
  );
});

test("as sugestões do catálogo respeitam as regras do banco", () => {
  assert.ok(SUGESTOES_CATALOGO.length >= 4);
  for (const s of SUGESTOES_CATALOGO) {
    assert.ok(s.reforco_dias >= 1 && s.reforco_dias <= 1100, s.nome);
    assert.ok(s.doses_serie >= 1 && s.doses_serie <= 10, s.nome);
    if (s.doses_serie > 1) assert.ok((s.intervalo_serie_dias ?? 0) >= 1, s.nome);
  }
});

test("atalhos da próxima dose: 21 dias, 30 dias e 1 ano a partir da aplicação", () => {
  const [d21, d30, ano] = ATALHOS_PROXIMA_DOSE;
  assert.equal(dataDoAtalho("2026-10-19", d21!), "2026-11-09");
  assert.equal(dataDoAtalho("2026-10-19", d30!), "2026-11-18");
  assert.equal(dataDoAtalho("2026-10-19", ano!), "2027-10-19");
  assert.equal(dataDoAtalho("2026-12-20", d21!), "2027-01-10");
});

test("1 ano a partir de 29/02 cai em 28/02 do ano seguinte", () => {
  assert.equal(dataDoAtalho("2028-02-29", { anos: 1 }), "2029-02-28");
  assert.equal(dataDoAtalho("2028-02-29", { anos: 4 }), "2032-02-29");
});
