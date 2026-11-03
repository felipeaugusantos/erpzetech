import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cardapioSugerido,
  dentroDoHorario,
  itensDoCardapio,
  precoNoCardapio,
} from "../src/lib/cardapios.ts";
import { itensSemCorrespondencia, totalItensPedido } from "../src/lib/pedido-externo.ts";
import { calcularPesagem, kgTexto, pesoEmGramas } from "../src/lib/pesagem.ts";
import {
  calcularBaixa,
  calcularConta,
  dividirConta,
  ehGestaoSalao,
  reservaVigente,
  rotuloEstacao,
  statusMesa,
  ehProfissionalRestrito,
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
  assert.equal(ehSalaoRestrito(["profissional"]), false);
  assert.equal(ehSalaoRestrito(["garcom", "profissional"]), true);
  assert.equal(ehSalaoRestrito(["garcom", "profissional", "vendedor"]), false);
  assert.equal(ehProfissionalRestrito(["profissional"]), true);
  assert.equal(ehProfissionalRestrito(["profissional", "garcom"]), false);
  assert.equal(ehProfissionalRestrito(["profissional", "vendedor"]), false);
  assert.equal(ehProfissionalRestrito([]), false);
  assert.equal(ehProfissionalRestrito(["veterinario"]), true);
  assert.equal(ehProfissionalRestrito(["veterinario", "profissional"]), true);
  assert.equal(ehProfissionalRestrito(["veterinario", "administrador"]), false);
  assert.equal(ehSalaoRestrito(["veterinario"]), false);
  assert.equal(ehSalaoRestrito(["garcom", "veterinario"]), true);
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
    jaPago: 0,
    restante: 115.6,
    pagoExcede: false,
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

test("saldo da conta depois de baixas parciais", () => {
  const base = {
    subtotal: 85,
    pessoas: 4,
    couvertPorPessoa: 5,
    taxaServicoPercentual: 10,
    cobrarServico: true,
    desconto: 0,
  };
  const c = calcularConta({ ...base, jaPago: 84.5 });
  assert.equal(c.total, 113.5);
  assert.equal(c.jaPago, 84.5);
  assert.equal(c.restante, 29);
  assert.equal(c.pagoExcede, false);
  // sem baixa, o saldo é a conta inteira
  assert.equal(calcularConta(base).restante, 113.5);
  // desconto depois da baixa pode deixar o já recebido acima do total
  const d = calcularConta({ ...base, jaPago: 84.5, desconto: 40 });
  assert.equal(d.pagoExcede, true);
  assert.equal(d.restante, 0);
});

test("baixa por itens: unidades, serviço e couvert de quem sai (mesma conta do banco)", () => {
  // 1 cerveja de 20 + 2 porções de 12,50, serviço de 10%, 1 pessoa com couvert de 5
  const b = calcularBaixa({
    linhas: [
      { preco: 20, quantidade: 1 },
      { preco: 12.5, quantidade: 2 },
    ],
    pessoas: 1,
    couvertPorPessoa: 5,
    taxaServicoPercentual: 10,
    cobrarServico: true,
  });
  assert.deepEqual(b, { itens: 45, servico: 4.5, couvert: 5, total: 54.5 });
  const semServico = calcularBaixa({
    linhas: [{ preco: 20, quantidade: 1 }],
    pessoas: 0,
    couvertPorPessoa: 5,
    taxaServicoPercentual: 10,
    cobrarServico: false,
  });
  assert.deepEqual(semServico, { itens: 20, servico: 0, couvert: 0, total: 20 });
  // meio centavo arredonda para cima
  assert.equal(
    calcularBaixa({
      linhas: [{ preco: 40.15, quantidade: 1 }],
      pessoas: 0,
      couvertPorPessoa: 0,
      taxaServicoPercentual: 10,
      cobrarServico: true,
    }).servico,
    4.02,
  );
});

test("serviço acumulado: duas baixas somam o serviço da conta inteira (sem perder centavo)", () => {
  const base = { pessoas: 0, couvertPorPessoa: 0, taxaServicoPercentual: 10, cobrarServico: true };
  // dois itens de R$ 10,05: o serviço da conta é 2,01; separado seria 1,01 + 1,01 = 2,02
  const primeira = calcularBaixa({ ...base, linhas: [{ preco: 10.05, quantidade: 1 }] });
  assert.deepEqual(primeira, { itens: 10.05, servico: 1.01, couvert: 0, total: 11.06 });
  const segunda = calcularBaixa({
    ...base,
    linhas: [{ preco: 10.05, quantidade: 1 }],
    baseAnterior: 10.05,
  });
  assert.deepEqual(segunda, { itens: 10.05, servico: 1, couvert: 0, total: 11.05 });
  assert.equal(
    primeira.total + segunda.total,
    calcularConta({
      subtotal: 20.1,
      pessoas: null,
      couvertPorPessoa: 0,
      taxaServicoPercentual: 10,
      cobrarServico: true,
      desconto: 0,
    }).total,
  );
});

test("rotuloEstacao: fixas, cadastradas e desconhecidas", () => {
  const pracas = [{ codigo: "churrascaria", nome: "Churrascaria" }];
  assert.equal(rotuloEstacao("cozinha", pracas), "Cozinha");
  assert.equal(rotuloEstacao("nenhuma", pracas), "Pronto para servir");
  assert.equal(rotuloEstacao("churrascaria", pracas), "Churrascaria");
  assert.equal(rotuloEstacao("sumiu", pracas), "sumiu");
});

test("statusMesa: ocupada > bloqueada > reservada > livre", () => {
  const agora = new Date("2026-11-01T20:00:00Z").getTime();
  const em = (min: number) => new Date(agora + min * 60_000).toISOString();
  const base = { bloqueada: false, ocupada: false, reservas: [], agora };
  assert.equal(statusMesa(base), "livre");
  assert.equal(statusMesa({ ...base, bloqueada: true }), "bloqueada");
  assert.equal(statusMesa({ ...base, bloqueada: true, ocupada: true }), "ocupada");
  assert.equal(statusMesa({ ...base, reservas: [{ reservada_para: em(20) }] }), "reservada");
  assert.equal(
    statusMesa({ ...base, bloqueada: true, reservas: [{ reservada_para: em(0) }] }),
    "bloqueada",
  );
});

test("reservaVigente: de 30 min antes a 2 h depois do horário", () => {
  const agora = new Date("2026-11-01T20:00:00Z").getTime();
  const em = (min: number) => new Date(agora + min * 60_000).toISOString();
  assert.equal(reservaVigente(em(31), agora), false);
  assert.equal(reservaVigente(em(30), agora), true);
  assert.equal(reservaVigente(em(-120), agora), true);
  assert.equal(reservaVigente(em(-121), agora), false);
});

test("calcularPesagem: peso líquido x preço do kg, arredondado no centavo", () => {
  assert.deepEqual(calcularPesagem({ brutoG: 850, taraG: 350, precoKg: 60 }), {
    liquidoG: 500,
    valorSemTeto: 30,
    valor: 30,
    tetoAplicado: false,
  });
  assert.equal(calcularPesagem({ brutoG: 683, taraG: 350, precoKg: 59.9 })?.valor, 19.95);
  assert.equal(calcularPesagem({ brutoG: 685, taraG: 350, precoKg: 59.9 })?.valor, 20.07);
  assert.equal(calcularPesagem({ brutoG: 350, taraG: 350, precoKg: 60 }), null);
  assert.equal(calcularPesagem({ brutoG: 300, taraG: 350, precoKg: 60 }), null);
});

test("calcularPesagem: o buffet livre limita o valor do prato", () => {
  const r = calcularPesagem({ brutoG: 1350, taraG: 350, precoKg: 60, buffetLivre: 40 });
  assert.equal(r?.valorSemTeto, 60);
  assert.equal(r?.valor, 40);
  assert.equal(r?.tetoAplicado, true);
  // um centavo acima já aplica; igual ao teto não conta como aplicado
  assert.equal(
    calcularPesagem({ brutoG: 1367, taraG: 350, precoKg: 60, buffetLivre: 40 })?.tetoAplicado,
    true,
  );
  assert.equal(
    calcularPesagem({ brutoG: 1017, taraG: 350, precoKg: 60, buffetLivre: 40 })?.valor,
    40,
  );
  assert.equal(
    calcularPesagem({ brutoG: 1017, taraG: 350, precoKg: 60, buffetLivre: 40.02 })?.tetoAplicado,
    false,
  );
  assert.equal(
    calcularPesagem({ brutoG: 850, taraG: 350, precoKg: 60, buffetLivre: 40 })?.tetoAplicado,
    false,
  );
  assert.equal(
    calcularPesagem({ brutoG: 1350, taraG: 350, precoKg: 60, buffetLivre: null })?.valor,
    60,
  );
});

test("pesoEmGramas e kgTexto", () => {
  assert.equal(pesoEmGramas("850", "g"), 850);
  assert.equal(pesoEmGramas("0,850", "kg"), 850);
  assert.equal(pesoEmGramas("0.850", "kg"), 850);
  assert.equal(pesoEmGramas("1,25", "kg"), 1250);
  assert.equal(pesoEmGramas("", "g"), null);
  assert.equal(pesoEmGramas("abc", "g"), null);
  assert.equal(pesoEmGramas("0", "g"), null);
  assert.equal(pesoEmGramas("31", "kg"), null);
  assert.equal(kgTexto(500), "0,500 kg");
  assert.equal(kgTexto(1250), "1,250 kg");
});

test("pedido externo: itens sem correspondência e total dos itens", () => {
  const pedido = {
    itens: [
      {
        codigo: "A",
        nome: "Burger",
        quantidade: 2,
        preco: 30,
        adicionais: [
          { nome: "Bacon", preco: 4 },
          { nome: "Queijo", preco: 2.5 },
        ],
      },
      { codigo: "B", nome: "Suco", quantidade: 1, preco: 9.5 },
      { codigo: "B", nome: "Suco", quantidade: 1, preco: 9.5 },
    ],
  };
  assert.deepEqual(
    itensSemCorrespondencia(pedido, [{ codigo_externo: "B" }, { codigo_externo: null }]).map(
      (i) => i.codigo,
    ),
    ["A"],
  );
  assert.deepEqual(
    itensSemCorrespondencia(pedido, []).map((i) => i.codigo),
    ["A", "B"],
  );
  assert.equal(
    itensSemCorrespondencia(pedido, [{ codigo_externo: "A" }, { codigo_externo: "B" }]).length,
    0,
  );
  assert.equal(totalItensPedido(pedido), 2 * 36.5 + 19);
});

test("vários cardápios: horário, sugestão, preço e ordem", () => {
  const base = {
    ativo: true,
    uso_salao: true,
    uso_delivery: true,
    uso_online: true,
    uso_ifood: false,
  };
  const almoco = {
    ...base,
    id: "a",
    nome: "Almoço",
    ordem: 1,
    padrao: false,
    hora_inicio: "11:00:00",
    hora_fim: "15:00:00",
  };
  const jantar = {
    ...base,
    id: "j",
    nome: "Jantar",
    ordem: 2,
    padrao: false,
    hora_inicio: "18:00",
    hora_fim: "02:00",
  };
  const principal = {
    ...base,
    id: "p",
    nome: "Principal",
    ordem: 0,
    padrao: true,
    hora_inicio: null,
    hora_fim: null,
  };
  const hora = (h: number, m = 0) => new Date(2026, 10, 1, h, m);
  assert.equal(dentroDoHorario(almoco, hora(11, 0)), true);
  assert.equal(dentroDoHorario(almoco, hora(15, 0)), false);
  assert.equal(dentroDoHorario(jantar, hora(23, 30)), true);
  assert.equal(dentroDoHorario(jantar, hora(1, 0)), true);
  assert.equal(dentroDoHorario(jantar, hora(2, 0)), false);
  assert.equal(dentroDoHorario(principal, hora(12)), false);
  const todos = [jantar, principal, almoco];
  assert.equal(cardapioSugerido(todos, hora(12))?.id, "a");
  assert.equal(cardapioSugerido(todos, hora(20))?.id, "j");
  assert.equal(cardapioSugerido(todos, hora(16))?.id, "p");
  assert.equal(cardapioSugerido([almoco, jantar], hora(16))?.id, "a");
  assert.equal(cardapioSugerido([], hora(16)), null);

  const itens = [
    { id: "x", nome: "Xis", ordem: 5, preco: 20 },
    { id: "y", nome: "Yakisoba", ordem: 1, preco: 30 },
    { id: "z", nome: "Zebu", ordem: 2, preco: 40 },
  ];
  const vinculos = [
    { cardapio_id: "j", item_id: "x", preco: 25, ordem: 0 },
    { cardapio_id: "j", item_id: "y", preco: null, ordem: null },
    { cardapio_id: "p", item_id: "z", preco: null, ordem: null },
  ];
  assert.deepEqual(
    itensDoCardapio(itens, vinculos, "j").map((i) => i.id),
    ["x", "y"],
  );
  assert.deepEqual(
    itensDoCardapio(itens, vinculos, "p").map((i) => i.id),
    ["z"],
  );
  assert.equal(precoNoCardapio(itens[0]!, vinculos, "j"), 25);
  assert.equal(precoNoCardapio(itens[1]!, vinculos, "j"), 30);
  assert.equal(precoNoCardapio(itens[0]!, vinculos, null), 20);
});
