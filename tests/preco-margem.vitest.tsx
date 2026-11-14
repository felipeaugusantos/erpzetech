import { describe, expect, it } from "vitest";
import { margemSobrePreco, precoPelaMargem } from "../src/lib/preco-margem";

describe("preço pela margem", () => {
  it("custo 10 com 30% dá 14,29", () => expect(precoPelaMargem(10, 30)).toBe(14.29));
  it("margem de 100% ou mais é recusada", () => expect(precoPelaMargem(10, 100)).toBeNull());
  it("sem custo não sugere", () => expect(precoPelaMargem(0, 30)).toBeNull());
  it("margem de 14,29 sobre custo 10 é ~30%", () =>
    expect(Math.round(margemSobrePreco(10, 14.29))).toBe(30));
});
