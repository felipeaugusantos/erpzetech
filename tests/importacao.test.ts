import assert from "node:assert/strict";
import test from "node:test";

import {
  LIMITE_LINHAS,
  cnpjValido,
  csvErros,
  decodificar,
  errosDaLeitura,
  lerCsv,
  lerNumero,
  lerPlanilha,
  modeloCsv,
  normalizar,
  paraEnvio,
} from "../src/lib/importacao.ts";

test("normalizar: sem acento, minúsculas e com sublinhado", () => {
  assert.equal(normalizar("Preço de Venda"), "preco_de_venda");
  assert.equal(normalizar(" CST/CSOSN "), "cst_csosn");
  assert.equal(normalizar("E-mail"), "e_mail");
});

test("lerCsv: separadores ; , e tabulação, aspas e quebra de linha dentro das aspas", () => {
  assert.deepEqual(lerCsv("a;b;c\r\n1;2;3\r\n"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
  assert.deepEqual(lerCsv("a,b\n1,2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(lerCsv("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(lerCsv('x;y\n"linha 1\nlinha 2";"com ""aspas"""\n'), [
    ["x", "y"],
    ["linha 1\nlinha 2", 'com "aspas"'],
  ]);
  assert.deepEqual(lerCsv("﻿a;b\n\n;\n1;2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("decodificar: UTF-8 e Latin-1", () => {
  assert.equal(decodificar(new TextEncoder().encode("Descrição")), "Descrição");
  assert.equal(
    decodificar(Uint8Array.from([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f])),
    "Descrição",
  );
});

test("lerNumero: formato brasileiro, americano, R$ e lixo", () => {
  assert.equal(lerNumero(""), null);
  assert.equal(lerNumero("39,90"), 39.9);
  assert.equal(lerNumero("39.90"), 39.9);
  assert.equal(lerNumero("1.234,56"), 1234.56);
  assert.equal(lerNumero("1,234.56"), 1234.56);
  assert.equal(lerNumero("R$ 1.500"), 1500);
  assert.equal(lerNumero("1,500"), 1500);
  assert.equal(lerNumero("-3"), -3);
  assert.ok(Number.isNaN(lerNumero("abc")));
  assert.ok(Number.isNaN(lerNumero("12abc")));
  assert.ok(Number.isNaN(lerNumero("1,2,3")));
});

test("CNPJ: dígitos verificadores", () => {
  assert.equal(cnpjValido("11.222.333/0001-81"), true);
  assert.equal(cnpjValido("11222333000182"), false);
  assert.equal(cnpjValido("00000000000000"), false);
  assert.equal(cnpjValido("123"), false);
});

test("o modelo baixado volta lido sem erro, nos três tipos", () => {
  for (const tipo of ["produtos", "clientes", "saldos"] as const) {
    const l = lerPlanilha(tipo, modeloCsv(tipo));
    assert.equal(l.faltando.length, 0, `${tipo}: colunas faltando ${l.faltando.join(",")}`);
    assert.equal(l.ignoradas.length, 0, `${tipo}: colunas ignoradas ${l.ignoradas.join(",")}`);
    assert.equal(l.linhas.length, 1);
    assert.deepEqual(errosDaLeitura(l), [], tipo);
  }
});

test("produtos: casa colunas por apelido, entrega números e conta as linhas a partir da 2", () => {
  const csv =
    "SKU;Produto;UN;Preço;Custo;NCM;Qualquer coisa\nA1;Tijolo;mil;1.250,00;900;6904.10.00;x\nA2;Telha;un;10;;;y\n";
  const l = lerPlanilha("produtos", csv);
  assert.deepEqual(l.ignoradas, ["Qualquer coisa"]);
  assert.equal(l.linhas[0]?.linha, 2);
  assert.equal(l.linhas[1]?.linha, 3);
  assert.equal(l.linhas[0]?.envio["preco_venda"], 1250);
  assert.equal(l.linhas[0]?.envio["custo"], 900);
  assert.equal(l.linhas[1]?.envio["custo"], null);
  assert.equal(l.totalErros, 0);
  const envio = paraEnvio(l);
  assert.equal(envio[0]?.["linha"], 2);
  assert.equal(envio[0]?.["codigo_interno"], "A1");
});

test("produtos: erros por linha", () => {
  const csv = [
    "codigo;descricao;preco;ncm;cfop;estoque minimo;estoque maximo",
    ";Sem código;1;;;;",
    "B1;;1;;;;",
    "B2;Preço ruim;abc;;;;",
    "B3;Negativo;-2;;;;",
    "B4;NCM curto;1;123;;;",
    "B5;CFOP curto;1;;51;;",
    "B6;Faixa;1;;;10;5",
    "B7;Ok;1;25232990;5102;1;5",
    "b7;Repetido;1;;;;",
  ].join("\n");
  const l = lerPlanilha("produtos", csv);
  const por = (n: number) => l.linhas.find((x) => x.linha === n)?.erros.join("|") ?? "";
  assert.match(por(2), /código/i);
  assert.match(por(3), /descrição/i);
  assert.match(por(4), /não é um número/);
  assert.match(por(5), /negativo/);
  assert.match(por(6), /NCM/);
  assert.match(por(7), /CFOP/);
  assert.match(por(8), /máximo menor/);
  assert.equal(por(9), "");
  assert.match(por(10), /repetido \(primeira vez na linha 9\)/);
});

test("coluna obrigatória ausente é avisada", () => {
  const l = lerPlanilha("produtos", "preco\n1\n");
  assert.deepEqual(l.faltando, ["Código", "Descrição"]);
  const s = lerPlanilha("saldos", "codigo;deposito\nA;Loja\n");
  assert.deepEqual(s.faltando, ["Quantidade"]);
});

test("clientes: documento válido, inválido e repetido; e-mail e estado", () => {
  const csv = [
    "nome;cpf_cnpj;email;uf",
    "Alfa;11.222.333/0001-81;a@b.com;sp",
    "Beto;529.982.247-25;;",
    "Ruim;111.111.111-11;;",
    "Curto;123;;",
    "Mail;;sem-arroba;",
    "UF;;;SPP",
    "Alfa de novo;11222333000181;;",
    "Sem doc;;;",
    "sem doc;;;",
  ].join("\n");
  const l = lerPlanilha("clientes", csv);
  const por = (n: number) => l.linhas.find((x) => x.linha === n)?.erros.join("|") ?? "";
  assert.equal(por(2), "");
  assert.equal(por(3), "");
  assert.match(por(4), /CPF inválido/);
  assert.match(por(5), /11 números/);
  assert.match(por(6), /E-mail/);
  assert.match(por(7), /2 letras/);
  assert.match(por(8), /repetido/);
  assert.equal(por(9), "");
  assert.match(por(10), /repetido/);
});

test("saldos: quantidade maior que zero e linha repetida para o mesmo depósito", () => {
  const csv = "codigo;deposito;quantidade\nA;Loja;10\nA;Loja;5\nA;Obra;5\nB;Loja;0\nC;Loja;x\n";
  const l = lerPlanilha("saldos", csv);
  const por = (n: number) => l.linhas.find((x) => x.linha === n)?.erros.join("|") ?? "";
  assert.equal(por(2), "");
  assert.match(por(3), /mesmo depósito/);
  assert.equal(por(4), "");
  assert.match(por(5), /maior que zero/);
  assert.match(por(6), /não é um número/);
});

test("linha em branco no meio não desloca o número das linhas seguintes", () => {
  const csv = "codigo;descricao\nA1;Item A\n\n;\nA3;\nA4;Item D\n";
  const l = lerPlanilha("produtos", csv);
  assert.deepEqual(
    l.linhas.map((x) => x.linha),
    [2, 5, 6],
  );
  const por = (n: number) => l.linhas.find((x) => x.linha === n)?.erros.join("|") ?? "";
  assert.equal(por(2), "");
  assert.match(por(5), /descrição/i);
  assert.equal(por(6), "");
  assert.equal(paraEnvio(l)[1]?.["linha"], 5);
});

test("limite de linhas", () => {
  const corpo = Array.from({ length: LIMITE_LINHAS + 3 }, (_, i) => `P${i};Item ${i}`).join("\n");
  const l = lerPlanilha("produtos", `codigo;descricao\n${corpo}\n`);
  assert.equal(l.excedeLimite, true);
  assert.ok(l.linhas.length <= LIMITE_LINHAS + 1);
  const ok = lerPlanilha(
    "produtos",
    `codigo;descricao\n${corpo.split("\n").slice(0, LIMITE_LINHAS).join("\n")}\n`,
  );
  assert.equal(ok.excedeLimite, false);
});

test("csvErros: linha e motivo, abre no Excel", () => {
  const c = csvErros([{ linha: 3, mensagem: 'NCM; "ruim"' }]);
  assert.ok(c.startsWith("﻿linha;erro"));
  assert.ok(c.includes('3;"NCM; ""ruim"""'));
});
