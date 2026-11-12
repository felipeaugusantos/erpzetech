import assert from "node:assert/strict";
import { test } from "node:test";

import { ean13Modulos, ean13Valido } from "../src/lib/ean13.ts";
import { eanInterno } from "../src/lib/ean.ts";
import {
  MODELOS_ETIQUETA,
  dataEtiqueta,
  etiquetaDoProduto,
  expandirEtiquetas,
  htmlEtiquetas,
  modeloEtiqueta,
} from "../src/lib/etiqueta.ts";

test("EAN-13 gera os 95 módulos esperados (4006381333931, paridade LGLLGG)", () => {
  const esperado =
    "101" +
    ["0001101", "0100111", "0101111", "0111101", "0001001", "0110011"].join("") + // 0 0 6 3 8 1
    "01010" +
    ["1000010", "1000010", "1000010", "1110100", "1000010", "1100110"].join("") + // 3 3 3 9 3 1
    "101";
  assert.equal(ean13Modulos("4006381333931"), esperado);
  assert.equal(esperado.length, 95);
});

test("EAN-13 valida o dígito verificador e recusa o que não é EAN", () => {
  assert.equal(ean13Valido("4006381333931"), true);
  assert.equal(ean13Valido("4006381333932"), false);
  assert.equal(ean13Valido("123"), false);
  assert.equal(ean13Modulos(eanInterno("123")).length, 95);
  assert.throws(() => ean13Modulos("4006381333932"));
});

test("cópias são expandidas e limitadas a 500 por item", () => {
  assert.equal(expandirEtiquetas([{ descricao: "A", copias: 3 }, { descricao: "B" }]).length, 4);
  assert.equal(expandirEtiquetas([{ descricao: "A", copias: 9999 }]).length, 500);
  assert.equal(expandirEtiquetas([{ descricao: "A", copias: 0 }]).length, 1);
});

test("térmica: uma página por etiqueta, no tamanho do rolo, com texto escapado", () => {
  const m = modeloEtiqueta("t-50x30")!;
  const html = htmlEtiquetas(m, [
    { descricao: "Ração <b>Premium</b>", codigo: "4006381333931", preco: 12.5, copias: 2 },
  ]);
  assert.match(html, /size: 50mm 30mm/);
  assert.equal(html.match(/class="pg"/g)?.length, 2);
  assert.ok(html.includes("Ração &lt;b&gt;Premium&lt;/b&gt;"));
  assert.ok(html.includes("R$ 12,50"));
  assert.ok(html.includes("<svg"));
});

test("código que não é EAN-13 sai em Code 128; sem código desenhável não há barras", () => {
  const m = modeloEtiqueta("t-40x25")!;
  assert.ok(htmlEtiquetas(m, [{ descricao: "X", codigo: "PROD-123" }]).includes("<svg"));
  assert.ok(!htmlEtiquetas(m, [{ descricao: "X", codigo: "" }]).includes("<svg"));
  assert.ok(!htmlEtiquetas(m, [{ descricao: "X", codigo: "ção" }]).includes("<svg"));
  assert.ok(
    !htmlEtiquetas(m, [{ descricao: "X", codigo: "123" }], { mostrarCodigo: false }).includes(
      "<svg",
    ),
  );
});

test("folha A4: pula posições já usadas e abre nova folha ao encher", () => {
  const m = modeloEtiqueta("f-3x10")!;
  const html = htmlEtiquetas(m, [{ descricao: "A", copias: 29 }], { pular: 2 });
  assert.equal(html.match(/class="folha"/g)?.length, 2);
  assert.equal(html.match(/class="cel"/g)?.length, 31);
  assert.equal(html.match(/<div class="cel"><\/div>/g)?.length, 2);
});

test("os modelos têm medidas coerentes e a grade cabe na A4", () => {
  for (const m of MODELOS_ETIQUETA) {
    if (m.tipo !== "folha") continue;
    const larg =
      (m.margemEsquerdaMm ?? 0) + m.colunas! * m.larguraMm + (m.colunas! - 1) * (m.espacoHMm ?? 0);
    const alt =
      (m.margemSuperiorMm ?? 0) + m.linhas! * m.alturaMm + (m.linhas! - 1) * (m.espacoVMm ?? 0);
    assert.ok(larg <= 210, `${m.id} largura ${larg}`);
    assert.ok(alt <= 297, `${m.id} altura ${alt}`);
  }
  assert.throws(() => htmlEtiquetas(modeloEtiqueta("t-40x25")!, []));
});

test("etiqueta do produto usa o resumo, o código de barras e a data em dia/mês/ano", () => {
  const e = etiquetaDoProduto(
    {
      descricao: "Ração Premium Cães Adultos 15 kg",
      descricao_resumida: "Ração Premium 15kg",
      codigo_barras: null,
      codigo_interno: "P-77",
      preco_venda: "189.9",
      unidade: "UN",
      unidade_venda: "SC",
    },
    { validade: "2027-03-09", lote: "L42", copias: 3 },
  );
  assert.deepEqual(e, {
    descricao: "Ração Premium 15kg",
    codigo: "P-77",
    preco: 189.9,
    unidade: "SC",
    validade: "09/03/2027",
    lote: "L42",
    copias: 3,
  });
  assert.equal(dataEtiqueta(null), null);
  assert.equal(dataEtiqueta("lixo"), null);
});

test("validade e lote aparecem na etiqueta impressa", () => {
  const html = htmlEtiquetas(modeloEtiqueta("t-50x30")!, [
    { descricao: "Vacina", validade: "09/03/2027", lote: "L42" },
  ]);
  assert.ok(html.includes("Val 09/03/2027 · Lote L42"));
});
