import assert from "node:assert/strict";
import { test } from "node:test";

import {
  erroDoItem,
  idadeParaSngpc,
  sexoParaSngpc,
  somaPorLote,
  rotuloMotivoPerda,
  rotuloReceituario,
  type PeriodoSngpc,
} from "../src/lib/sngpc.ts";
import {
  criarZip,
  crc32,
  escaparXml,
  gerarXmlInventario,
  gerarXmlMovimentacao,
  nomeDoArquivo,
  paraLatin1,
  resumoDoPeriodo,
} from "../src/lib/sngpc-xml.ts";

const periodo: PeriodoSngpc = {
  cnpj: "11222333000181",
  inicio: "2026-11-01",
  fim: "2026-11-05",
  assinatura: "abc",
  documentos: [
    {
      id: "1",
      tipo: "entrada",
      data: "2026-11-02",
      created_at: "2026-11-02T10:00:00Z",
      nf_numero: 123,
      nf_data: "2026-11-01",
      cnpj_origem: "12345678000195",
      tipo_receituario: null,
      numero_notificacao: null,
      data_prescricao: null,
      prescritor_nome: null,
      prescritor_registro: null,
      prescritor_uf: null,
      comprador_nome: null,
      comprador_tipo_documento: null,
      comprador_documento: null,
      comprador_orgao: null,
      comprador_uf: null,
      paciente_nome: null,
      paciente_idade: null,
      paciente_unidade_idade: null,
      paciente_sexo: null,
      motivo_perda: null,
      itens: [
        { registro_ms: "1234567890123", lote: "L2", quantidade: 20, unidade_medida: 1 },
        { registro_ms: "9876543210987", lote: "K1", quantidade: 8, unidade_medida: 2 },
      ],
    },
    {
      id: "2",
      tipo: "venda",
      data: "2026-11-04",
      created_at: "2026-11-04T10:00:00Z",
      nf_numero: null,
      nf_data: null,
      cnpj_origem: null,
      tipo_receituario: 2,
      numero_notificacao: "12345",
      data_prescricao: "2026-11-03",
      prescritor_nome: "Dra. Joana & Silva <CRMV>",
      prescritor_registro: "12345",
      prescritor_uf: "PE",
      comprador_nome: "José da Conceição",
      comprador_tipo_documento: 1,
      comprador_documento: "1234567",
      comprador_orgao: "SSP",
      comprador_uf: "PE",
      paciente_nome: "Rex",
      paciente_idade: 3,
      paciente_unidade_idade: 1,
      paciente_sexo: 1,
      motivo_perda: null,
      itens: [{ registro_ms: "1234567890123", lote: "L2", quantidade: 4, unidade_medida: 1 }],
    },
    {
      id: "3",
      tipo: "perda",
      data: "2026-11-05",
      created_at: "2026-11-05T10:00:00Z",
      nf_numero: null,
      nf_data: null,
      cnpj_origem: null,
      tipo_receituario: null,
      numero_notificacao: null,
      data_prescricao: null,
      prescritor_nome: null,
      prescritor_registro: null,
      prescritor_uf: null,
      comprador_nome: null,
      comprador_tipo_documento: null,
      comprador_documento: null,
      comprador_orgao: null,
      comprador_uf: null,
      paciente_nome: null,
      paciente_idade: null,
      paciente_unidade_idade: null,
      paciente_sexo: null,
      motivo_perda: 2,
      itens: [{ registro_ms: "1234567890123", lote: "L2", quantidade: 1, unidade_medida: 1 }],
    },
  ],
};

test("XML de movimentação: cabeçalho, ordem das operações e uso veterinário", () => {
  const xml = gerarXmlMovimentacao(periodo, "529.982.247-25");
  assert.ok(
    xml.startsWith(
      '<?xml version="1.0" encoding="iso-8859-1" ?>\n<mensagemSNGPC xmlns="urn:sngpc-schema">',
    ),
  );
  assert.ok(xml.includes("<cnpjEmissor>11222333000181</cnpjEmissor>"));
  assert.ok(xml.includes("<cpfTransmissor>52998224725</cpfTransmissor>"));
  assert.ok(
    xml.includes("<dataInicio>2026-11-01</dataInicio>") &&
      xml.includes("<dataFim>2026-11-05</dataFim>"),
  );
  const ordem = [
    "<entradaMedicamentos>",
    "<saidaMedicamentoVendaAoConsumidor>",
    "<saidaMedicamentoPerda>",
  ].map((t) => xml.indexOf(t));
  assert.ok(ordem.every((p) => p > 0) && ordem[0]! < ordem[1]! && ordem[1]! < ordem[2]!);
  assert.ok(xml.includes("<usoMedicamento>2</usoMedicamento>"), "uso veterinário");
  assert.ok(xml.includes("<conselhoProfissional>CRMV</conselhoProfissional>"), "só o CRMV");
  assert.ok(xml.trimEnd().endsWith("</mensagemSNGPC>"));
});

test("XML de movimentação: nota fiscal da entrada, dispensação e perda", () => {
  const xml = gerarXmlMovimentacao(periodo, "52998224725");
  assert.ok(xml.includes("<numeroNotaFiscal>123</numeroNotaFiscal>"));
  assert.ok(xml.includes("<tipoOperacaoNotaFiscal>1</tipoOperacaoNotaFiscal>"));
  assert.ok(
    xml.includes("<cnpjOrigem>12345678000195</cnpjOrigem>") &&
      xml.includes("<cnpjDestino>11222333000181</cnpjDestino>"),
  );
  assert.equal(xml.match(/<medicamentoEntrada>/g)?.length, 2);
  assert.equal(
    xml.match(/<classeTerapeutica>2<\/classeTerapeutica>/g)?.length,
    2,
    "controle especial",
  );
  assert.ok(xml.includes("<dataRecebimentoMedicamento>2026-11-02</dataRecebimentoMedicamento>"));
  assert.ok(xml.includes("<numeroNotificacaoMedicamento>12345</numeroNotificacaoMedicamento>"));
  assert.ok(xml.includes("<usoProlongado />"), "uso prolongado nulo");
  assert.ok(xml.includes("<dataVendaMedicamento>2026-11-04</dataVendaMedicamento>"));
  assert.ok(xml.includes("<motivoPerdaMedicamento>2</motivoPerdaMedicamento>"));
  assert.ok(xml.includes("<dataPerdaMedicamento>2026-11-05</dataPerdaMedicamento>"));
  // dentro de medicamentoVenda a ordem é: uso prolongado, registro, lote, quantidade, unidade
  const v = xml.slice(xml.indexOf("<medicamentoVenda>"), xml.indexOf("</medicamentoVenda>"));
  const campos = [
    "usoProlongado",
    "registroMSMedicamento",
    "numeroLoteMedicamento",
    "quantidadeMedicamento",
    "unidadeMedidaMedicamento",
  ].map((c) => v.indexOf(c));
  assert.deepEqual(
    [...campos].sort((a, b) => a - b),
    campos,
  );
});

test("XML escapa o texto e o paciente é opcional", () => {
  const xml = gerarXmlMovimentacao(periodo, "52998224725");
  assert.ok(xml.includes("Dra. Joana &amp; Silva &lt;CRMV&gt;"));
  assert.ok(!xml.includes("Joana & Silva"));
  assert.ok(xml.includes("<pacienteMedicamento>") && xml.includes("<cid />"));
  const semAnimal = structuredClone(periodo);
  Object.assign(semAnimal.documentos[1]!, { paciente_nome: null });
  assert.ok(!gerarXmlMovimentacao(semAnimal, "52998224725").includes("<pacienteMedicamento>"));
  assert.equal(escaparXml("a\u0001b"), "ab", "caractere de controle sai");
});

test("XML de inventário", () => {
  const xml = gerarXmlInventario(
    {
      cnpj: "11.222.333/0001-81",
      data: "2026-11-05",
      assinatura: "abc",
      itens: [{ registro_ms: "1234567890123", lote: "L1", quantidade: 6, unidade_medida: 1 }],
    },
    "52998224725",
  );
  assert.ok(xml.includes('<mensagemSNGPCInventario xmlns="urn:sngpc-schema">'));
  assert.ok(
    xml.includes("<cnpjEmissor>11222333000181</cnpjEmissor>") &&
      xml.includes("<data>2026-11-05</data>"),
  );
  assert.ok(xml.includes("<quantidadeMedicamento>6</quantidadeMedicamento>"));
  assert.ok(!xml.includes("dataInicio"));
});

test("resumo do período e nome do arquivo", () => {
  assert.deepEqual(resumoDoPeriodo(periodo), { entradas: 1, dispensacoes: 1, perdas: 1, itens: 4 });
  assert.equal(
    nomeDoArquivo("movimentacao", "2026-11-01", "2026-11-05"),
    "sngpc-movimentacao-20261101-20261105",
  );
  assert.equal(
    nomeDoArquivo("inventario", "2026-11-05", "2026-11-05"),
    "sngpc-inventario-20261105",
  );
});

test("Latin-1: acentos viram um byte e o que não cabe vira ?", () => {
  assert.deepEqual([...paraLatin1("José ção")], [74, 111, 115, 233, 32, 231, 227, 111]);
  assert.deepEqual([...paraLatin1("a€b")], [97, 63, 98]);
});

test("CRC32 e estrutura do ZIP", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const dados = paraLatin1("<x/>");
  const zip = criarZip([{ nome: "a.xml", dados }], new Date(2026, 10, 5, 10, 30, 0));
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50, "cabeçalho local");
  assert.equal(dv.getUint32(14, true), crc32(dados));
  assert.equal(dv.getUint32(18, true), dados.length);
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50, "fim do diretório");
  assert.equal(dv.getUint16(zip.length - 22 + 10, true), 1, "um arquivo");
});

test("idade e sexo do animal no código do SNGPC", () => {
  const hoje = new Date(2026, 10, 5);
  assert.deepEqual(idadeParaSngpc("2023-05-10", hoje), { idade: 3, unidade: 1 });
  assert.deepEqual(idadeParaSngpc("2026-08-10", hoje), { idade: 2, unidade: 2 });
  assert.deepEqual(idadeParaSngpc("2025-11-06", hoje), { idade: 11, unidade: 2 });
  assert.deepEqual(idadeParaSngpc("2025-11-05", hoje), { idade: 1, unidade: 1 });
  assert.equal(idadeParaSngpc(null, hoje), null);
  assert.equal(idadeParaSngpc("2027-01-01", hoje), null);
  assert.equal(sexoParaSngpc("macho"), 1);
  assert.equal(sexoParaSngpc("femea"), 2);
  assert.equal(sexoParaSngpc(null), null);
});

test("itens: conferência da linha e soma por lote", () => {
  assert.equal(erroDoItem({ medicamento_id: "m", lote: "L1", quantidade: "4" }), null);
  assert.notEqual(erroDoItem({ medicamento_id: "", lote: "L1", quantidade: "4" }), null);
  assert.notEqual(erroDoItem({ medicamento_id: "m", lote: "", quantidade: "4" }), null);
  assert.notEqual(erroDoItem({ medicamento_id: "m", lote: "L 1", quantidade: "4" }), null);
  assert.notEqual(erroDoItem({ medicamento_id: "m", lote: "L1", quantidade: "0" }), null);
  assert.notEqual(erroDoItem({ medicamento_id: "m", lote: "L1", quantidade: "1000" }), null);
  assert.notEqual(erroDoItem({ medicamento_id: "m", lote: "L1", quantidade: "1,5" }), null);
  const soma = somaPorLote([
    { medicamento_id: "m", lote: "l1", quantidade: 3 },
    { medicamento_id: "m", lote: "L1 ", quantidade: 2 },
    { medicamento_id: "n", lote: "L1", quantidade: 1 },
  ]);
  assert.equal(soma.get("m|L1"), 5);
  assert.equal(soma.size, 2);
});

test("rótulos", () => {
  assert.match(rotuloReceituario(2), /azul/);
  assert.equal(rotuloReceituario(5), "");
  assert.equal(rotuloMotivoPerda(3), "Vencimento");
});

import { dataTravada } from "../src/lib/sngpc.ts";

test("data travada: dentro de um período com arquivo gerado ou transmitido", () => {
  const periodos = [
    { inicio: "2026-11-01", fim: "2026-11-05", situacao: "gerado" as const },
    { inicio: "2026-11-10", fim: "2026-11-12", situacao: "transmitido" as const },
  ];
  assert.equal(dataTravada("2026-11-01", periodos), true);
  assert.equal(dataTravada("2026-11-05", periodos), true);
  assert.equal(dataTravada("2026-11-06", periodos), false);
  assert.equal(dataTravada("2026-11-11", periodos), true);
  assert.equal(dataTravada("2026-11-13", periodos), false);
  assert.equal(dataTravada("2026-11-01", []), false);
});
