import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cnaesDaEmpresa,
  moduloLiberadoEmpresa,
  moduloLiberadoPorCnae,
} from "../src/lib/cnae-regras.ts";
import {
  TIPOS_VEICULO,
  comissaoDoLavador,
  formatarIdentificacao,
  identificacaoValida,
  liquidoDoServico,
  minutosNoPatio,
  normalizarIdentificacao,
  ordemAberta,
  podeMudarPara,
  precoDoServico,
  proximaSituacao,
  textoTempo,
} from "../src/lib/lava-rapido.ts";

test("o lava rápido atende carro, moto, caminhonete, avião e helicóptero", () => {
  assert.deepEqual(
    TIPOS_VEICULO.map((t) => t.value),
    ["carro", "moto", "caminhonete", "aviao", "helicoptero"],
  );
});

test("placa antiga e Mercosul valem para veículo terrestre", () => {
  for (const tipo of ["carro", "moto", "caminhonete"]) {
    assert.equal(identificacaoValida(tipo, "abc-1234"), true);
    assert.equal(identificacaoValida(tipo, "ABC1D23"), true);
    assert.equal(identificacaoValida(tipo, "ABC 1d23"), true);
    assert.equal(identificacaoValida(tipo, "1234ABC"), false);
    assert.equal(identificacaoValida(tipo, "ABC12"), false);
    assert.equal(identificacaoValida(tipo, ""), false);
  }
});

test("avião e helicóptero são identificados pelo prefixo da aeronave, não pela placa", () => {
  for (const tipo of ["aviao", "helicoptero"]) {
    assert.equal(identificacaoValida(tipo, "PT-ABC"), true);
    assert.equal(identificacaoValida(tipo, "pr xyz"), true);
    assert.equal(identificacaoValida(tipo, "PT"), false);
    assert.equal(identificacaoValida(tipo, "PT-ABCDEFG"), false);
  }
  assert.equal(identificacaoValida("carro", "PTABC"), false);
});

test("a identificação é guardada em maiúsculas e mostrada no formato usual", () => {
  assert.equal(normalizarIdentificacao("abc-1d23"), "ABC1D23");
  assert.equal(formatarIdentificacao("carro", "abc1234"), "ABC-1234");
  assert.equal(formatarIdentificacao("moto", "abc1d23"), "ABC1D23");
  assert.equal(formatarIdentificacao("aviao", "ptabc"), "PT-ABC");
});

test("preço: o do tipo vence o geral, que vence o preço de balcão", () => {
  const precos = [
    { tipo: null, preco: 30 },
    { tipo: "carro", preco: 40 },
    { tipo: "aviao", preco: 900 },
  ];
  assert.equal(precoDoServico("carro", precos, 25), 40);
  assert.equal(precoDoServico("aviao", precos, 25), 900);
  assert.equal(precoDoServico("moto", precos, 25), 30);
  assert.equal(precoDoServico("helicoptero", [], 25), 25);
  assert.equal(precoDoServico("carro", [{ tipo: "moto", preco: 20 }], 25), 25);
});

test("quadro do pátio: segue em frente, volta um passo e cancela; entregue só pela cobrança", () => {
  assert.equal(proximaSituacao("aguardando"), "lavando");
  assert.equal(proximaSituacao("lavando"), "secando");
  assert.equal(proximaSituacao("secando"), "pronto");
  assert.equal(proximaSituacao("pronto"), null);
  assert.equal(podeMudarPara("aguardando", "pronto"), false);
  assert.equal(podeMudarPara("lavando", "pronto"), true);
  assert.equal(podeMudarPara("pronto", "secando"), true);
  assert.equal(podeMudarPara("pronto", "entregue"), false);
  assert.equal(podeMudarPara("entregue", "cancelada"), false);
  assert.equal(podeMudarPara("cancelada", "aguardando"), false);
});

test("ordem entregue ou cancelada não ocupa mais o veículo", () => {
  assert.equal(ordemAberta("pronto"), true);
  assert.equal(ordemAberta("entregue"), false);
  assert.equal(ordemAberta("cancelada"), false);
});

test("comissão sobre o serviço líquido do desconto da venda", () => {
  // serviço de 40 numa venda de 40 com desconto de 4: sobra 36, comissão de 20% = 7,20
  assert.equal(liquidoDoServico(40, 40, 36), 36);
  assert.equal(comissaoDoLavador(36, 20), 7.2);
  assert.equal(liquidoDoServico(60, 100, 90), 54);
  assert.equal(liquidoDoServico(60, 0, 0), 60);
  assert.equal(comissaoDoLavador(100, 0), 0);
});

test("tempo no pátio", () => {
  const entrada = "2026-10-28T10:00:00Z";
  assert.equal(minutosNoPatio(entrada, new Date("2026-10-28T10:45:00Z")), 45);
  assert.equal(minutosNoPatio(entrada, new Date("2026-10-28T09:00:00Z")), 0);
  assert.equal(textoTempo(45), "45 min");
  assert.equal(textoTempo(120), "2 h");
  assert.equal(textoTempo(95), "1 h 35 min");
});

test("CNAE 45.20-0/06 libera o lava rápido; oficina e vizinhos não", () => {
  const libera = (cnae: string) => moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae }), "lavarapido");
  assert.equal(libera("4520-0/06"), true);
  assert.equal(libera("4520-0/01"), false); // oficina mecânica
  assert.equal(libera("4511-1/01"), false); // venda de automóveis
  assert.equal(
    moduloLiberadoPorCnae(
      cnaesDaEmpresa({ cnae: "4711-3/01", cnae_secundarios: "4520-0/06" }),
      "lavarapido",
    ),
    true,
  );
});

test("sem CNPJ escolhe o lava rápido na mão; com CNPJ vale o CNAE ou a liberação explícita", () => {
  assert.equal(
    moduloLiberadoEmpresa({ cnpj: "", modulos_sem_cnpj: ["lavarapido"] }, "lavarapido"),
    true,
  );
  assert.equal(moduloLiberadoEmpresa({ cnpj: "", modulos_sem_cnpj: [] }, "lavarapido"), false);
  const comCnpj = { cnpj: "44.543.662/0001-83", cnae: "6911-7/03" };
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, modulos_sem_cnpj: ["lavarapido"] }, "lavarapido"),
    false,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, modulos_liberados: ["lavarapido"] }, "lavarapido"),
    true,
  );
  assert.equal(moduloLiberadoEmpresa({ ...comCnpj, cnae: "4520-0/06" }, "lavarapido"), true);
});
