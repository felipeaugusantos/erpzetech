import assert from "node:assert/strict";
import { test } from "node:test";

import {
  camposAtivos,
  erroDosCampos,
  erroDoValor,
  opcoesDoTexto,
  valoresParaEnvio,
  valorLegivel,
  type CampoPet,
} from "../src/lib/pet-campos.ts";

const campo = (o: Partial<CampoPet>): CampoPet => ({
  id: "c1",
  entidade: "pet",
  nome: "Campo",
  tipo: "texto",
  opcoes: [],
  obrigatorio: false,
  ordem: 0,
  ativo: true,
  ...o,
});

test("opções: uma por linha ou com ponto e vírgula, sem vazias nem repetidas", () => {
  assert.deepEqual(opcoesDoTexto("A\n b ;A\n\nC"), ["A", "b", "C"]);
});

test("valor vazio só falha quando o campo é obrigatório", () => {
  assert.equal(erroDoValor(campo({}), ""), null);
  assert.match(erroDoValor(campo({ obrigatorio: true, nome: "Pedigree" }), " ") ?? "", /Pedigree/);
});

test("número, data, sim/não e lista são conferidos", () => {
  assert.equal(erroDoValor(campo({ tipo: "numero" }), "12,5"), null);
  assert.notEqual(erroDoValor(campo({ tipo: "numero" }), "12a"), null);
  assert.equal(erroDoValor(campo({ tipo: "data" }), "2026-02-28"), null);
  assert.notEqual(erroDoValor(campo({ tipo: "data" }), "2026-02-30"), null);
  assert.notEqual(erroDoValor(campo({ tipo: "data" }), "28/02/2026"), null);
  assert.equal(erroDoValor(campo({ tipo: "sim_nao" }), "sim"), null);
  assert.notEqual(erroDoValor(campo({ tipo: "sim_nao" }), "talvez"), null);
  assert.equal(erroDoValor(campo({ tipo: "lista", opcoes: ["A", "B"] }), "B"), null);
  assert.notEqual(erroDoValor(campo({ tipo: "lista", opcoes: ["A", "B"] }), "C"), null);
});

test("campos desativados ficam fora da conferência e do envio", () => {
  const lista = [
    campo({ id: "a", obrigatorio: true, ativo: false }),
    campo({ id: "b", tipo: "numero", ordem: 2 }),
    campo({ id: "c", entidade: "tutor", obrigatorio: true }),
  ];
  assert.equal(erroDosCampos(lista, "pet", {}), null);
  assert.notEqual(erroDosCampos(lista, "tutor", {}), null);
  assert.deepEqual(valoresParaEnvio(lista, "pet", { a: "x", b: "3,5" }), { b: "3.5" });
});

test("ordem: pela ordem e depois pelo nome", () => {
  const lista = [
    campo({ id: "1", nome: "Zeta", ordem: 1 }),
    campo({ id: "2", nome: "Beta", ordem: 1 }),
    campo({ id: "3", nome: "Alfa", ordem: 2 }),
  ];
  assert.deepEqual(
    camposAtivos(lista, "pet").map((c) => c.id),
    ["2", "1", "3"],
  );
});

test("texto para a tela e a impressão", () => {
  assert.equal(valorLegivel({ tipo: "sim_nao" }, "nao"), "Não");
  assert.equal(valorLegivel({ tipo: "data" }, "2026-03-09"), "09/03/2026");
  assert.equal(valorLegivel({ tipo: "numero" }, "3.5"), "3,5");
});
