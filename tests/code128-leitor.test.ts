import assert from "node:assert/strict";
import { test } from "node:test";

import { code128Larguras, code128Modulos } from "../src/lib/code128.ts";
import { acharMesa, codigoComanda, interpretarLeitura } from "../src/lib/leitor-comanda.ts";

// Vetores gerados pela biblioteca JsBarcode (CODE128B), usada como referência de conferência.
const VETORES: Record<string, string> = {
  C1: "110100100001000100011010011100110101100001001100011101011",
  C123: "1101001000010001000110100111001101100111001011001011100111101010001100011101011",
  C000123:
    "1101001000010001000110100111011001001110110010011101100100111001101100111001011001011100100010111101100011101011",
};

test("Code 128 gera exatamente os módulos da biblioteca de referência", () => {
  for (const [texto, esperado] of Object.entries(VETORES)) {
    assert.equal(code128Modulos(texto), esperado, texto);
  }
});

test("cada símbolo soma 11 módulos e a parada 13", () => {
  const larguras = code128Larguras("C4567");
  const simbolos = (larguras.length - 7) / 6;
  assert.equal(Number.isInteger(simbolos), true);
  for (let i = 0; i < simbolos; i++) {
    assert.equal(
      larguras.slice(i * 6, i * 6 + 6).reduce((a, b) => a + b, 0),
      11,
    );
  }
  assert.equal(
    larguras.slice(-7).reduce((a, b) => a + b, 0),
    13,
  );
});

test("Code 128 recusa texto vazio e caractere fora do conjunto", () => {
  assert.throws(() => code128Larguras(""));
  assert.throws(() => code128Larguras("comanda ç"));
});

test("leitura: comanda pelo código de barras", () => {
  assert.deepEqual(interpretarLeitura("C123"), { tipo: "comanda", numero: 123 });
  assert.deepEqual(interpretarLeitura(" c000045 "), { tipo: "comanda", numero: 45 });
  assert.deepEqual(interpretarLeitura(codigoComanda(7)), { tipo: "comanda", numero: 7 });
  assert.deepEqual(interpretarLeitura("C0"), { tipo: "vazio" });
});

test("leitura: mesa pelo número digitado", () => {
  assert.deepEqual(interpretarLeitura("12"), { tipo: "mesa", numero: "12" });
  assert.deepEqual(interpretarLeitura("M12"), { tipo: "mesa", numero: "12" });
  assert.deepEqual(interpretarLeitura("mesa 8"), { tipo: "mesa", numero: "8" });
  assert.deepEqual(interpretarLeitura("Varanda"), { tipo: "mesa", numero: "Varanda" });
  assert.deepEqual(interpretarLeitura("Mirante"), { tipo: "mesa", numero: "Mirante" });
  assert.deepEqual(interpretarLeitura("   "), { tipo: "vazio" });
});

test("achar a mesa ignora zeros à esquerda e maiúsculas", () => {
  const mesas = [{ numero: "5" }, { numero: "12" }, { numero: "Varanda" }];
  assert.equal(acharMesa(mesas, "05")?.numero, "5");
  assert.equal(acharMesa(mesas, " 12 ")?.numero, "12");
  assert.equal(acharMesa(mesas, "varanda")?.numero, "Varanda");
  assert.equal(acharMesa(mesas, "99"), undefined);
});

test("etiqueta da comanda leva o código que o leitor reconhece e escapa o texto digitado", async () => {
  const { htmlEtiquetaComanda } = await import("../src/lib/etiqueta-comanda.ts");
  const { code128Svg } = await import("../src/lib/code128.ts");
  const html = htmlEtiquetaComanda({
    numero: 123,
    mesa: "7",
    cliente: "<b>Ana</b>",
    loja: "Bar & Cia",
  });
  assert.match(html, /Comanda 123/);
  assert.match(html, /Mesa 7/);
  assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
  assert.match(html, /Bar &amp; Cia/);
  assert.match(html, /<svg[^>]*aria-label="Código de barras C123"/);
  assert.match(html, /<p class="codigo">C123<\/p>/);
  // uma barra por "1" isolado; o desenho não pode ficar vazio
  assert.ok((code128Svg("C123").match(/<rect /g) ?? []).length > 20);
});
