import assert from "node:assert/strict";
import { test } from "node:test";

import { gerarPixCopiaCola } from "../src/lib/pix.ts";

// CRC-16/CCITT-FALSE, implementado de forma independente da do código testado.
function crc16(texto: string): string {
  let crc = 0xffff;
  for (const c of texto) {
    crc ^= c.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Decodifica os campos TLV (id de 2 dígitos, tamanho de 2 dígitos, valor). */
function tlv(payload: string): Record<string, string> {
  const campos: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const tamanho = Number(payload.slice(i + 2, i + 4));
    campos[id] = payload.slice(i + 4, i + 4 + tamanho);
    i += 4 + tamanho;
  }
  return campos;
}

test("o CRC de referência confere com o vetor padrão ('123456789' = 29B1)", () => {
  assert.equal(crc16("123456789"), "29B1");
});

test("Pix copia e cola: campos obrigatórios do BR Code", () => {
  const pix = gerarPixCopiaCola({
    chave: "  12345678000199  ",
    beneficiario: "Casa de Materiais",
    cidade: "Campinas",
    valor: 150.5,
    referencia: "PEDIDO-123",
  });
  const campos = tlv(pix);
  assert.equal(campos["00"], "01");
  assert.equal(campos["52"], "0000");
  assert.equal(campos["53"], "986");
  assert.equal(campos["54"], "150.50");
  assert.equal(campos["58"], "BR");
  assert.equal(campos["59"], "CASA DE MATERIAIS");
  assert.equal(campos["60"], "CAMPINAS");
  assert.deepEqual(tlv(campos["26"] ?? ""), { "00": "br.gov.bcb.pix", "01": "12345678000199" });
  assert.deepEqual(tlv(campos["62"] ?? ""), { "05": "PEDIDO-123" });
});

test("Pix copia e cola: o CRC no final confere com o conteúdo", () => {
  const pix = gerarPixCopiaCola({ chave: "a@b.com", beneficiario: "Loja", cidade: "SP", valor: 1 });
  assert.ok(pix.includes("6304"));
  const semCrc = pix.slice(0, -4);
  assert.ok(semCrc.endsWith("6304"));
  assert.equal(pix.slice(-4), crc16(semCrc));
});

test("Pix copia e cola: remove acentos e símbolos e respeita os tamanhos máximos", () => {
  const pix = gerarPixCopiaCola({
    chave: "chave",
    beneficiario: "José & Irmãos Materiais de Construção Ltda",
    cidade: "São José dos Campos do Sul",
    valor: 10,
    referencia: "pedido nº 5 / loja",
  });
  const campos = tlv(pix);
  assert.equal(campos["59"], "JOSE  IRMAOS MATERIAIS DE");
  assert.ok((campos["59"] ?? "").length <= 25);
  assert.equal(campos["60"], "SAO JOSE DOS CA");
  assert.ok((campos["60"] ?? "").length <= 15);
  assert.deepEqual(tlv(campos["62"] ?? ""), { "05": "PEDIDON5LOJA" });
});

test("Pix copia e cola: valores padrão quando beneficiário, cidade e referência ficam vazios", () => {
  const campos = tlv(
    gerarPixCopiaCola({ chave: "k", beneficiario: "!!!", cidade: "", valor: 0.1 }),
  );
  assert.equal(campos["59"], "ZE TECH");
  assert.equal(campos["60"], "SAO PAULO");
  assert.equal(campos["54"], "0.10");
  assert.deepEqual(tlv(campos["62"] ?? ""), { "05": "COBRANCA" });
});

test("Pix copia e cola: o valor sempre sai com duas casas decimais", () => {
  assert.equal(
    tlv(gerarPixCopiaCola({ chave: "k", beneficiario: "L", cidade: "C", valor: 5 }))["54"],
    "5.00",
  );
  assert.equal(
    tlv(gerarPixCopiaCola({ chave: "k", beneficiario: "L", cidade: "C", valor: 1234.567 }))["54"],
    "1234.57",
  );
});
