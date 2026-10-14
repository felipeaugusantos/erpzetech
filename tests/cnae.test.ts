import assert from "node:assert/strict";
import { test } from "node:test";

import { cnaesDaEmpresa, moduloLiberadoPorCnae } from "../src/lib/cnae-regras.ts";

test("CNAE 4321 (elétrica/CFTV) libera assistência técnica", () => {
  assert.equal(moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae: "4321-5/00" }), "assistencia"), true);
});

test("CNAE 4322 (ar-condicionado) libera assistência técnica", () => {
  assert.equal(moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae: "4322-3/02" }), "assistencia"), true);
});

test("CNAE 4321 não libera locação", () => {
  assert.equal(moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae: "4321-5/00" }), "locacao"), false);
});
