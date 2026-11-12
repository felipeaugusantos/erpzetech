import assert from "node:assert/strict";
import { test } from "node:test";

import { ean13Modulos, ean13Valido } from "../src/lib/ean13.ts";
import { eanInterno } from "../src/lib/ean.ts";
import {
  bytesEtiquetas,
  comandosEtiquetas,
  quebrarTexto,
  type ImpressoraEtiqueta,
} from "../src/lib/etiqueta-raw.ts";
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

const ZEBRA: ImpressoraEtiqueta = { linguagem: "zpl", dpi: 203 };
const ARGOX: ImpressoraEtiqueta = { linguagem: "tspl", dpi: 203 };
const PRODUTO = {
  descricao: "Ração Premium 15kg",
  codigo: "4006381333931",
  preco: 189.9,
  unidade: "SC",
  copias: 3,
};

test("ZPL: tamanho em pontos, EAN-13 nativo e vias em ^PQ", () => {
  const z = comandosEtiquetas(modeloEtiqueta("t-50x30")!, [PRODUTO], ZEBRA);
  assert.match(z, /^\^XA\n\^CI28\n\^PW400\n\^LL240\n/);
  assert.match(z, /\^BEN,\d+,Y,N\^FD4006381333931\^FS/);
  assert.match(z, /\^PQ3,0,1,N\n\^XZ\n$/);
  assert.ok(z.includes("R$ 189,90 / SC"));
});

test("ZPL: caracteres de comando saem do texto e código fora do padrão vira Code 128 ou some", () => {
  const m = modeloEtiqueta("t-40x25")!;
  const z = comandosEtiquetas(m, [{ descricao: "A^B~C", codigo: "AB-12" }], ZEBRA);
  assert.ok(z.includes("^FDA B C^FS"));
  assert.match(z, /\^BCN,\d+,Y,N,N\^FDAB-12\^FS/);
  assert.ok(!comandosEtiquetas(m, [{ descricao: "X", codigo: "A^B" }], ZEBRA).includes("^BC"));
  assert.ok(!comandosEtiquetas(m, [PRODUTO], ZEBRA, { mostrarCodigo: false }).includes("^BE"));
});

test("TSPL: SIZE, BARCODE EAN13, PRINT com vias e fim de linha CRLF", () => {
  const t = comandosEtiquetas(modeloEtiqueta("t-50x30")!, [PRODUTO], ARGOX);
  assert.ok(t.startsWith("SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\n"));
  assert.match(t, /BARCODE \d+,\d+,"EAN13",\d+,1,0,\d,\d,"4006381333931"/);
  assert.ok(t.endsWith("PRINT 3,1\r\n"));
  assert.ok(!/(?<!\r)\n/.test(t));
});

test("TSPL: aspas do texto não quebram o comando e o texto é quebrado em até 2 linhas", () => {
  const t = comandosEtiquetas(
    modeloEtiqueta("t-40x25")!,
    [{ descricao: 'Coleira "Luxo" para cães de grande porte com guia' }],
    ARGOX,
  );
  assert.ok(!t.includes('""'));
  assert.equal(t.match(/TEXT \d+,\d+,"3"/g)?.length, 2);
  assert.deepEqual(quebrarTexto("um dois tres quatro cinco", 9, 2), ["um dois", "tres"]);
});

test("a cópia mínima é 1, o máximo 500 e várias etiquetas viram vários blocos", () => {
  const m = modeloEtiqueta("t-50x30")!;
  assert.ok(comandosEtiquetas(m, [{ descricao: "A", copias: 0 }], ZEBRA).includes("^PQ1,"));
  assert.ok(comandosEtiquetas(m, [{ descricao: "A", copias: 9999 }], ZEBRA).includes("^PQ500,"));
  assert.equal(
    comandosEtiquetas(m, [{ descricao: "A" }, { descricao: "B" }], ZEBRA).match(/\^XA/g)?.length,
    2,
  );
});

test("folha A4 e lista vazia são recusadas na impressão direta", () => {
  assert.throws(() => comandosEtiquetas(modeloEtiqueta("f-3x10")!, [PRODUTO], ZEBRA), /térmica/);
  assert.throws(() => comandosEtiquetas(modeloEtiqueta("t-50x30")!, [], ZEBRA));
});

test("bytes: ZPL em UTF-8 e TSPL em Windows-1252", () => {
  assert.deepEqual([...bytesEtiquetas("ç", "zpl")], [0xc3, 0xa7]);
  assert.deepEqual([...bytesEtiquetas("ç€日", "tspl")], [0xe7, 0x80, 0x3f]);
});

test("o código de barras cabe na etiqueta em 203 e 300 dpi", () => {
  for (const dpi of [203, 300] as const) {
    for (const id of ["t-40x25", "t-50x30", "t-60x40", "t-100x50"]) {
      const m = modeloEtiqueta(id)!;
      const z = comandosEtiquetas(m, [PRODUTO], { linguagem: "zpl", dpi });
      const mod = Number(/\^BY(\d+)/.exec(z)![1]);
      const x = Number(/\^FO(\d+),\d+\^BEN/.exec(z)![1]);
      const largura = Math.round((m.larguraMm * dpi) / 25.4);
      assert.ok(x >= 0 && x + 95 * mod <= largura, `${id} ${dpi}dpi`);
    }
  }
});
