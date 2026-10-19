import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { consultaPersistivel } from "../src/lib/cache-clinico.ts";

describe("consultaPersistivel", () => {
  it("dado clínico fica fora do cache salvo no navegador", () => {
    for (const k of [
      "clinica-exame",
      "clinica-exames-pet",
      "clinica-exame-evolucao",
      "clinica-historico",
      "clinica-atendimento",
      "clinica-cartao",
      "clinica-pacientes",
      "clinica-reforcos",
    ]) {
      assert.equal(consultaPersistivel([k, "x"]), false, k);
    }
  });
  it("o resto do sistema continua salvando", () => {
    assert.equal(consultaPersistivel(["produtos"]), true);
    assert.equal(consultaPersistivel(["pet-agenda", 1]), true);
    assert.equal(consultaPersistivel([]), true);
    assert.equal(consultaPersistivel([{ a: 1 }]), true);
  });
});
