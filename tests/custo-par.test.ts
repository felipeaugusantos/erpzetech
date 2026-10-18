import { describe, expect, it } from "bun:test";
import { custoPar, margemPar } from "../src/lib/personalizacao";

describe("custo do par", () => {
  it("soma tira, solado, fração da folha e outros", () => {
    const c = custoPar({ tira: 1.15, tirasPorPar: 1, solado: 4, soladosPorPar: 1, folha: 3, paresPorFolha: 4, outros: 0.5 });
    expect(c.folha).toBeCloseTo(0.75);
    expect(c.total).toBeCloseTo(6.4);
  });
  it("margem sobre o preço", () => {
    expect(margemPar(10, 6.4)).toBeCloseTo(36);
  });
});
