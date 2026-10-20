import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VALIDADE_COPIA_DIAS,
  copiaVencida,
  resumoDaCopia,
  tutoresDaCopia,
  validadeDaCopia,
  type CopiaVisita,
} from "../src/lib/visita.ts";

describe("validade da cópia", () => {
  it("vale 7 dias a partir de quando foi gerada", () => {
    const gerada = new Date("2026-10-19T12:00:00Z");
    assert.equal(VALIDADE_COPIA_DIAS, 7);
    assert.equal(validadeDaCopia(gerada), "2026-10-26T12:00:00.000Z");
  });
  it("vence no instante da validade", () => {
    const c = { validaAte: "2026-10-26T12:00:00.000Z" };
    assert.equal(copiaVencida(c, new Date("2026-10-26T11:59:59Z")), false);
    assert.equal(copiaVencida(c, new Date("2026-10-26T12:00:00Z")), true);
    assert.equal(copiaVencida(c, new Date("2026-11-01T00:00:00Z")), true);
  });
});

describe("resumoDaCopia", () => {
  it("conta consultas, vacinas, lotes e modelos", () => {
    const copia = {
      geradaEm: "x",
      validaAte: "y",
      dados: {
        de: "2026-10-19",
        ate: "2026-10-19",
        veterinario: { id: "1", nome: "Vet", crmv: "1", crmv_uf: "SP" },
        agenda: [{}, {}],
        catalogo_vacinas: [{ lotes: [{}, {}] }, { lotes: [] }, {}],
        modelos_exame: [{}, {}, {}],
        aplicadores: [],
      },
    } satisfies CopiaVisita;
    assert.deepEqual(resumoDaCopia(copia), { consultas: 2, vacinas: 3, lotes: 2, modelos: 3 });
  });
});

describe("tutoresDaCopia", () => {
  const copia = (agenda: unknown[]) =>
    ({
      dados: {
        de: "",
        ate: "",
        veterinario: { id: "", nome: "", crmv: "", crmv_uf: "" },
        agenda,
        catalogo_vacinas: [],
        modelos_exame: [],
        aplicadores: [],
      },
    }) satisfies Pick<CopiaVisita, "dados">;
  it("junta os tutores da agenda sem repetir, em ordem de nome", () => {
    const t = tutoresDaCopia(
      copia([
        { tutor: { id: "2", nome: "Zélia", telefone: "(16) 99999-0000" } },
        { tutor: { id: "1", nome: "Ana", telefone: null } },
        { tutor: { id: "2", nome: "Zélia", telefone: "(16) 99999-0000" } },
      ]),
    );
    assert.deepEqual(t, [
      { id: "1", nome: "Ana", telefone: null },
      { id: "2", nome: "Zélia", telefone: "(16) 99999-0000" },
    ]);
  });
  it("ignora item sem tutor ou fora do formato", () => {
    assert.deepEqual(
      tutoresDaCopia(copia([null, {}, { tutor: { id: 5, nome: "x" } }, { tutor: { id: "3" } }])),
      [],
    );
  });
});
