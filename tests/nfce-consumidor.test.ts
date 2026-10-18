import assert from "node:assert/strict";
import test from "node:test";

import {
  cpfSalvo,
  cpfValido,
  erroCpf,
  formatarCpf,
  resumirNfce,
} from "../src/lib/nfce-consumidor.ts";

test("CPF: dígitos verificadores", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("52998224725"), true);
  assert.equal(cpfValido("529.982.247-24"), false);
  assert.equal(cpfValido("111.111.111-11"), false);
  assert.equal(cpfValido("123"), false);
  assert.equal(cpfValido(""), false);
});

test("CPF em branco é válido (consumidor não identificado); errado mostra a mensagem", () => {
  assert.equal(erroCpf(""), null);
  assert.equal(erroCpf("  "), null);
  assert.equal(erroCpf("52998224725"), null);
  assert.match(erroCpf("12345678900") ?? "", /CPF inválido/);
});

test("formatarCpf aplica a máscara enquanto digita", () => {
  assert.equal(formatarCpf("529"), "529");
  assert.equal(formatarCpf("5299"), "529.9");
  assert.equal(formatarCpf("529982"), "529.982");
  assert.equal(formatarCpf("5299822"), "529.982.2");
  assert.equal(formatarCpf("52998224725"), "529.982.247-25");
  assert.equal(formatarCpf("529982247259999"), "529.982.247-25");
});

const base = { numero: 7, serie: 3, pendencias: [], mensagem: null, contingencia: false };

test("resumo da NFC-e pronta avisa que a transmissão ainda não está ativa", () => {
  const r = resumirNfce({ ...base, situacao: "pronta" });
  assert.equal(r.tom, "aviso");
  assert.match(r.titulo, /nº 7 · série 3 pronta/);
  assert.match(r.detalhes[0] ?? "", /ainda não está ativa/);
});

test("resumo com contingência ligada muda o texto", () => {
  const r = resumirNfce({ ...base, situacao: "pronta", contingencia: true });
  assert.match(r.detalhes[0] ?? "", /contingência/);
});

test("rascunho lista as pendências", () => {
  const r = resumirNfce({
    ...base,
    numero: null,
    situacao: "rascunho",
    pendencias: ["CSC da NFC-e (código e token) não configurado"],
  });
  assert.equal(r.tom, "erro");
  assert.deepEqual(r.detalhes, ["CSC da NFC-e (código e token) não configurado"]);
});

test("rejeitada mostra o motivo; autorizada e cancelada não têm detalhe extra", () => {
  assert.deepEqual(
    resumirNfce({ ...base, situacao: "rejeitada", mensagem: "Rejeição 539" }).detalhes,
    ["Rejeição 539"],
  );
  assert.equal(resumirNfce({ ...base, situacao: "autorizada" }).tom, "ok");
  assert.equal(resumirNfce({ ...base, situacao: "cancelada" }).tom, "erro");
});

test("cpfSalvo devolve o CPF da nota em rascunho para a nova tentativa não perdê-lo", () => {
  assert.equal(cpfSalvo({ consumidor: "identificado", cpf: "52998224725" }), "529.982.247-25");
  assert.equal(cpfSalvo({ consumidor: "não identificado" }), "");
  assert.equal(cpfSalvo(null), "");
  assert.equal(cpfSalvo("texto"), "");
  assert.equal(cpfSalvo({ cpf: 123 }), "");
});
