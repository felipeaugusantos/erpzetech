import { describe, expect, it } from "vitest";
import { limiteOrcamentoParado, pendenciasVisiveis } from "../src/lib/pendencias";

const c = (to: string, total: number) => ({ chave: to, to, titulo: to, total });

describe("pendências do dia", () => {
  it("esconde tela que a pessoa não vê no menu", () => {
    expect(pendenciasVisiveis([c("/contas-pagar", 3)], ["/estoque"])).toEqual([]);
  });
  it("esconde pendência zerada", () => {
    expect(pendenciasVisiveis([c("/estoque", 0)], ["/estoque"])).toEqual([]);
  });
  it("orçamento parado é de 48 horas", () => {
    expect(limiteOrcamentoParado(new Date("2026-11-14T12:00:00Z"))).toBe("2026-11-12T12:00:00.000Z");
  });
});
