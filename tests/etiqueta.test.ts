import assert from "node:assert/strict";
import { test } from "node:test";

import { ean13Modulos, ean13Valido } from "../src/lib/ean13.ts";
import { eanInterno } from "../src/lib/ean.ts";
import {
  configurarAssinaturaQz,
  enviarCrusQz,
  listarImpressorasQz,
  paraBase64,
} from "../src/lib/etiqueta-qz.ts";
import {
  LIMITE_MENSAGEM_QZ,
  normalizarPem,
  validarMensagemQz,
} from "../src/lib/etiqueta-qz-assinatura.ts";
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

function qzFalso(opts: { ativo?: boolean; falhaConexao?: boolean; falhaImpressao?: boolean } = {}) {
  const chamadas: { conectou: number; config?: string; dados?: unknown[] } = { conectou: 0 };
  const cliente = {
    websocket: {
      isActive: () => !!opts.ativo,
      connect: async () => {
        chamadas.conectou++;
        if (opts.falhaConexao) throw new Error("sem conexão");
      },
    },
    printers: { find: async () => ["Zebra ZD230", "Argox OS-214", "Brother"] },
    configs: {
      create: (nome: string) => {
        chamadas.config = nome;
        return { nome };
      },
    },
    print: async (_c: unknown, dados: unknown[]) => {
      if (opts.falhaImpressao) throw new Error("impressora offline");
      chamadas.dados = dados;
    },
  };
  return { cliente, chamadas, carregar: async () => cliente };
}

test("QZ: base64 preserva os bytes e vai como comando cru", async () => {
  assert.equal(paraBase64(Uint8Array.from([0xe7, 0x41, 0x00])), "50EA");
  const q = qzFalso();
  await enviarCrusQz("Zebra ZD230", Uint8Array.from([0x5e, 0x58, 0x41]), q.carregar);
  assert.equal(q.chamadas.conectou, 1);
  assert.equal(q.chamadas.config, "Zebra ZD230");
  assert.deepEqual(q.chamadas.dados, [
    { type: "raw", format: "command", flavor: "base64", data: "XlhB" },
  ]);
});

test("QZ: não reconecta quando já está conectado e lista as impressoras em ordem", async () => {
  const q = qzFalso({ ativo: true });
  assert.deepEqual(await listarImpressorasQz(q.carregar), [
    "Argox OS-214",
    "Brother",
    "Zebra ZD230",
  ]);
  assert.equal(q.chamadas.conectou, 0);
});

test("QZ: erros viram mensagens claras", async () => {
  const bytes = Uint8Array.from([1]);
  await assert.rejects(
    enviarCrusQz("Z", bytes, qzFalso({ falhaConexao: true }).carregar),
    /QZ Tray.*aberto/,
  );
  await assert.rejects(
    enviarCrusQz("Z", bytes, qzFalso({ falhaImpressao: true }).carregar),
    /não imprimiu: impressora offline/,
  );
  await assert.rejects(enviarCrusQz("  ", bytes, qzFalso().carregar), /Escolha a impressora/);
  await assert.rejects(
    enviarCrusQz("Z", new Uint8Array(), qzFalso().carregar),
    /Nada para imprimir/,
  );
});

test("QZ: arquivo grande é convertido sem estourar a pilha", () => {
  const grande = new Uint8Array(300_000).fill(0x41);
  assert.equal(atob(paraBase64(grande)).length, 300_000);
});

const AGORA = 1_800_000_000_000;
const msg = (o: Record<string, unknown>) => JSON.stringify({ timestamp: AGORA, ...o });
const impressao = (data: unknown[]) =>
  msg({ call: "print", params: { printer: { name: "Zebra" }, options: {}, data } });
const CRU = { type: "raw", format: "command", flavor: "base64", data: "XlhB" };

test("assinatura: só libera listar impressoras e imprimir comando cru", () => {
  assert.equal(
    validarMensagemQz(msg({ call: "printers.find", params: { query: "" } }), AGORA).ok,
    true,
  );
  assert.equal(validarMensagemQz(impressao([CRU]), AGORA).ok, true);
  for (const call of [
    "file.read",
    "usb.claimDevice",
    "websocket.getNetworkInfo",
    "printers.getStatus",
  ]) {
    assert.equal(validarMensagemQz(msg({ call, params: {} }), AGORA).ok, false, call);
  }
});

test("assinatura: impressão com arquivo, imagem, PDF ou sem impressora é recusada", () => {
  for (const d of [
    { type: "pixel", format: "pdf", flavor: "file", data: "C:/segredo.pdf" },
    { type: "raw", format: "file", flavor: "file", data: "C:/x" },
    { ...CRU, flavor: "file" },
    { ...CRU, format: "image" },
    { ...CRU, data: 5 },
  ]) {
    assert.equal(validarMensagemQz(impressao([CRU, d]), AGORA).ok, false, JSON.stringify(d));
  }
  assert.equal(validarMensagemQz(impressao([]), AGORA).ok, false);
  assert.equal(validarMensagemQz(msg({ call: "print", params: { data: [CRU] } }), AGORA).ok, false);
});

test("assinatura: recusa mensagem antiga, grande, sem JSON ou vazia", () => {
  const velha = JSON.stringify({ call: "printers.find", params: {}, timestamp: AGORA - 3_600_000 });
  assert.equal(validarMensagemQz(velha, AGORA).ok, false);
  assert.equal(validarMensagemQz(JSON.stringify({ call: "printers.find" }), AGORA).ok, false);
  assert.equal(validarMensagemQz("não é json", AGORA).ok, false);
  assert.equal(validarMensagemQz("", AGORA).ok, false);
  assert.equal(validarMensagemQz("[1]", AGORA).ok, false);
  assert.equal(
    validarMensagemQz(impressao([{ ...CRU, data: "A".repeat(LIMITE_MENSAGEM_QZ) }]), AGORA).ok,
    false,
  );
  assert.equal(normalizarPem("  -----A-----\\nB\\n-----C-----  "), "-----A-----\nB\n-----C-----");
});

test("assinatura: com certificado liga a assinatura SHA512; sem certificado nada muda", async () => {
  const eventos: string[] = [];
  const cliente = {
    ...qzFalso().cliente,
    security: {
      setCertificatePromise: (f: (r: (c: string) => void, j: (e: unknown) => void) => void) =>
        f(
          (c) => eventos.push(`cert:${c}`),
          () => {},
        ),
      setSignaturePromise: (
        f: (m: string) => (r: (s: string) => void, j: (e: unknown) => void) => void,
      ) =>
        f("texto")(
          (s) => eventos.push(`ass:${s}`),
          () => {},
        ),
      setSignatureAlgorithm: (a: string) => eventos.push(`alg:${a}`),
    },
  };
  const api = { certificado: async () => "PEM", assinar: async (m: string) => `assinado(${m})` };
  assert.equal(await configurarAssinaturaQz(cliente, api), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(eventos, ["alg:SHA512", "cert:PEM", "ass:assinado(texto)"]);
  assert.equal(await configurarAssinaturaQz(cliente, api), true); // já ligado: não repete
  assert.equal(eventos.length, 3);

  const outro = { ...cliente };
  assert.equal(
    await configurarAssinaturaQz(outro, { ...api, certificado: async () => null }),
    false,
  );
  assert.equal(
    await configurarAssinaturaQz(outro, {
      ...api,
      certificado: async () => {
        throw new Error("x");
      },
    }),
    false,
  );
  assert.equal(await configurarAssinaturaQz(qzFalso().cliente, api), false); // sem módulo de segurança
  assert.equal(eventos.length, 3);
});

test("assinatura: a assinatura RSA-SHA512 do servidor confere com a chave pública", async () => {
  const { generateKeyPairSync, createSign, createVerify } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const texto = impressao([CRU]);
  const s = createSign("RSA-SHA512");
  s.update(texto, "utf8");
  s.end();
  const ass = s.sign(privateKey, "base64");
  const v = createVerify("RSA-SHA512");
  v.update(texto, "utf8");
  assert.equal(v.verify(publicKey, ass, "base64"), true);
});
