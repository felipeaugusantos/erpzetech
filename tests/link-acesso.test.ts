import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { erroDoLink, linkFinal, normalizarSlug } from "../src/lib/link-acesso.ts";

describe("link de acesso", () => {
  it("normaliza o que a pessoa digita", () => {
    assert.equal(normalizarSlug("Clínica Pé & Pelo!"), "clinica-pe-pelo-");
    assert.equal(normalizarSlug("  --Vet 24h"), "vet-24h");
    assert.equal(normalizarSlug("a".repeat(80)).length, 50);
  });

  it("tira hífen das pontas e vazio vira nulo", () => {
    assert.equal(linkFinal("clinica-pe-pelo-"), "clinica-pe-pelo");
    assert.equal(linkFinal("--"), null);
    assert.equal(linkFinal(""), null);
  });

  it("aceita de 3 a 50 letras, números e hífen", () => {
    assert.equal(erroDoLink(null), null);
    assert.equal(erroDoLink("vet"), null);
    assert.match(erroDoLink("ab") ?? "", /3 a 50/);
    assert.match(erroDoLink("Com Espaço") ?? "", /3 a 50/);
    assert.match(erroDoLink("-loja") ?? "", /3 a 50/);
  });

  it("recusa os nomes reservados do sistema", () => {
    for (const r of ["admin", "login", "auth", "ze-tech", "dashboard"])
      assert.match(erroDoLink(r) ?? "", /reservado/, r);
  });
});
