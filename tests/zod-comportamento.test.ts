import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { definirContratoClinica } from "../src/lib/contrato-clinica.ts";
import { cadastroEquipe } from "../src/lib/equipe-ze-tech.ts";
import { chamadoInput } from "../src/lib/help-chamados.ts";

// Trava o comportamento dos esquemas que o app usa na entrada de dados. Serve para a troca de versão do zod não mudar,
// sem querer, o que é aceito ou recusado (ids de demonstração, e-mails, campos extras, mensagens).
const V4 = "3f2c9d1e-8a7b-4c5d-9e6f-0a1b2c3d4e5f";
const DEMO = "11111111-1111-1111-1111-111111111111"; // id de demonstração (não é um UUID v4 de verdade)

describe("zod: ids", () => {
  it("o id da empresa aceita UUID comum e id de demonstração, e recusa o que não é id", () => {
    for (const id of [V4, DEMO, V4.toUpperCase()])
      assert.equal(
        definirContratoClinica.safeParse({ empresaId: id, semPetshop: true }).success,
        true,
        id,
      );
    for (const id of [
      "",
      "abc",
      "123",
      `${V4}x`,
      "g2c9d1e-8a7b-4c5d-9e6f-0a1b2c3d4e5f",
      null,
      undefined,
    ])
      assert.equal(
        definirContratoClinica.safeParse({ empresaId: id, semPetshop: true }).success,
        false,
        String(id),
      );
  });

  it("a mensagem do id inválido continua clara", () => {
    const r = definirContratoClinica.safeParse({ empresaId: "x", semPetshop: true });
    assert.equal(r.success, false);
    assert.equal(r.error?.issues[0]?.message, "Empresa inválida.");
  });

  it("o chamado aceita o id de repetição de qualquer UUID e recusa o resto", () => {
    const base = {
      subject: "Assunto",
      description: "Descrição",
      priority: "normal",
      name: "Maria",
      email: "maria@empresa.com.br",
    };
    for (const id of [V4, DEMO])
      assert.equal(chamadoInput.safeParse({ ...base, requestId: id }).success, true, id);
    assert.equal(chamadoInput.safeParse({ ...base, requestId: "nao-e-uuid" }).success, false);
  });
});

describe("zod: chamado do Help Ze Tech", () => {
  const ok = {
    requestId: V4,
    subject: "Assunto",
    description: "Descrição do problema",
    priority: "alta",
    name: "Maria Souza",
    email: "maria@empresa.com.br",
  };

  it("aceita o formato válido e apara os espaços", () => {
    const r = chamadoInput.safeParse({
      ...ok,
      subject: "  Assunto  ",
      name: "  Maria Souza ",
      email: " maria@empresa.com.br ",
    });
    assert.equal(r.success, true);
    assert.equal(r.data?.subject, "Assunto");
    assert.equal(r.data?.name, "Maria Souza");
    assert.equal(r.data?.email, "maria@empresa.com.br");
  });

  it("recusa campo extra (strict), texto curto ou longo demais, prioridade e e-mail inválidos", () => {
    assert.equal(chamadoInput.safeParse({ ...ok, extra: 1 }).success, false);
    assert.equal(chamadoInput.safeParse({ ...ok, subject: "ab" }).success, false);
    assert.equal(chamadoInput.safeParse({ ...ok, subject: "a".repeat(201) }).success, false);
    assert.equal(chamadoInput.safeParse({ ...ok, description: "x".repeat(20001) }).success, false);
    assert.equal(chamadoInput.safeParse({ ...ok, priority: "urgente" }).success, false);
    assert.equal(chamadoInput.safeParse({ ...ok, email: "sem-arroba" }).success, false);
    assert.equal(chamadoInput.safeParse({ ...ok, email: "a@b" }).success, false);
    assert.equal(
      chamadoInput.safeParse({ ...ok, email: `${"a".repeat(150)}@empresa.com.br` }).success,
      false,
    );
  });

  it("e-mails comuns do dia a dia são aceitos", () => {
    for (const email of [
      "a.b@empresa.com.br",
      "nome+tag@gmail.com",
      "x_y-z@sub.dominio.com",
      "FULANO@EMPRESA.COM",
    ])
      assert.equal(chamadoInput.safeParse({ ...ok, email }).success, true, email);
  });
});

describe("zod: cadastro da equipe", () => {
  const novo = {
    nome: "Maria Souza",
    email: "maria@empresa.com.br",
    modo: "novo",
    senha: "umasenhalonga12",
  };

  it("e-mail vem aparado e em minúsculas", () => {
    const r = cadastroEquipe.safeParse({ ...novo, email: "  Maria@Empresa.COM.br " });
    assert.equal(r.success, true);
    assert.equal(r.data?.email, "maria@empresa.com.br");
    assert.equal(
      cadastroEquipe.safeParse({ ...novo, email: "invalido" }).error?.issues[0]?.message,
      "E-mail inválido.",
    );
  });

  it("conta nova exige senha de 12 caracteres; conta existente não exige", () => {
    const curta = cadastroEquipe.safeParse({ ...novo, senha: "curta" });
    assert.equal(curta.success, false);
    assert.equal(curta.error?.issues[0]?.message, "Use uma senha com pelo menos 12 caracteres.");
    assert.deepEqual(curta.error?.issues[0]?.path, ["senha"]);
    assert.equal(cadastroEquipe.safeParse({ ...novo, modo: "existente", senha: "" }).success, true);
  });

  it("nome com tamanho e modo fora da lista", () => {
    assert.equal(
      cadastroEquipe.safeParse({ ...novo, nome: "A" }).error?.issues[0]?.message,
      "Informe o nome.",
    );
    assert.equal(cadastroEquipe.safeParse({ ...novo, nome: "x".repeat(121) }).success, false);
    assert.equal(cadastroEquipe.safeParse({ ...novo, modo: "outro" }).success, false);
    assert.equal(cadastroEquipe.safeParse({ ...novo, senha: "x".repeat(129) }).success, false);
  });
});
