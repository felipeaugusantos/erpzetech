import { describe, expect, it } from "vitest";
import { ajusteComercial, ratearValorReal } from "../src/lib/conferencia-fisica";

describe("conferência física da nota", () => {
  it("rateia o valor real pago (1225) entre solados e tiras, somando exatamente o pago", () => {
    // nota: 950 em placas que viraram 130 solados; tiras fora da nota com referência de R$ 2,75/par
    const custos = ratearValorReal(
      [
        { quantidade: 130, base: 950 },
        { quantidade: 80, base: 80 * 2.75 },
        { quantidade: 20, base: 20 * 2.75 },
      ],
      1225,
    );
    const total = 130 * custos[0] + 80 * custos[1] + 20 * custos[2];
    expect(Math.round(total * 100) / 100).toBe(1225);
    expect(custos[1]).toBe(custos[2]);
  });

  it("sem valor real, mantém o custo da nota", () => {
    expect(ratearValorReal([{ quantidade: 5, base: 950 }], null)).toEqual([190]);
  });

  it("item extra sem preço de referência divide o valor pela quantidade", () => {
    expect(ratearValorReal([{ quantidade: 130, base: 950 }, { quantidade: 100, base: 0 }], 1150)).toEqual([5, 5]);
  });

  it("calcula o complemento não faturado: 1225 pago − 950 da nota = 275", () => {
    expect(ajusteComercial(950, 1225)).toBe(275);
  });
});
