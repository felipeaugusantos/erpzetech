import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cnpjDaEmpresa,
  dataIbpt,
  gtinValido,
  LimitadorConsultas,
  empresaHabilitada,
  hojeBrasilia,
  lerRespostaIbpt,
  montarUrl,
  validarConsulta,
} from "../src/lib/ibpt-api.ts";

const c = {
  ncm: "8471.30.12",
  uf: "sp",
  descricao: "Notebook",
  unidadeMedida: "UN",
  valor: 10,
  gtin: "7891234567895",
};
const HOJE = "2026-11-11";
const ok = {
  Codigo: "84713012",
  UF: "SP",
  EX: 0,
  Nacional: 13.45,
  Estadual: 18,
  Importado: 17.3,
  Municipal: 0,
  Tipo: "0",
  VigenciaInicio: "01/07/2026",
  VigenciaFim: "31/12/2026",
  Versao: "26.2.A",
  Fonte: "IBPT",
};
const q = { ncm: "84713012", uf: "SP", ex: 0 };

test("montarUrl usa os nomes de parâmetro da API e normaliza NCM, UF e CNPJ", () => {
  const u = new URL(montarUrl(c, "TOK", "12.345.678/0001-95"));
  assert.equal(u.origin + u.pathname, "https://apidoni.ibpt.org.br/api/v1/produtos");
  assert.equal(u.searchParams.get("codigo"), "84713012");
  assert.equal(u.searchParams.get("uf"), "SP");
  assert.equal(u.searchParams.get("ex"), "0");
  assert.equal(u.searchParams.get("cnpj"), "12345678000195");
  assert.equal(u.searchParams.get("valor"), "10.00");
  assert.equal(u.searchParams.get("gtin"), "7891234567895");
  assert.equal(u.searchParams.get("token"), "TOK");
});

test("GTIN é obrigatório e conferido antes de qualquer chamada; nada é inventado", () => {
  assert.throws(() => validarConsulta({ ...c, gtin: "" }), /GTIN/);
  assert.throws(() => validarConsulta({ ...c, gtin: undefined } as never), /GTIN/);
  assert.throws(() => validarConsulta({ ...c, gtin: "7891234567890" }), /GTIN/);
  assert.throws(() => validarConsulta({ ...c, gtin: "12345" }), /GTIN/);
  assert.equal(
    validarConsulta({ ...c, gtin: "7891234567895".replace(/(\d{3})/, "$1-") }).gtin,
    "7891234567895",
  );
  assert.equal(gtinValido("40170725"), true);
});

test("validação rejeita NCM, UF, CNPJ e token inválidos", () => {
  assert.throws(() => validarConsulta({ ...c, ncm: "123" }));
  assert.throws(() => validarConsulta({ ...c, uf: "XX" }));
  assert.throws(() => validarConsulta({ ...c, descricao: " " }));
  assert.throws(() => montarUrl(c, "TOK", "123"));
  assert.throws(() => montarUrl(c, "", "12345678000195"));
});

test("lerRespostaIbpt converte a resposta na linha do CSV", () => {
  assert.deepEqual(lerRespostaIbpt([ok], q, HOJE), {
    ncm: "84713012",
    aliq_nacional_federal: 13.45,
    aliq_importado_federal: 17.3,
    aliq_estadual: 18,
    aliq_municipal: 0,
    vigencia_fim: "2026-12-31",
    versao: "26.2.A",
    fonte: "IBPT",
  });
});

test("divergência de NCM, UF, EX, alíquota ou vigência é erro, nunca valor presumido", () => {
  assert.throws(() => lerRespostaIbpt([], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, UF: "RJ" }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, UF: undefined }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, Codigo: "84713019" }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, EX: 1 }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, Nacional: -1 }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, Estadual: 101 }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, Municipal: "x" }], q, HOJE));
  assert.throws(() => lerRespostaIbpt([{ ...ok, VigenciaFim: "10/10/2026" }], q, HOJE), /vencida/);
  assert.throws(() => lerRespostaIbpt([{ ...ok, VigenciaFim: "lixo" }], q, HOJE), /vigência/);
  assert.throws(() => lerRespostaIbpt([{ ...ok, VigenciaInicio: "01/01/2027" }], q, HOJE));
  assert.throws(() => lerRespostaIbpt("texto", q, HOJE));
  assert.throws(() => lerRespostaIbpt(null, q, HOJE));
});

test("aceita objeto único e exceção tarifária consultada", () => {
  assert.equal(lerRespostaIbpt({ ...ok, EX: 2 }, { ...q, ex: 2 }, HOJE).ncm, "84713012");
  assert.equal(lerRespostaIbpt({ ...ok, VigenciaFim: "" }, q, HOJE).vigencia_fim, null);
});

test("empresa só consulta se estiver na lista; sem lista, ninguém", () => {
  const a = "11111111-1111-1111-1111-111111111111";
  const b = "22222222-2222-2222-2222-222222222222";
  assert.equal(empresaHabilitada(undefined, a), false);
  assert.equal(empresaHabilitada("", a), false);
  assert.equal(empresaHabilitada(`${a}, ${b.toUpperCase()}`, b), true);
  assert.equal(empresaHabilitada(a, b), false);
  assert.equal(empresaHabilitada(a, null), false);
});

test("dataIbpt e hojeBrasilia", () => {
  assert.equal(dataIbpt("31/12/2026"), "2026-12-31");
  assert.equal(dataIbpt("2026-12-31T00:00:00"), "2026-12-31");
  assert.equal(dataIbpt(""), null);
  assert.equal(hojeBrasilia(new Date("2026-11-11T02:00:00Z")), "2026-11-10");
});

test("credencial só serve à empresa dona do CNPJ; divergência ou CNPJ inválido falha fechado", () => {
  assert.equal(cnpjDaEmpresa("12.345.678/0001-95", ["12345678000195", null]), true);
  assert.equal(cnpjDaEmpresa("12345678000195", ["98765432000100"]), false);
  assert.equal(cnpjDaEmpresa("12345678000195", []), false);
  assert.equal(cnpjDaEmpresa(undefined, ["12345678000195"]), false);
  assert.equal(cnpjDaEmpresa("123", ["123"]), false);
});

test("contenção local: uma por vez, intervalo mínimo e teto por janela, por empresa", () => {
  const l = new LimitadorConsultas(3, 60_000, 1_000);
  l.reservar("a", 0);
  assert.throws(() => l.reservar("a", 5_000), /andamento/);
  l.reservar("b", 0); // outra empresa não é afetada
  l.liberar("a");
  assert.throws(() => l.reservar("a", 500), /Aguarde/);
  l.reservar("a", 2_000);
  l.liberar("a");
  l.reservar("a", 4_000);
  l.liberar("a");
  assert.throws(() => l.reservar("a", 6_000), /Limite/);
  l.reservar("a", 62_000); // janela venceu
});
