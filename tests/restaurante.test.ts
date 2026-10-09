import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularConta,
  dividirConta,
  ehGestaoSalao,
  ehSalaoRestrito,
  minutosDesde,
  proximoPreparo,
  recebeConta,
  validarOpcoes,
} from "../src/lib/restaurante.ts";

test("perfil do salão é restrito só quando não há outro papel", () => {
  assert.equal(ehSalaoRestrito(["garcom"]), true);
  assert.equal(ehSalaoRestrito(["cozinha", "garcom"]), true);
  assert.equal(ehSalaoRestrito(["garcom", "caixa"]), false);
  assert.equal(ehSalaoRestrito(["administrador"]), false);
  assert.equal(ehSalaoRestrito([]), false);
});

test("gestão e recebimento da conta", () => {
  assert.equal(ehGestaoSalao(["gestor"]), true);
  assert.equal(ehGestaoSalao(["caixa"]), false);
  assert.equal(recebeConta(["caixa"]), true);
  assert.equal(recebeConta(["garcom"]), false);
});

test("próximo passo do preparo", () => {
  assert.deepEqual(proximoPreparo("enviado"), { para: "preparando", rotulo: "Iniciar preparo" });
  assert.deepEqual(proximoPreparo("preparando"), { para: "pronto", rotulo: "Marcar pronto" });
  assert.equal(proximoPreparo("pronto"), null);
  assert.equal(proximoPreparo("pendente"), null);
});

test("conta com serviço de 10% e couvert", () => {
  const c = calcularConta({
    subtotal: 96,
    pessoas: 2,
    couvertPorPessoa: 5,
    taxaServicoPercentual: 10,
    cobrarServico: true,
    desconto: 0,
  });
  assert.deepEqual(c, {
    subtotal: 96,
    couvert: 10,
    servico: 9.6,
    bruto: 115.6,
    desconto: 0,
    descontoExcede: false,
    total: 115.6,
  });
});

test("conta sem serviço e com desconto limitado ao total", () => {
  const c = calcularConta({
    subtotal: 50,
    pessoas: null,
    couvertPorPessoa: 5,
    taxaServicoPercentual: 10,
    cobrarServico: false,
    desconto: 80,
  });
  assert.equal(c.couvert, 0);
  assert.equal(c.servico, 0);
  assert.equal(c.total, 0);
  assert.equal(c.descontoExcede, true);
});

test("arredondamento do serviço em centavos", () => {
  const c = calcularConta({
    subtotal: 33.33,
    pessoas: 1,
    couvertPorPessoa: 0,
    taxaServicoPercentual: 10,
    cobrarServico: true,
    desconto: 0,
  });
  assert.equal(c.servico, 3.33);
  assert.equal(c.total, 36.66);
});

test("dividir a conta: soma exata e a última fica com os centavos", () => {
  assert.deepEqual(dividirConta(100, 3), [33.33, 33.33, 33.34]);
  assert.deepEqual(dividirConta(90, 3), [30, 30, 30]);
  assert.deepEqual(dividirConta(10, 1), [10]);
  assert.deepEqual(dividirConta(10, 0), [10]);
  const soma = dividirConta(115.6, 7).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(soma * 100), 11560);
});

test("validação das opções do item", () => {
  const grupos = [
    { id: "g1", nome: "Ponto", obrigatorio: true, max_escolhas: 1 },
    { id: "g2", nome: "Adicionais", obrigatorio: false, max_escolhas: 2 },
  ];
  const opcoes = [
    { id: "o1", grupo_id: "g1" },
    { id: "o2", grupo_id: "g1" },
    { id: "a1", grupo_id: "g2" },
    { id: "a2", grupo_id: "g2" },
    { id: "a3", grupo_id: "g2" },
  ];
  assert.equal(validarOpcoes(grupos, opcoes, ["o1"]), null);
  assert.match(validarOpcoes(grupos, opcoes, []) ?? "", /Ponto/);
  assert.match(validarOpcoes(grupos, opcoes, ["o1", "o2"]) ?? "", /só uma/);
  assert.match(validarOpcoes(grupos, opcoes, ["o1", "a1", "a2", "a3"]) ?? "", /no máximo 2/);
});

test("minutos de espera", () => {
  const agora = new Date("2026-10-09T12:30:00Z");
  assert.equal(minutosDesde("2026-10-09T12:10:30Z", agora), 19);
  assert.equal(minutosDesde(null, agora), 0);
  assert.equal(minutosDesde("2026-10-09T13:00:00Z", agora), 0);
});

test("meio centavo arredonda para cima, como o numeric do banco", () => {
  const c = calcularConta({
    subtotal: 40.15,
    pessoas: null,
    couvertPorPessoa: 0,
    taxaServicoPercentual: 10,
    cobrarServico: true,
    desconto: 0,
  });
  assert.equal(c.servico, 4.02);
  assert.equal(c.total, 44.17);
  const d = calcularConta({
    subtotal: 10.05,
    pessoas: 3,
    couvertPorPessoa: 2.5,
    taxaServicoPercentual: 12.5,
    cobrarServico: true,
    desconto: 0.3,
  });
  assert.equal(d.couvert, 7.5);
  assert.equal(d.servico, 1.26);
  assert.equal(d.total, 18.51);
});
