import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cnaesDaEmpresa,
  moduloLiberadoEmpresa,
  moduloLiberadoPorCnae,
} from "../src/lib/cnae-regras.ts";
import {
  diaDaSemana,
  diasEntre,
  erroDocumento,
  escolherTarifa,
  normalizarDocumento,
  type Tarifa,
} from "../src/lib/hotelaria.ts";

const libera = (cnae: string) => moduloLiberadoPorCnae(cnaesDaEmpresa({ cnae }), "hotelaria");

test("CNAE: hotéis e outros alojamentos liberam; restaurante, lava-rápido e comércio não", () => {
  assert.equal(libera("5510-8/01"), true);
  assert.equal(libera("55.10-8/03"), true);
  assert.equal(libera("5590-6/01"), true);
  assert.equal(libera("5611-2/01"), false);
  assert.equal(libera("4520-0/06"), false);
  assert.equal(libera("4711-3/02"), false);
  assert.equal(libera("5500-0/00"), false);
});

test("módulo: ramo, liberação explícita e escolha sem CNPJ liberam; com CNPJ a escolha manual não vale", () => {
  const comCnpj = { cnpj: "11.222.333/0001-81" };
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, ramo_atividade: "hotelaria" }, "hotelaria"),
    true,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, modulos_liberados: ["hotelaria"] }, "hotelaria"),
    true,
  );
  assert.equal(moduloLiberadoEmpresa({ ...comCnpj, cnae: "5510-8/01" }, "hotelaria"), true);
  assert.equal(
    moduloLiberadoEmpresa({ cnpj: "", modulos_sem_cnpj: ["hotelaria"] }, "hotelaria"),
    true,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, modulos_sem_cnpj: ["hotelaria"] }, "hotelaria"),
    false,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, ramo_atividade: "restaurante" }, "hotelaria"),
    false,
  );
  assert.equal(
    moduloLiberadoEmpresa({ ...comCnpj, ramo_atividade: "hotelaria" }, "restaurante"),
    false,
  );
});

test("documento: CPF conferido pelos dígitos, passaporte normalizado, vazio é aceito", () => {
  assert.equal(normalizarDocumento("cpf", "529.982.247-25"), "52998224725");
  assert.equal(normalizarDocumento("passaporte", "ab-123 456"), "AB123456");
  assert.equal(erroDocumento("cpf", "529.982.247-25"), null);
  assert.notEqual(erroDocumento("cpf", "12345678900"), null);
  assert.notEqual(erroDocumento("cpf", "111.111.111-11"), null);
  assert.equal(erroDocumento("passaporte", "AB 123456"), null);
  assert.notEqual(erroDocumento("rg", "12"), null);
  assert.equal(erroDocumento(null, ""), null);
  assert.notEqual(erroDocumento("rg", ""), null);
  assert.notEqual(erroDocumento(null, "123456"), null);
});

test("datas: dia da semana e diferença em dias não dependem do fuso", () => {
  assert.equal(diaDaSemana("2027-01-01"), 5);
  assert.equal(diaDaSemana("2027-07-14"), 3);
  assert.equal(diaDaSemana("2027-07-17"), 6);
  assert.equal(diasEntre("2027-07-01", "2027-07-31"), 30);
  assert.equal(diasEntre("2027-03-13", "2027-03-15"), 2);
});

// As mesmas tarifas e noites da seção 89 do smoke do banco.
const A: Tarifa = {
  id: "a",
  vigencia_de: "2027-01-01",
  vigencia_ate: "2027-12-31",
  dias_semana: [],
  prioridade: 0,
  ativo: true,
};
const B: Tarifa = { ...A, id: "b", dias_semana: [5, 6], prioridade: 1 };
const C: Tarifa = { ...A, id: "c", vigencia_de: "2027-12-30", prioridade: 5 };
const D: Tarifa = { ...A, id: "d", vigencia_de: "2027-07-01", vigencia_ate: "2027-07-31" };
const todas = [A, B, C, D];

test("tarifa da noite: prioridade, dia da semana e vigência menor no empate", () => {
  assert.equal(escolherTarifa(todas, "2027-01-04")?.id, "a");
  assert.equal(escolherTarifa(todas, "2027-01-01")?.id, "b");
  assert.equal(escolherTarifa(todas, "2027-01-02")?.id, "b");
  assert.equal(escolherTarifa(todas, "2027-07-14")?.id, "d");
  assert.equal(escolherTarifa(todas, "2027-07-17")?.id, "b");
  assert.equal(escolherTarifa(todas, "2027-12-31")?.id, "c");
});

test("tarifa da noite: fora da vigência não há tarifa e tarifa inativa não vale", () => {
  assert.equal(escolherTarifa(todas, "2026-12-31"), null);
  assert.equal(escolherTarifa(todas, "2028-01-01"), null);
  assert.equal(escolherTarifa([A, B, C, { ...D, ativo: false }], "2027-07-14")?.id, "a");
  assert.equal(escolherTarifa([], "2027-07-14"), null);
});

test("tarifa da noite: empate total é decidido sempre do mesmo jeito, qualquer que seja a ordem", () => {
  const x: Tarifa = { ...A, id: "x" };
  const y: Tarifa = { ...A, id: "y" };
  assert.equal(escolherTarifa([y, x], "2027-02-02")?.id, "x");
  assert.equal(escolherTarifa([x, y], "2027-02-02")?.id, "x");
  // começou mais tarde (mesma duração) vence
  const mais_tarde: Tarifa = {
    ...A,
    id: "z",
    vigencia_de: "2027-02-01",
    vigencia_ate: "2027-12-31",
  };
  const antes: Tarifa = { ...A, id: "w", vigencia_de: "2027-01-01", vigencia_ate: "2027-12-01" };
  assert.equal(diasEntre(mais_tarde.vigencia_de, mais_tarde.vigencia_ate), 333);
  assert.equal(diasEntre(antes.vigencia_de, antes.vigencia_ate), 334);
  assert.equal(escolherTarifa([antes, mais_tarde], "2027-03-03")?.id, "z");
});

// Mesmas tarifas e contas da seção 90 do smoke do banco.
import {
  cotarEstadia,
  noitesDaEstadia,
  precoDaNoite,
  ratearValor,
  type TarifaPreco,
} from "../src/lib/hotelaria.ts";

const marco: TarifaPreco = {
  id: "marco",
  vigencia_de: "2027-03-01",
  vigencia_ate: "2027-03-31",
  dias_semana: [],
  prioridade: 0,
  ativo: true,
  valor_diaria: 100,
  valor_adulto_extra: 40,
  valor_crianca: 20,
  minimo_noites: 1,
  pessoas_incluidas: 2,
};
const abril: TarifaPreco = {
  ...marco,
  id: "abril",
  vigencia_de: "2027-04-01",
  vigencia_ate: "2027-04-30",
  valor_diaria: 90,
  valor_adulto_extra: 0,
  valor_crianca: 0,
  minimo_noites: 3,
};

test("preço da noite: adulto além do incluído e criança pagam extra", () => {
  assert.equal(precoDaNoite(marco, 2, 0), 100);
  assert.equal(precoDaNoite(marco, 1, 0), 100);
  assert.equal(precoDaNoite(marco, 3, 0), 140);
  assert.equal(precoDaNoite(marco, 3, 1), 160);
  assert.equal(precoDaNoite({ ...marco, pessoas_incluidas: 1 }, 2, 0), 140);
  assert.equal(precoDaNoite({ ...marco, valor_diaria: 0.1, valor_crianca: 0.2 }, 2, 1), 0.3);
});

test("cotação: noite a noite, total e mínimo de noites da chegada", () => {
  const t = [marco, abril];
  assert.equal(cotarEstadia(t, "2027-03-01", "2027-03-04", 2, 0).total, 300);
  assert.equal(cotarEstadia(t, "2027-03-01", "2027-03-04", 3, 1).total, 480);
  assert.equal(cotarEstadia(t, "2027-04-01", "2027-04-04", 2, 0).total, 270);
  assert.deepEqual(noitesDaEstadia("2027-02-27", "2027-03-02"), [
    "2027-02-27",
    "2027-02-28",
    "2027-03-01",
  ]);
  assert.throws(() => cotarEstadia(t, "2027-04-01", "2027-04-03", 2, 0), /mínimo de 3|no mínimo 3/);
  assert.throws(
    () => cotarEstadia(t, "2027-02-27", "2027-03-02", 2, 0),
    /Sem tarifa para a noite de 27\/02\/2027/,
  );
  assert.throws(
    () => cotarEstadia(t, "2027-03-03", "2027-03-03", 2, 0),
    /saída precisa ser depois/,
  );
  assert.throws(() => cotarEstadia(t, "2027-03-01", "2028-03-05", 2, 0), /365/);
  // mínimo é o da noite de chegada: começar em março e entrar em abril não herda as 3 noites de abril
  assert.equal(cotarEstadia(t, "2027-03-31", "2027-04-02", 2, 0).total, 190);
});

test("valor acordado: rateio em centavos com a sobra na última noite", () => {
  assert.deepEqual(ratearValor(250, 3), [83.33, 83.33, 83.34]);
  assert.deepEqual(ratearValor(100, 3), [33.33, 33.33, 33.34]);
  assert.deepEqual(ratearValor(100, 4), [25, 25, 25, 25]);
  assert.deepEqual(ratearValor(0, 2), [0, 0]);
  assert.equal(
    ratearValor(250, 3).reduce((s, v) => s + Math.round(v * 100), 0),
    25000,
  );
  assert.throws(() => ratearValor(100, 0));
});

import { destinoDoCredito, estornoDe, saldoDoFolio, taxaDeTurismo } from "../src/lib/hotelaria.ts";

// Mesmos passos da conta do quarto 101 na seção 91 do smoke do banco.
test("saldo da conta: sinal, consumo, desconto, estorno, pagamento e devolução", () => {
  const diaria = { total: 100 };
  const taxa = { total: 10 };
  const sinal = { tipo: "sinal" as const, valor: 100 };
  assert.equal(saldoDoFolio([], [sinal]), -100);
  assert.equal(saldoDoFolio([diaria, taxa], [sinal]), 10);
  const consumo = { total: 15 };
  assert.equal(saldoDoFolio([diaria, taxa, consumo], [sinal]), 25);
  const desconto = { total: -10 };
  assert.equal(saldoDoFolio([diaria, taxa, consumo, desconto], [sinal]), 15);
  const estornoConsumo = { total: -15 };
  assert.equal(saldoDoFolio([diaria, taxa, consumo, desconto, estornoConsumo], [sinal]), 0);
  const estornoTaxa = { total: -10 };
  const lanc = [diaria, taxa, consumo, desconto, estornoConsumo, estornoTaxa];
  assert.equal(saldoDoFolio(lanc, [sinal]), -10);
  const lavanderia = { total: 60 };
  assert.equal(saldoDoFolio([...lanc, lavanderia], [sinal]), 50);
  const pago = { tipo: "pagamento" as const, valor: 50 };
  assert.equal(saldoDoFolio([...lanc, lavanderia], [sinal, pago]), 0);
  const devolucao = { tipo: "devolucao" as const, valor: 20 };
  assert.equal(saldoDoFolio([...lanc, lavanderia], [sinal, pago, devolucao]), 20);
});

test("saldo da conta: centavos não acumulam erro de ponto flutuante", () => {
  assert.equal(saldoDoFolio([{ total: 0.1 }, { total: 0.2 }], []), 0.3);
  assert.equal(
    saldoDoFolio(
      [{ total: 0.3 }],
      [
        { tipo: "pagamento", valor: 0.1 },
        { tipo: "pagamento", valor: 0.2 },
      ],
    ),
    0,
  );
});

test("taxa de turismo e estorno", () => {
  assert.equal(taxaDeTurismo(2, 5), 10);
  assert.equal(taxaDeTurismo(3, 3.33), 9.99);
  assert.equal(taxaDeTurismo(0, 5), 0);
  assert.deepEqual(estornoDe({ valor_unitario: 7.5, total: 15 }), {
    valor_unitario: -7.5,
    total: -15,
  });
  assert.deepEqual(estornoDe({ valor_unitario: -10, total: -10 }), {
    valor_unitario: 10,
    total: 10,
  });
  assert.deepEqual(estornoDe({ valor_unitario: 0, total: 0 }), { valor_unitario: 0, total: 0 });
});

test("encerrar sem estadia: crédito pede devolução ou retenção; débito fica a receber", () => {
  assert.equal(destinoDoCredito(-70), "devolver_ou_reter");
  assert.equal(destinoDoCredito(0), "quitada");
  assert.equal(destinoDoCredito(30), "a_receber");
});

import { ratearDesconto, saidaDoCheckout, somarDias } from "../src/lib/hotelaria.ts";

// Mesmos cenários da seção 92 do smoke do banco (com hoje = 2027-06-10).
const hoje = "2027-06-10";
test("saída do check-out: antecipada, no dia previsto, no mesmo dia e chegada atrasada", () => {
  assert.equal(somarDias("2027-02-28", 1), "2027-03-01");
  // ia até amanhã, entrou há 2 dias e as 2 noites já foram lançadas: sai hoje
  assert.equal(
    saidaDoCheckout({
      hoje,
      entrada: "2027-06-08",
      saida: "2027-06-11",
      diaDoCheckin: "2027-06-08",
      ultimaNoiteLancada: "2027-06-09",
    }),
    "2027-06-10",
  );
  // entrou e saiu hoje: cobra ao menos uma noite
  assert.equal(
    saidaDoCheckout({ hoje, entrada: hoje, saida: "2027-06-12", diaDoCheckin: hoje }),
    "2027-06-11",
  );
  // chegada atrasada: a noite anterior ao check-in não conta
  assert.equal(
    saidaDoCheckout({
      hoje,
      entrada: "2027-06-09",
      saida: "2027-06-11",
      diaDoCheckin: hoje,
      ultimaNoiteLancada: hoje,
    }),
    "2027-06-11",
  );
  // nunca passa da saída prevista (estadia vencida)
  assert.equal(
    saidaDoCheckout({
      hoje: "2027-06-20",
      entrada: "2027-06-08",
      saida: "2027-06-11",
      diaDoCheckin: "2027-06-08",
    }),
    "2027-06-11",
  );
  // noite de hoje já lançada pelo fechamento do dia: continua cobrada
  assert.equal(
    saidaDoCheckout({
      hoje,
      entrada: "2027-06-09",
      saida: "2027-06-13",
      diaDoCheckin: "2027-06-09",
      ultimaNoiteLancada: hoje,
    }),
    "2027-06-11",
  );
});

test("desconto da nota: rateado em centavos e o último item absorve a diferença", () => {
  assert.deepEqual(ratearDesconto([200], 20), [180]);
  assert.deepEqual(ratearDesconto([30, 30, 40], 10), [27, 27, 36]);
  assert.deepEqual(ratearDesconto([100, 100, 100], 10), [96.67, 96.67, 96.66]);
  assert.equal(
    ratearDesconto([33.33, 33.33, 33.34], 0).reduce((s, v) => s + Math.round(v * 100), 0),
    10000,
  );
  assert.deepEqual(ratearDesconto([50, 50], 500), [0, 0]);
  assert.deepEqual(ratearDesconto([], 5), []);
  assert.equal(
    ratearDesconto([10, 20, 30], 7).reduce((s, v) => s + Math.round(v * 100), 0),
    5300,
  );
});

import { celulasDaAcomodacao, percentualOcupacao } from "../src/lib/hotelaria.ts";

test("ocupação em percentual com uma casa (mesmos números da seção 93)", () => {
  assert.equal(percentualOcupacao(4, 7), 57.1);
  assert.equal(percentualOcupacao(3, 7), 42.9);
  assert.equal(percentualOcupacao(2, 7), 28.6);
  assert.equal(percentualOcupacao(0, 7), 0);
  assert.equal(percentualOcupacao(3, 0), 0);
  assert.equal(percentualOcupacao(7, 7), 100);
});

test("mapa: uma célula por dia, com início da barra e continuação de reserva que veio de antes", () => {
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10", "2027-06-11", "2027-06-12"];
  const a = { id: "a", de: "2027-06-07", ate: "2027-06-10" };
  const b = { id: "b", de: "2027-06-10", ate: "2027-06-11" };
  const c = celulasDaAcomodacao(dias, [a, b]);
  assert.deepEqual(
    c.map((x) => x.ocupacao?.id ?? null),
    ["a", "a", "b", null, null],
  );
  assert.equal(c[0]!.continua, true);
  assert.equal(c[0]!.inicio, true);
  assert.equal(c[1]!.inicio, false);
  assert.equal(c[2]!.inicio, true);
  assert.equal(c[3]!.inicio, false);
  assert.equal(c[2]!.continua, false);
  assert.deepEqual(
    celulasDaAcomodacao(dias, []).map((x) => x.ocupacao),
    [null, null, null, null, null],
  );
});

import { htmlFichaHospedagem } from "../src/lib/ficha-hospedagem.ts";
import {
  textoNoites,
  textoPessoas,
  tomDaSituacao,
  rotuloSituacaoReserva,
} from "../src/lib/hotelaria.ts";

test("ficha de hospedagem: dados do quarto, hóspedes e escape de HTML", () => {
  const html = htmlFichaHospedagem({
    hotel: "Hotel <Mar> & Sol",
    empresa: "Mar e Sol Ltda",
    ficha: {
      reserva_numero: 12,
      uh: "101",
      entrada: "2027-03-01",
      saida: "2027-03-04",
      adultos: 2,
      criancas: 1,
      hospedes: [
        {
          hospede_id: "a",
          principal: true,
          nome: "Maria <b>Silva</b>",
          documento_tipo: "cpf",
          documento_numero: "52998224725",
          nacionalidade: "Brasileira",
          data_nascimento: "1990-05-20",
          sexo: "F",
          profissao: null,
          telefone: null,
          email: null,
          cidade_residencia: "Recife",
          estado_residencia: "PE",
          pais_residencia: "Brasil",
          procedencia: null,
          destino: null,
          motivo_viagem: "lazer",
          meio_transporte: "automovel",
        },
        {
          hospede_id: "b",
          principal: false,
          nome: "João",
          documento_tipo: null,
          documento_numero: null,
          nacionalidade: "Brasileira",
          data_nascimento: null,
          sexo: null,
          profissao: null,
          telefone: null,
          email: null,
          cidade_residencia: null,
          estado_residencia: null,
          pais_residencia: "Brasil",
          procedencia: null,
          destino: null,
          motivo_viagem: null,
          meio_transporte: null,
        },
      ],
    },
  });
  assert.match(html, /Ficha de hospedagem 12/);
  assert.match(html, /Hotel &lt;Mar&gt; &amp; Sol — Mar e Sol Ltda/);
  assert.match(html, /Maria &lt;b&gt;Silva&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Silva<\/b>/);
  assert.match(html, /01\/03\/2027/);
  assert.match(html, /04\/03\/2027/);
  assert.match(html, /CPF 52998224725/);
  assert.match(html, /Hóspede principal/);
  assert.match(html, /Acompanhante 1/);
  assert.match(html, /20\/05\/1990/);
  assert.match(html, /Feminino/);
  assert.match(html, /Lazer/);
  assert.match(html, /Recife \/ PE \/ Brasil/);
  assert.match(html, /2 adulto\(s\) e 1 criança\(s\)/);
  assert.equal((html.match(/class="assinatura"/g) ?? []).length, 2);
});

test("rótulos e textos curtos das telas", () => {
  assert.equal(rotuloSituacaoReserva("no_show"), "Não compareceu");
  assert.equal(rotuloSituacaoReserva("xyz"), "—");
  assert.equal(tomDaSituacao("hospedada"), "default");
  assert.equal(tomDaSituacao("cancelada"), "destructive");
  assert.equal(tomDaSituacao("confirmada"), "outline");
  assert.equal(textoPessoas(1, 0), "1 adulto");
  assert.equal(textoPessoas(2, 1), "2 adultos + 1 criança");
  assert.equal(textoPessoas(3, 2), "3 adultos + 2 crianças");
  assert.equal(textoNoites(1), "1 noite");
  assert.equal(textoNoites(3), "3 noites");
});

import { cabecalhoDoDia, segmentosDaLinha } from "../src/lib/hotelaria.ts";

test("mapa: uma barra por reserva e blocos de dias livres", () => {
  const dias = ["2027-06-08", "2027-06-09", "2027-06-10", "2027-06-11", "2027-06-12", "2027-06-13"];
  const a = { id: "a", de: "2027-06-07", ate: "2027-06-10" };
  const b = { id: "b", de: "2027-06-10", ate: "2027-06-11" };
  const seg = segmentosDaLinha(celulasDaAcomodacao(dias, [a, b]));
  assert.deepEqual(
    seg.map((s) => [s.inicio, s.dias, s.ocupacao?.id ?? null]),
    [
      [0, 2, "a"],
      [2, 1, "b"],
      [3, 3, null],
    ],
  );
  assert.deepEqual(
    segmentosDaLinha(celulasDaAcomodacao(dias, [])).map((s) => [s.inicio, s.dias]),
    [[0, 6]],
  );
  assert.deepEqual(segmentosDaLinha([]), []);
  // duas reservas coladas não viram uma barra só
  const c = { id: "c", de: "2027-06-08", ate: "2027-06-09" };
  const d = { id: "d", de: "2027-06-09", ate: "2027-06-10" };
  assert.equal(segmentosDaLinha(celulasDaAcomodacao(dias.slice(0, 2), [c, d])).length, 2);
});

test("cabeçalho do dia no mapa", () => {
  assert.deepEqual(cabecalhoDoDia("2027-01-01"), { semana: "sex", dia: "01", fimDeSemana: false });
  assert.deepEqual(cabecalhoDoDia("2027-01-02"), { semana: "sáb", dia: "02", fimDeSemana: true });
  assert.deepEqual(cabecalhoDoDia("2027-01-03"), { semana: "dom", dia: "03", fimDeSemana: true });
});

import { horaCurta, lerPeriodo } from "../src/lib/hotelaria.ts";

test("período do bloqueio e hora curta", () => {
  assert.deepEqual(lerPeriodo("[2027-05-01,2027-05-04)"), { de: "2027-05-01", ate: "2027-05-04" });
  assert.equal(lerPeriodo("vazio"), null);
  assert.equal(lerPeriodo(null), null);
  assert.equal(horaCurta("14:00:00"), "14:00");
  assert.equal(horaCurta(null), "");
});
