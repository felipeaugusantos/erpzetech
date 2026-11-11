import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AVISO_PETSHOP_EXPLICITO,
  ROTULO_CONTRATO,
  contratoDaEmpresa,
  definirContratoClinica,
  mensagemErroContrato,
  montarLinhasContrato,
} from "../src/lib/contrato-clinica.ts";

const CNPJ = "11222333000181";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("contrato da clínica (tela da equipe)", () => {
  it("só empresas com clínica entram, ordenadas pelo nome", () => {
    const empresas = [
      { id: B, nome_fantasia: "Zeta Vet", cnpj: CNPJ, ramo_atividade: "clinica" },
      { id: A, razao_social: "Alfa LTDA", cnpj: CNPJ, cnae: "7500-1/00" },
      { id: C, nome_fantasia: "Loja de roupas", cnpj: CNPJ, ramo_atividade: "varejo" },
    ];
    const linhas = montarLinhasContrato(empresas, []);
    assert.deepEqual(
      linhas.map((l) => l.nome),
      ["Alfa LTDA", "Zeta Vet"],
    );
  });

  it("padrão é clínica e pet shop; o marcador muda para só clínica", () => {
    const empresas = [
      { id: A, nome_fantasia: "A", cnpj: CNPJ, ramo_atividade: "clinica" },
      { id: B, nome_fantasia: "B", cnpj: CNPJ, ramo_atividade: "clinica" },
    ];
    const linhas = montarLinhasContrato(empresas, [{ empresa_id: B, modulo: "sem_petshop" }]);
    assert.equal(linhas.find((l) => l.id === A)?.contrato, "clinica_e_petshop");
    assert.equal(linhas.find((l) => l.id === B)?.contrato, "clinica_sem_petshop");
    assert.equal(ROTULO_CONTRATO.clinica_sem_petshop, "Só clínica (sem pet shop)");
  });

  it("pet shop explícito vence o marcador e é sinalizado", () => {
    const empresas = [{ id: D, nome_fantasia: "D", cnpj: CNPJ, ramo_atividade: "clinica" }];
    const [l] = montarLinhasContrato(empresas, [
      { empresa_id: D, modulo: "sem_petshop" },
      { empresa_id: D, modulo: "petshop" },
    ]);
    assert.equal(l?.contrato, "clinica_e_petshop");
    assert.equal(l?.petshopExplicito, true);
    assert.match(AVISO_PETSHOP_EXPLICITO, /explícita/);
    assert.equal(contratoDaEmpresa({ modulos_liberados: ["sem_petshop"] }), "clinica_sem_petshop");
  });

  it("valida a entrada: id de empresa e booleano", () => {
    assert.equal(
      definirContratoClinica.safeParse({ empresaId: A, semPetshop: true }).success,
      true,
    );
    assert.equal(
      definirContratoClinica.safeParse({ empresaId: "x", semPetshop: true }).success,
      false,
    );
    assert.equal(
      definirContratoClinica.safeParse({ empresaId: A, semPetshop: "sim" }).success,
      false,
    );
    assert.equal(definirContratoClinica.safeParse({ empresaId: A }).success, false);
  });

  it("traduz o erro do CHECK para pedir a migração", () => {
    assert.match(mensagemErroContrato("23514", ""), /0081_clinica_sem_petshop/);
    assert.match(
      mensagemErroContrato(
        null,
        'violates check constraint "empresa_modulos_liberados_modulo_check"',
      ),
      /0081_clinica_sem_petshop/,
    );
    assert.equal(mensagemErroContrato("XX000", "qualquer"), "Não foi possível salvar o contrato.");
  });
});
