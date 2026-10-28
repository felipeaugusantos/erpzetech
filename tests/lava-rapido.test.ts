import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cnaesDaEmpresa,
  moduloLiberadoEmpresa,
  moduloLiberadoPorCnae,
} from "../src/lib/cnae-regras.ts";
import {
  dimensoesReduzidas,
  erroDaFoto,
  mimeDaFoto,
  nomeDaFotoReduzida,
  textoFotos,
} from "../src/lib/lava-fotos.ts";
import {
  TIPOS_VEICULO,
  comissaoDoLavador,
  diasParaVencer,
  estadoDoChecklist,
  locaisDeAvaria,
  rotuloAvaria,
  textoChecklist,
  MENSAGEM_LAVA_PADRAO,
  lavagensRestantes,
  montarMensagemLava,
  situacaoDaAssinatura,
  textoFidelidade,
  totalCobrado,
  formatarIdentificacao,
  formatarQuantidade,
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

test("itens cobertos por plano ou brinde não entram no total cobrado", () => {
  const itens = [
    { preco_aplicado: 40, cobertura: "assinatura" },
    { preco_aplicado: 30, cobertura: null },
    { preco_aplicado: 25, cobertura: "fidelidade" },
  ];
  assert.equal(totalCobrado(itens), 30);
  assert.equal(totalCobrado([]), 0);
});

test("plano: saldo, vencimento e situação", () => {
  assert.equal(lavagensRestantes(4, 1), 3);
  assert.equal(lavagensRestantes(4, 9), 0);
  assert.equal(diasParaVencer("2026-11-10", "2026-11-03"), 7);
  assert.equal(diasParaVencer("2026-11-03", "2026-11-03"), 0);
  assert.equal(diasParaVencer("2026-11-02", "2026-11-03"), -1);
  const base = {
    situacao: "ativa",
    vence_em: "2026-11-10",
    lavagens: 4,
    usadas: 1,
    hoje: "2026-11-03",
  };
  assert.equal(situacaoDaAssinatura(base), "ativa");
  assert.equal(situacaoDaAssinatura({ ...base, usadas: 4 }), "esgotada");
  assert.equal(situacaoDaAssinatura({ ...base, vence_em: "2026-11-02" }), "vencida");
  assert.equal(situacaoDaAssinatura({ ...base, vence_em: "2026-11-03" }), "ativa");
  assert.equal(situacaoDaAssinatura({ ...base, situacao: "cancelada", usadas: 4 }), "cancelada");
});

test("texto do programa de fidelidade", () => {
  const f = { ativo: true, selos: 7, necessarias: 10, disponiveis: 0, faltam: 3 };
  assert.equal(textoFidelidade(f), "Faltam 3 lavagens para o próximo brinde.");
  assert.equal(textoFidelidade({ ...f, faltam: 1 }), "Falta 1 lavagem para o próximo brinde.");
  assert.equal(textoFidelidade({ ...f, disponiveis: 1 }), "Tem 1 brinde disponível.");
  assert.equal(textoFidelidade({ ...f, disponiveis: 2 }), "Tem 2 brindes disponíveis.");
  assert.equal(textoFidelidade({ ...f, ativo: false }), "Programa de fidelidade desligado.");
});

test("mensagens do lava rápido trocam os campos e deixam intacto o que não tem valor", () => {
  const texto = montarMensagemLava(MENSAGEM_LAVA_PADRAO.pronto, {
    cliente: "Maria da Silva",
    veiculo: "ABC-1234",
    loja: "Lava Bem",
  });
  assert.match(texto, /^Oi, Maria! Aqui é da Lava Bem\. O seu ABC-1234 já está pronto/);
  const plano = montarMensagemLava(MENSAGEM_LAVA_PADRAO.plano_vencendo, {
    cliente: "João",
    veiculo: "PT-ABC",
    loja: "Hangar Wash",
    plano: "Mensal 4",
    data: "10/11/2026",
    restam: 2,
  });
  assert.match(plano, /plano Mensal 4 do PT-ABC vence em 10\/11\/2026 e ainda restam 2 lavagens/);
  assert.equal(
    montarMensagemLava("Faz {dias} dias, {cliente}", { cliente: "Ana" }),
    "Faz {dias} dias, Ana",
  );
  assert.equal(montarMensagemLava("Faz {dias} dias", { dias: 40 }), "Faz 40 dias");
});

test("quantidade de insumo sem zeros sobrando", () => {
  assert.equal(formatarQuantidade(0.05), "0,05");
  assert.equal(formatarQuantidade(1), "1");
  assert.equal(formatarQuantidade(2.5), "2,5");
  assert.equal(formatarQuantidade(0.1234), "0,123");
  assert.equal(formatarQuantidade(1000), "1.000");
});

test("checklist de avarias: estado, texto e locais por tipo de veículo", () => {
  assert.equal(estadoDoChecklist({ checklist_em: null, checklist_sem_avarias: null }), "pendente");
  assert.equal(
    estadoDoChecklist({ checklist_em: "2026-11-01T10:00:00Z", checklist_sem_avarias: true }),
    "sem_avarias",
  );
  assert.equal(
    estadoDoChecklist({ checklist_em: "2026-11-01T10:00:00Z", checklist_sem_avarias: false }),
    "com_avarias",
  );
  assert.equal(textoChecklist("pendente", 0), "Checklist pendente");
  assert.equal(textoChecklist("pendente", 2), "Checklist aberto (2)");
  assert.equal(textoChecklist("sem_avarias", 0), "Sem avarias");
  assert.equal(textoChecklist("com_avarias", 1), "1 avaria registrada");
  assert.equal(textoChecklist("com_avarias", 3), "3 avarias registradas");
  assert.ok(locaisDeAvaria("carro").includes("Capô"));
  assert.ok(locaisDeAvaria("caminhonete").includes("Caçamba"));
  assert.ok(locaisDeAvaria("moto").includes("Tanque"));
  assert.ok(locaisDeAvaria("aviao").includes("Hélice ou motor"));
  assert.ok(locaisDeAvaria("helicoptero").includes("Rotor de cauda"));
  assert.ok(!locaisDeAvaria("carro").includes("Rotor de cauda"));
  assert.equal(rotuloAvaria("falta_peca"), "Peça faltando");
  assert.equal(rotuloAvaria("desconhecido"), "Outro");
});

test("fotos: formato, tamanho reduzido e nome", () => {
  assert.equal(mimeDaFoto({ name: "a.JPG", type: "" }), "image/jpeg");
  assert.equal(mimeDaFoto({ name: "a.webp", type: "image/webp" }), "image/webp");
  assert.equal(mimeDaFoto({ name: "a.pdf", type: "application/pdf" }), null);
  assert.equal(mimeDaFoto({ name: "a.heic", type: "image/heic" }), null);
  assert.equal(erroDaFoto({ name: "a.jpg", size: 0, type: "image/jpeg" }), "O arquivo está vazio");
  assert.match(
    erroDaFoto({ name: "a.pdf", size: 10, type: "application/pdf" }) ?? "",
    /Formato não aceito/,
  );
  assert.equal(erroDaFoto({ name: "a.jpg", size: 10, type: "image/jpeg" }), null);
  assert.deepEqual(dimensoesReduzidas(4000, 3000), { largura: 1600, altura: 1200 });
  assert.deepEqual(dimensoesReduzidas(3000, 4000), { largura: 1200, altura: 1600 });
  assert.deepEqual(dimensoesReduzidas(800, 600), { largura: 800, altura: 600 });
  assert.equal(nomeDaFotoReduzida("IMG_0001.HEIC"), "IMG_0001.jpg");
  assert.equal(nomeDaFotoReduzida(".jpg"), "foto.jpg");
  assert.ok(nomeDaFotoReduzida("x".repeat(300) + ".png").length <= 120);
});

test("texto das fotos no cartão do pátio", () => {
  assert.equal(textoFotos(0, 0), "Sem fotos");
  assert.equal(textoFotos(2, 0), "2 antes");
  assert.equal(textoFotos(0, 1), "1 depois");
  assert.equal(textoFotos(3, 2), "3 antes · 2 depois");
});

import { dadosDoPlano, formDoPlano, planoVazio } from "../src/lib/lava-planos-form.ts";

test("formulário do plano: confere os limites e devolve os dados para o banco", () => {
  const ok = { ...planoVazio, nome: "  Mensal  ", servico_id: "s1", preco: "120,50" };
  assert.deepEqual(dadosDoPlano(ok), {
    nome: "Mensal",
    servico_id: "s1",
    lavagens: 4,
    validade_dias: 30,
    tipo: "",
    preco: 120.5,
    ativo: true,
  });
  assert.throws(() => dadosDoPlano({ ...ok, nome: " " }), /nome/);
  assert.throws(() => dadosDoPlano({ ...ok, servico_id: "" }), /serviço/);
  assert.throws(() => dadosDoPlano({ ...ok, lavagens: "1" }), /2 a 60/);
  assert.throws(() => dadosDoPlano({ ...ok, lavagens: "61" }), /2 a 60/);
  assert.throws(() => dadosDoPlano({ ...ok, validade_dias: "6" }), /7 e 366/);
  assert.throws(() => dadosDoPlano({ ...ok, preco: "0" }), /preço/);
  assert.throws(() => dadosDoPlano({ ...ok, preco: "abc" }), /preço/);
});

test("formulário do plano: editar carrega o plano e mantém o id", () => {
  const f = formDoPlano({
    id: "p1",
    nome: "Quinzenal",
    servico_id: "s1",
    lavagens: 2,
    validade_dias: 15,
    tipo: "moto",
    preco: 60,
    ativo: false,
  });
  assert.equal(f.id, "p1");
  assert.equal(f.tipo, "moto");
  assert.equal(dadosDoPlano(f).id, "p1");
  assert.equal(dadosDoPlano(f).ativo, false);
});
