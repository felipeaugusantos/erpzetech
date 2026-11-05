import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  empresaLiberada,
  listaDeEmpresasLiberadas,
  separarPorLiberacao,
} from "../src/lib/whatsapp-liberacao.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("WhatsApp: trava por empresa", () => {
  it("lista vazia, ausente ou inválida não libera ninguém", () => {
    for (const bruto of [undefined, null, "", "   ", "abc", "123", ",;,", "1111-2222"]) {
      const lista = listaDeEmpresasLiberadas(bruto);
      assert.equal(lista.size, 0, String(bruto));
      assert.equal(empresaLiberada(A, lista), false);
    }
  });

  it("aceita vírgula, ponto e vírgula, espaço e quebra de linha, sem diferenciar maiúsculas", () => {
    const lista = listaDeEmpresasLiberadas(`${A.toUpperCase()}, ${B};\nlixo`);
    assert.equal(lista.size, 2);
    assert.equal(empresaLiberada(A, lista), true);
    assert.equal(empresaLiberada(B.toUpperCase(), lista), true);
  });

  it("empresa fora da lista, vazia ou nula é recusada", () => {
    const lista = listaDeEmpresasLiberadas(A);
    assert.equal(empresaLiberada(B, lista), false);
    assert.equal(empresaLiberada("", lista), false);
    assert.equal(empresaLiberada(null, lista), false);
    assert.equal(empresaLiberada(undefined, lista), false);
  });

  it("separa os itens reservados: só os da lista seguem para o envio", () => {
    const lista = listaDeEmpresasLiberadas(A);
    const itens = [
      { id: "1", tenant_id: A },
      { id: "2", tenant_id: B },
      { id: "3", tenant_id: A },
    ];
    const { liberados, bloqueados } = separarPorLiberacao(itens, lista);
    assert.deepEqual(
      liberados.map((i) => i.id),
      ["1", "3"],
    );
    assert.deepEqual(
      bloqueados.map((i) => i.id),
      ["2"],
    );
    const nenhum = separarPorLiberacao(itens, listaDeEmpresasLiberadas(""));
    assert.equal(nenhum.liberados.length, 0);
    assert.equal(nenhum.bloqueados.length, 3);
  });
});
