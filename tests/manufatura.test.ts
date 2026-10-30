import test from "node:test";
import assert from "node:assert/strict";

import {
  baseDoItem,
  consumoAcumulado,
  custoPadraoDaOrdem,
  erroDoItem,
  itensParaBanco,
  manufaturaLiberadaEmpresa,
  necessidadeDoItem,
  temPerfil,
} from "../src/lib/manufatura.ts";

test("só a liberação explícita abre a manufatura no piloto", () => {
  assert.equal(manufaturaLiberadaEmpresa({ modulos_liberados: ["manufatura"] }), true);
  assert.equal(manufaturaLiberadaEmpresa({ modulos_liberados: ["lavarapido", "obras"] }), false);
  assert.equal(manufaturaLiberadaEmpresa({ modulos_liberados: [] }), false);
  assert.equal(manufaturaLiberadaEmpresa({}), false);
  assert.equal(manufaturaLiberadaEmpresa(null), false);
  // ramo, CNAE e escolha sem CNPJ não entram na conta
  assert.equal(
    manufaturaLiberadaEmpresa({ ramo_atividade: "manufatura", cnae: "3101-2/00" } as never),
    false,
  );
});

test("perfis: a produção aponta mas não mantém lista nem ordem", () => {
  assert.equal(temPerfil(["producao"], ["administrador", "gestor"]), false);
  assert.equal(temPerfil(["producao"], ["administrador", "gestor", "producao"]), true);
  assert.equal(temPerfil(["gestor", "vendedor"], ["administrador", "gestor"]), true);
  assert.equal(temPerfil([], ["administrador"]), false);
});

test("o item da lista vira quantidade por unidade (item ÷ rendimento)", () => {
  assert.equal(baseDoItem(6, 3), 2);
  assert.equal(baseDoItem(1, 3), 0.333333);
  assert.equal(baseDoItem(5, 0), 5);
});

test("necessidade do insumo com perda de corte, como no banco", () => {
  // 2 chapas por armário, 2 armários, 10% de perda: 4,444 chapas
  assert.equal(necessidadeDoItem(2, 2, 10), 4.444);
  assert.equal(necessidadeDoItem(8, 2, 0), 16);
});

test("consumo acumulado: arredonda uma vez, sem acumular erro entre apontamentos", () => {
  assert.equal(consumoAcumulado(2, 10, 1, 0), 2.222);
  assert.equal(consumoAcumulado(2, 10, 2, 1), 6.667);
  // o banco consome a diferença para o já consumido: 6,667 - 2,222 = 4,445
  const diferenca = consumoAcumulado(2, 10, 2, 1) - consumoAcumulado(2, 10, 1, 0);
  assert.equal(Math.round(diferenca * 1000) / 1000, 4.445);
  // agrupar o apontamento de outro jeito dá o mesmo total
  assert.equal(consumoAcumulado(2, 10, 2, 1), consumoAcumulado(2, 10, 0, 3));
});

test("custo padrão da ordem: insumos planejados mais a mão de obra", () => {
  assert.equal(
    custoPadraoDaOrdem([
      { quantidadePlanejada: 4.444, custoUnitario: 100 },
      { quantidadePlanejada: 16, custoUnitario: 5 },
    ]),
    524.4,
  );
  assert.equal(custoPadraoDaOrdem([{ quantidadePlanejada: 6, custoUnitario: 5 }], 350), 380);
  assert.equal(custoPadraoDaOrdem([], -10), 0);
});

test("validação dos itens do formulário", () => {
  assert.equal(
    erroDoItem({ insumo_id: "", quantidade: "1", perda_percentual: "0" }),
    "Escolha o insumo.",
  );
  assert.match(
    erroDoItem({ insumo_id: "a", quantidade: "0", perda_percentual: "0" }),
    /maior que zero/,
  );
  assert.match(
    erroDoItem({ insumo_id: "a", quantidade: "abc", perda_percentual: "0" }),
    /maior que zero/,
  );
  assert.match(
    erroDoItem({ insumo_id: "a", quantidade: "1", perda_percentual: "90" }),
    /entre 0 e 90/,
  );
  assert.match(
    erroDoItem({ insumo_id: "a", quantidade: "1", perda_percentual: "-1" }),
    /entre 0 e 90/,
  );
  assert.equal(erroDoItem({ insumo_id: "a", quantidade: "2,5", perda_percentual: "" }), "");
});

test("itens do formulário vão ao banco como número, aceitando vírgula", () => {
  assert.deepEqual(
    itensParaBanco([
      { insumo_id: "x", quantidade: "2,5", perda_percentual: "10" },
      { insumo_id: "y", quantidade: "8", perda_percentual: "" },
    ]),
    [
      { insumo_id: "x", quantidade: 2.5, perda_percentual: 10 },
      { insumo_id: "y", quantidade: 8, perda_percentual: 0 },
    ],
  );
});
