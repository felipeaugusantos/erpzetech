import { describe, expect, it } from "vitest";
import { atalhoAtivo, periodoDoAtalho } from "../src/lib/periodo";

const hoje = new Date(2026, 10, 12);
describe("atalhos de período", () => {
  it("7 dias inclui hoje", () => expect(periodoDoAtalho("7d", hoje)).toEqual({ de: "2026-11-06", ate: "2026-11-12" }));
  it("mês atual começa no dia 1", () => expect(periodoDoAtalho("mes", hoje)).toEqual({ de: "2026-11-01", ate: "2026-11-12" }));
  it("mês anterior vai até o último dia", () => expect(periodoDoAtalho("mes-anterior", hoje)).toEqual({ de: "2026-10-01", ate: "2026-10-31" }));
  it("datas avulsas são personalizado", () => expect(atalhoAtivo({ de: "2026-11-03", ate: "2026-11-05" }, hoje)).toBeNull());
});
