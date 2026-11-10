import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lerCsvIbpt,
  origemImportada,
  regraVigente,
  somarTributos,
  textoTributos,
  tributosDoItem,
  type RegraTributos,
} from "../src/lib/tributos-aprox.ts";

const regra: RegraTributos = {
  ncm: "84713012",
  aliq_nacional_federal: 10,
  aliq_importado_federal: 15,
  aliq_estadual: 18,
  aliq_municipal: 0,
  vigencia_fim: "2026-12-31",
  versao: "26.2.A",
  fonte: "IBPT",
};

test("origemImportada: 1, 2, 3, 6, 7 e 8 usam a alíquota de importados", () => {
  for (const o of [1, 2, 3, 6, 7, 8]) assert.equal(origemImportada(o), true, String(o));
  for (const o of [0, 4, 5, "0", null, undefined])
    assert.equal(origemImportada(o), false, String(o));
});

test("regraVigente respeita a data de vencimento da tabela", () => {
  assert.equal(regraVigente(regra, "2026-12-31"), true);
  assert.equal(regraVigente(regra, "2027-01-01"), false);
  assert.equal(regraVigente({ ...regra, vigencia_fim: null }, "2099-01-01"), true);
});

test("tributosDoItem: federal pela origem, estadual e municipal, em 2 casas", () => {
  assert.deepEqual(tributosDoItem(200, 0, regra), {
    federal: 20,
    estadual: 36,
    municipal: 0,
    total: 56,
  });
  assert.deepEqual(tributosDoItem(200, 1, regra), {
    federal: 30,
    estadual: 36,
    municipal: 0,
    total: 66,
  });
  assert.equal(tributosDoItem(33.33, 0, regra).total, 9.33);
  assert.equal(tributosDoItem(-5, 0, regra).total, 0);
});

test("somarTributos soma por esfera e guarda a base total", () => {
  const a = { valor: 200, t: tributosDoItem(200, 0, regra) };
  const b = { valor: 100, t: tributosDoItem(100, 1, regra) };
  assert.deepEqual(somarTributos([a, b]), {
    federal: 35,
    estadual: 54,
    municipal: 0,
    total: 89,
    baseTotal: 300,
  });
});

test("textoTributos traz o total, o percentual, as esferas e a fonte", () => {
  const t = somarTributos([{ valor: 200, t: tributosDoItem(200, 0, regra) }]);
  const texto = textoTributos(t, "IBPT", "26.2.A");
  assert.match(texto, /R\$ 56,00 \(28,00%\)/);
  assert.match(texto, /Federal R\$ 20,00, Estadual R\$ 36,00, Municipal R\$ 0,00/);
  assert.match(texto, /Fonte: IBPT \(versão 26\.2\.A\)\./);
  assert.match(textoTributos(t, "IBPT"), /Fonte: IBPT\./);
});

const CSV = [
  "codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;estadual;municipal;vigenciainicio;vigenciafim;chave;versao;fonte",
  "84713012;;0;Computador;13,45;19,55;18,00;0,00;01/07/2026;31/12/2026;ABC;26.2.A;IBPT/empresometro.com.br",
  "84713012;1;0;Computador exceção;13,45;19,55;18,00;0,00;01/07/2026;31/12/2026;ABC;26.2.A;IBPT",
  "0101;;0;NCM curto;1;1;1;1;01/07/2026;31/12/2026;X;26.2.A;IBPT",
  "1001;;1;Serviço NBS;1;1;1;1;01/07/2026;31/12/2026;X;26.2.A;IBPT",
  "22030000;;0;Cerveja;4.5;4.5;25;0;01/07/2026;31/12/2026;X;26.2.A;IBPT",
  "22030001;;0;Valor ruim;abc;1;1;1;01/07/2026;31/12/2026;X;26.2.A;IBPT",
  "22030002;;0;Acima de 100;101;1;1;1;01/07/2026;31/12/2026;X;26.2.A;IBPT",
].join("\n");

test("lerCsvIbpt lê pelo nome das colunas, só produto sem exceção, e conta o que ignorou", () => {
  const { linhas, ignoradas } = lerCsvIbpt("﻿" + CSV);
  assert.equal(ignoradas, 5);
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas[0], {
    ncm: "84713012",
    aliq_nacional_federal: 13.45,
    aliq_importado_federal: 19.55,
    aliq_estadual: 18,
    aliq_municipal: 0,
    vigencia_fim: "2026-12-31",
    versao: "26.2.A",
    fonte: "IBPT/empresometro.com.br",
  });
  assert.equal(linhas[1]!.aliq_nacional_federal, 4.5, "ponto decimal também é aceito");
});

test("lerCsvIbpt aceita colunas em outra ordem e recusa arquivo que não é da IBPT", () => {
  const trocado =
    "estadual;municipal;codigo;nacionalfederal;importadosfederal\n18;0;84713012;10;15";
  assert.equal(lerCsvIbpt(trocado).linhas[0]!.aliq_estadual, 18);
  assert.throws(() => lerCsvIbpt("a;b;c\n1;2;3"), /faltam as colunas/);
  assert.throws(() => lerCsvIbpt(""), /vazio/);
});
