import { describe, expect, it } from "vitest";
import { filtrarTelas, lerMultiplicador } from "../src/lib/busca-telas";

const telas = [
  { label: "Contas a pagar", to: "/contas-pagar", grupo: "Financeiro" },
  { label: "Prontuário", to: "/clinica-prontuario", grupo: "Clínica" },
  { label: "Caixa", to: "/caixa", grupo: "Financeiro" },
];

describe("busca de telas", () => {
  it("ignora acentos", () => {
    expect(filtrarTelas(telas, "prontuario").map((t) => t.to)).toEqual(["/clinica-prontuario"]);
  });
  it("só devolve telas recebidas (as do menu da pessoa)", () => {
    expect(filtrarTelas(telas, "estoque")).toEqual([]);
  });
  it("começa-por vem primeiro", () => {
    expect(filtrarTelas(telas, "caixa")[0].to).toBe("/caixa");
  });
});

describe("multiplicador do leitor", () => {
  it("3*codigo vira 3 unidades", () => {
    expect(lerMultiplicador("3*7891234567890")).toEqual({ quantidade: 3, codigo: "7891234567890" });
  });
  it("aceita fração com vírgula", () => {
    expect(lerMultiplicador("0,5*123")).toEqual({ quantidade: 0.5, codigo: "123" });
  });
  it("sem asterisco é 1", () => {
    expect(lerMultiplicador("123")).toEqual({ quantidade: 1, codigo: "123" });
  });
});
