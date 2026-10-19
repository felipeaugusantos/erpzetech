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

test("pet shop e veterinária: só os códigos próprios liberam o módulo", () => {
  const libera = (cnae: string) => moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae }), "petshop");
  assert.equal(libera("7500-1/00"), true); // atividades veterinárias
  assert.equal(libera("4789-0/04"), true); // animais vivos e artigos de estimação
  assert.equal(libera("9609-2/08"), true); // higiene e embelezamento de animais
});

test("CNAE vizinho do pet shop não libera o módulo", () => {
  const libera = (cnae: string) => moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae }), "petshop");
  assert.equal(libera("4789-0/01"), false); // suvenires e artesanato
  assert.equal(libera("9609-2/99"), false); // outros serviços pessoais
  assert.equal(libera("4711-3/01"), false); // supermercado
  assert.equal(
    moduloLiberadoPorCnae(
      cnaesDaEmpresa({ cnae: "4711-3/01", cnae_secundarios: "7500-1/00" }),
      "petshop",
    ),
    true,
  );
});

test("clínica: só atividade veterinária libera prontuário e vacina", () => {
  const libera = (cnae: string) => moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae }), "clinica");
  assert.equal(libera("7500-1/00"), true);
  assert.equal(libera("4789-0/04"), false); // pet shop sozinho
  assert.equal(libera("9609-2/08"), false); // banho e tosa
  assert.equal(libera("7490-1/04"), false); // vizinho
});
