import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atalhoAtivo, periodoDoAtalho } from "../src/lib/periodo.ts";

const hoje = new Date(2026, 10, 12);
describe("atalhos de período", () => {
  it("7 dias inclui hoje", () => assert.deepEqual(periodoDoAtalho("7d", hoje), { de: "2026-11-06", ate: "2026-11-12" }));
  it("mês atual começa no dia 1", () => assert.deepEqual(periodoDoAtalho("mes", hoje), { de: "2026-11-01", ate: "2026-11-12" }));
  it("mês anterior vai até o último dia", () => assert.deepEqual(periodoDoAtalho("mes-anterior", hoje), { de: "2026-10-01", ate: "2026-10-31" }));
  it("datas avulsas são personalizado", () => assert.equal(atalhoAtivo({ de: "2026-11-03", ate: "2026-11-05" }, hoje), null));
});
