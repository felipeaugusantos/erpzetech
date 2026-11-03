import assert from "node:assert/strict";
import { test } from "node:test";

import {
  osEncerrada,
  proximaSituacaoOsPet,
  rotuloTipoItemOs,
  totalDaOs,
  totalDoItem,
} from "../src/lib/pet-os.ts";

test("andamento normal da ordem do pet", () => {
  assert.deepEqual(proximaSituacaoOsPet("aberta"), {
    para: "orcamento",
    rotulo: "Enviar orçamento",
  });
  assert.equal(proximaSituacaoOsPet("aprovada")?.para, "em_reparo");
  assert.equal(proximaSituacaoOsPet("pronta")?.para, "entregue");
  assert.equal(proximaSituacaoOsPet("entregue"), null);
  assert.equal(proximaSituacaoOsPet("cancelada"), null);
});

test("ordem entregue ou cancelada está encerrada", () => {
  assert.equal(osEncerrada("entregue"), true);
  assert.equal(osEncerrada("cancelada"), true);
  assert.equal(osEncerrada("aprovada"), false);
});

test("produto sai do estoque (peça); o resto é serviço", () => {
  assert.equal(rotuloTipoItemOs("peca"), "Produto");
  assert.equal(rotuloTipoItemOs("servico"), "Serviço");
});

test("totais: arredonda em centavos e o desconto não deixa o total negativo", () => {
  assert.equal(totalDoItem(3, 10.005), 30.02);
  assert.equal(totalDaOs([{ total: 50 }, { total: 30.5 }], 10), 70.5);
  assert.equal(totalDaOs([{ total: 20 }], 50), 0);
});
