import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Cofre, armazemEmMemoria, erroDaSenha } from "../src/lib/cofre.ts";

const RAPIDO = 1000; // iterações baixas só para os testes

describe("erroDaSenha", () => {
  it("exige 8 caracteres e confirmação igual", () => {
    assert.match(erroDaSenha("curta") ?? "", /8 caracteres/);
    assert.equal(erroDaSenha("senha-longa"), null);
    assert.match(erroDaSenha("senha-longa", "outra-coisa") ?? "", /não são iguais/);
    assert.equal(erroDaSenha("senha-longa", "senha-longa"), null);
  });
});

describe("Cofre", () => {
  it("cria, grava e lê de volta", async () => {
    const cofre = new Cofre(armazemEmMemoria(), RAPIDO);
    assert.equal(await cofre.existe(), false);
    await cofre.criar("senha-do-notebook");
    assert.equal(cofre.aberto, true);
    await cofre.gravar("fila", "a", { paciente: "Rex", queixa: "tosse" });
    assert.deepEqual(await cofre.ler("fila", "a"), { paciente: "Rex", queixa: "tosse" });
    assert.equal(await cofre.ler("fila", "inexistente"), undefined);
  });

  it("nada fica legível no armazenamento", async () => {
    const arm = armazemEmMemoria();
    const cofre = new Cofre(arm, RAPIDO);
    await cofre.criar("senha-do-notebook");
    await cofre.gravar("fila", "a", { paciente: "Rex Segredo", queixa: "tosse seca" });
    await cofre.gravar("copia", "atual", { tutor: "Maria Silva", telefone: "16 99999-0000" });
    const bruto = JSON.stringify([...arm.bruto.values()]);
    for (const trecho of ["Rex", "Segredo", "tosse", "Maria", "Silva", "99999", "ze-tech-cofre"]) {
      assert.equal(bruto.includes(trecho), false, trecho);
    }
  });

  it("travado não abre; a senha errada não destrava; a certa destrava", async () => {
    const arm = armazemEmMemoria();
    const a = new Cofre(arm, RAPIDO);
    await a.criar("senha-do-notebook");
    await a.gravar("fila", "a", { x: 1 });
    a.travar();
    assert.equal(a.aberto, false);
    await assert.rejects(() => a.ler("fila", "a"), /travado/);
    await assert.rejects(() => a.gravar("fila", "b", 1), /travado/);
    assert.equal(await a.destravar("senha-errada"), false);
    assert.equal(a.aberto, false);
    assert.equal(await a.destravar("senha-do-notebook"), true);
    assert.deepEqual(await a.ler("fila", "a"), { x: 1 });
  });

  it("outro Cofre sobre o mesmo armazém (outra aba, outra sessão) abre com a mesma senha", async () => {
    const arm = armazemEmMemoria();
    const a = new Cofre(arm, RAPIDO);
    await a.criar("senha-do-notebook");
    await a.gravar("copia", "atual", { v: 7 });
    const b = new Cofre(arm, RAPIDO);
    assert.equal(await b.existe(), true);
    assert.equal(await b.destravar("senha-do-notebook"), true);
    assert.deepEqual(await b.ler("copia", "atual"), { v: 7 });
  });

  it("não cria duas vezes nem com senha curta", async () => {
    const cofre = new Cofre(armazemEmMemoria(), RAPIDO);
    await assert.rejects(() => cofre.criar("curta"), /8 caracteres/);
    await cofre.criar("senha-do-notebook");
    await assert.rejects(() => cofre.criar("outra-senha-boa"), /Já existe/);
    await assert.rejects(
      () => new Cofre(armazemEmMemoria(), RAPIDO).destravar("qualquer-senha"),
      /Ainda não existe/,
    );
  });

  it("registro adulterado ou trocado de lugar não abre e aparece como ilegível", async () => {
    const arm = armazemEmMemoria();
    const cofre = new Cofre(arm, RAPIDO);
    await cofre.criar("senha-do-notebook");
    await cofre.gravar("fila", "a", { x: "A" });
    await cofre.gravar("fila", "b", { x: "B" });
    // troca o conteúdo de "a" pelo de "b": o cifrado está amarrado ao seu lugar
    const doB = await arm.ler("fila", "b");
    await arm.gravar("fila", "a", doB);
    await assert.rejects(() => cofre.ler("fila", "a"));
    const { itens, ilegiveis } = await cofre.listar<{ x: string }>("fila");
    assert.deepEqual(ilegiveis, ["a"]);
    assert.deepEqual(itens, [["b", { x: "B" }]]);
    // lixo no lugar do cifrado
    await arm.gravar("fila", "c", { qualquer: "coisa" });
    assert.deepEqual((await cofre.listar("fila")).ilegiveis.sort(), ["a", "c"]);
  });

  it("listar separa as lojas e apagar tira um registro", async () => {
    const cofre = new Cofre(armazemEmMemoria(), RAPIDO);
    await cofre.criar("senha-do-notebook");
    await cofre.gravar("fila", "1", "um");
    await cofre.gravar("fila", "2", "dois");
    await cofre.gravar("copia", "atual", "copia");
    assert.equal((await cofre.listar("fila")).itens.length, 2);
    await cofre.apagar("fila", "1");
    assert.deepEqual((await cofre.listar<string>("fila")).itens, [["2", "dois"]]);
    assert.equal((await cofre.listar("copia")).itens.length, 1);
  });

  it("apagar tudo remove senha, fila e cópia", async () => {
    const arm = armazemEmMemoria();
    const cofre = new Cofre(arm, RAPIDO);
    await cofre.criar("senha-do-notebook");
    await cofre.gravar("fila", "1", "um");
    await cofre.apagarTudo();
    assert.equal(cofre.aberto, false);
    assert.equal(arm.bruto.size, 0);
    assert.equal(await cofre.existe(), false);
  });
});
