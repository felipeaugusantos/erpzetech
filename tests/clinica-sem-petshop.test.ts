import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MARCADOR_SEM_PETSHOP,
  contratoSemPetshop,
  moduloLiberadoEmpresa,
} from "../src/lib/cnae-regras.ts";
import { ehEmpresaPet, ehEmpresaSoClinica, itemPetVisivel } from "../src/lib/ramo-clinica.ts";

const CNPJ = "11222333000181";

describe("contrato: clínica sem pet shop", () => {
  it("sem o marcador nada muda: a clínica continua liberando o pet shop", () => {
    const porRamo = { cnpj: CNPJ, ramo_atividade: "clinica", modulos_liberados: [] };
    const porCnae = { cnpj: CNPJ, cnae: "7500-1/00", modulos_liberados: [] };
    const explicita = { cnpj: CNPJ, modulos_liberados: ["clinica"] };
    for (const e of [porRamo, porCnae, explicita]) {
      assert.equal(contratoSemPetshop(e), false);
      assert.equal(moduloLiberadoEmpresa(e, "clinica"), true);
      assert.equal(moduloLiberadoEmpresa(e, "petshop"), true);
    }
  });

  it("com o marcador, a clínica fica e o pet shop sai, mesmo com ramo e CNAE veterinários", () => {
    const e = {
      cnpj: CNPJ,
      ramo_atividade: "clinica",
      cnae: "7500-1/00",
      modulos_liberados: ["clinica", MARCADOR_SEM_PETSHOP],
    };
    assert.equal(contratoSemPetshop(e), true);
    assert.equal(moduloLiberadoEmpresa(e, "clinica"), true);
    assert.equal(moduloLiberadoEmpresa(e, "petshop"), false);
  });

  it("o marcador não desfaz o 'só clínica' (não conta como outro módulo)", () => {
    const e = { cnpj: CNPJ, ramo_atividade: "clinica", modulos_liberados: [MARCADOR_SEM_PETSHOP] };
    assert.equal(ehEmpresaSoClinica(e), true);
    assert.equal(ehEmpresaPet(e), true);
    // outro módulo liberado continua desfazendo o "só clínica"
    assert.equal(
      ehEmpresaSoClinica({ ...e, modulos_liberados: [MARCADOR_SEM_PETSHOP, "obras"] }),
      false,
    );
  });

  it("só a liberação explícita do pet shop vale com o marcador", () => {
    const base = { cnpj: CNPJ, ramo_atividade: "clinica" };
    assert.equal(
      moduloLiberadoEmpresa(
        { ...base, modulos_liberados: [MARCADOR_SEM_PETSHOP, "petshop"] },
        "petshop",
      ),
      true,
    );
    // escolha manual sem CNPJ não derruba o contrato
    assert.equal(
      moduloLiberadoEmpresa(
        {
          cnpj: "",
          ramo_atividade: "petshop",
          modulos_sem_cnpj: ["petshop"],
          modulos_liberados: [MARCADOR_SEM_PETSHOP],
        },
        "petshop",
      ),
      false,
    );
  });

  it("só pet shop continua só pet shop (sem clínica)", () => {
    const e = { cnpj: CNPJ, ramo_atividade: "petshop", modulos_liberados: [] };
    assert.equal(moduloLiberadoEmpresa(e, "petshop"), true);
    assert.equal(moduloLiberadoEmpresa(e, "clinica"), false);
  });

  it("menu: com o pet shop todos os itens aparecem; sem ele, só os que a clínica usa", () => {
    const itens = [
      "/pet-agenda",
      "/pets",
      "/pet-os",
      "/pet-servicos",
      "/pet-profissionais",
      "/pet-campos",
      "/pet-contatos",
      "/pet-pacotes",
      "/pet-comissoes",
    ];
    for (const i of itens) assert.equal(itemPetVisivel(i, true), true, i);
    assert.deepEqual(
      itens.filter((i) => itemPetVisivel(i, false)),
      [
        "/pet-agenda",
        "/pets",
        "/pet-servicos",
        "/pet-profissionais",
        "/pet-campos",
        "/pet-contatos",
      ],
    );
    assert.equal(itemPetVisivel(undefined, false), false);
    assert.equal(itemPetVisivel("/clinica-prontuario", false), false);
  });
});
