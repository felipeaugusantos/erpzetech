import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agruparPorDia, diaBrasilia, horaBrasilia, isoDeBrasilia } from "../src/lib/clinica-agenda-exames.ts";

describe("agenda de exames", () => {
  it("23h30 de Brasília fica no mesmo dia, mesmo já sendo o dia seguinte em UTC", () => {
    const iso = new Date(isoDeBrasilia("2026-11-12", "23:30")).toISOString();
    assert.equal(iso, "2026-11-13T02:30:00.000Z");
    assert.equal(diaBrasilia(iso), "2026-11-12");
    assert.equal(horaBrasilia(iso), "23:30");
  });
  it("agrupa por dia em ordem", () => {
    const g = agruparPorDia([
      { agendado_para: "2026-11-14T12:00:00Z" },
      { agendado_para: "2026-11-13T12:00:00Z" },
      { agendado_para: "2026-11-13T15:00:00Z" },
    ]);
    assert.deepEqual(g.map(([d, l]) => [d, l.length]), [["2026-11-13", 2], ["2026-11-14", 1]]);
  });
});
