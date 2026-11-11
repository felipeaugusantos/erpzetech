import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REGRA_PADRAO,
  boxesDosAgendamentos,
  deCampoLocal,
  erroDeRecurso,
  faixasDoDia,
  fimSugerido,
  horaBrasilia,
  instanteBrasilia,
  intervalosSeCruzam,
  ocupaHorario,
  paraCampoLocal,
  podeRegistrarChegada,
  podeRemarcar,
  precoPrevisto,
  proximasSituacoes,
  servicosSemPreco,
  somaDuracoes,
  temConflito,
  totalPrevisto,
  type AgendamentoDaGrade,
} from "../src/lib/lava-agenda.ts";

const h = (hora: string) => instanteBrasilia("2030-03-15", hora);
const ag = (
  id: string,
  ini: string,
  fim: string,
  extra: Partial<AgendamentoDaGrade> = {},
): AgendamentoDaGrade => ({
  id,
  inicio: h(ini),
  fim: h(fim),
  situacao: "agendado",
  lavador_id: "l1",
  box: "Box 1",
  ...extra,
});

test("agenda: fim sugerido é o início mais a soma das durações cadastradas", () => {
  assert.equal(somaDuracoes([30, 45]), 75);
  assert.equal(fimSugerido(h("09:00"), [30, 45]).getTime(), h("10:15").getTime());
  assert.equal(fimSugerido(h("09:00"), []).getTime(), h("09:00").getTime());
});

test("agenda: intervalo aberto no fim (terminar às 10h e começar às 10h não cruza)", () => {
  assert.equal(intervalosSeCruzam(h("09:00"), h("10:00"), h("10:00"), h("11:00")), false);
  assert.equal(intervalosSeCruzam(h("10:00"), h("11:00"), h("09:00"), h("10:00")), false);
  assert.equal(intervalosSeCruzam(h("09:00"), h("10:01"), h("10:00"), h("11:00")), true);
  assert.equal(intervalosSeCruzam(h("09:00"), h("12:00"), h("10:00"), h("11:00")), true);
});

test("agenda: conflito por lavador e por box, igual ao banco", () => {
  const existentes = [ag("a", "09:00", "10:00")];
  const novo = (over: object) => ({
    inicio: h("09:30"),
    fim: h("10:30"),
    lavadorId: null,
    box: null,
    ...over,
  });
  assert.equal(temConflito(existentes, novo({ lavadorId: "l1" }), REGRA_PADRAO), "lavador");
  assert.equal(
    temConflito(existentes, novo({ lavadorId: "l2", box: "  BOX 1 " }), REGRA_PADRAO),
    "box",
  );
  assert.equal(
    temConflito(existentes, novo({ lavadorId: "l2", box: "Box 2" }), REGRA_PADRAO),
    null,
  );
  assert.equal(temConflito(existentes, novo({}), REGRA_PADRAO), null); // sem lavador e sem box não conflita (a regra de exigir recurso barra antes)
  assert.equal(
    temConflito(
      existentes,
      novo({ inicio: h("10:00"), fim: h("11:00"), lavadorId: "l1" }),
      REGRA_PADRAO,
    ),
    null,
  );
});

test("agenda: cancelado e falta liberam, remarcar ignora o próprio agendamento", () => {
  const novo = { inicio: h("09:30"), fim: h("10:30"), lavadorId: "l1", box: null };
  assert.equal(
    temConflito([ag("a", "09:00", "10:00", { situacao: "cancelado" })], novo, REGRA_PADRAO),
    null,
  );
  assert.equal(
    temConflito([ag("a", "09:00", "10:00", { situacao: "faltou" })], novo, REGRA_PADRAO),
    null,
  );
  assert.equal(
    temConflito([ag("a", "09:00", "10:00", { situacao: "concluido" })], novo, REGRA_PADRAO),
    "lavador",
  );
  assert.equal(temConflito([ag("a", "09:00", "10:00")], novo, REGRA_PADRAO, "a"), null);
});

test("agenda: a regra da empresa liga e desliga cada conflito", () => {
  const existentes = [ag("a", "09:00", "10:00")];
  const novo = { inicio: h("09:30"), fim: h("10:30"), lavadorId: "l1", box: "Box 1" };
  assert.equal(temConflito(existentes, novo, { ...REGRA_PADRAO, conflitoLavador: false }), "box");
  assert.equal(
    temConflito(existentes, novo, { ...REGRA_PADRAO, conflitoLavador: false, conflitoBox: false }),
    null,
  );
});

test("agenda: sem lavador e sem box só passa se a empresa não exige recurso", () => {
  assert.equal(
    erroDeRecurso(null, "  ", REGRA_PADRAO),
    "Informe o lavador ou o box do agendamento",
  );
  assert.equal(erroDeRecurso("l1", null, REGRA_PADRAO), null);
  assert.equal(erroDeRecurso(null, "Box 2", REGRA_PADRAO), null);
  assert.equal(erroDeRecurso(null, null, { ...REGRA_PADRAO, exigirRecurso: false }), null);
});

test("agenda: situações e ações permitidas", () => {
  assert.deepEqual(
    proximasSituacoes("agendado").map((a) => a.para),
    ["confirmado", "cancelado", "faltou"],
  );
  assert.deepEqual(
    proximasSituacoes("confirmado").map((a) => a.para),
    ["cancelado", "faltou"],
  );
  for (const s of ["concluido", "cancelado", "faltou"]) assert.deepEqual(proximasSituacoes(s), []);
  assert.equal(proximasSituacoes("agendado").find((a) => a.para === "cancelado")?.motivo, true);
  assert.equal(podeRemarcar("confirmado"), true);
  assert.equal(podeRegistrarChegada("agendado"), true);
  for (const s of ["concluido", "cancelado", "faltou"]) {
    assert.equal(podeRegistrarChegada(s), false);
    assert.equal(podeRemarcar(s), false);
  }
  assert.equal(ocupaHorario("concluido"), true);
  assert.equal(ocupaHorario("cancelado"), false);
});

test("agenda: horários no fuso de Brasília ida e volta", () => {
  assert.equal(paraCampoLocal(h("09:30")), "2030-03-15T09:30");
  assert.equal(deCampoLocal("2030-03-15T09:30")?.getTime(), h("09:30").getTime());
  assert.equal(deCampoLocal(""), null);
  assert.equal(deCampoLocal("2030-13-45T99:99"), null);
  assert.equal(horaBrasilia(h("21:05")), "21:05");
});

test("agenda: faixas do dia mostram livre e ocupado", () => {
  const faixas = faixasDoDia(
    [ag("a", "09:00", "10:00"), ag("b", "11:15", "11:45", { lavador_id: "l1" })],
    "2030-03-15",
    {
      abre: "08:00",
      fecha: "12:00",
      passoMin: 30,
    },
  );
  assert.equal(faixas.length, 8);
  const por = (hora: string) => faixas.find((f) => horaBrasilia(f.inicio) === hora)?.agendamentoId;
  assert.equal(por("08:30"), null);
  assert.equal(por("09:00"), "a");
  assert.equal(por("09:30"), "a");
  assert.equal(por("10:00"), null);
  assert.equal(por("11:00"), "b");
  assert.equal(por("11:30"), "b");
  const cancelado = faixasDoDia(
    [ag("a", "09:00", "10:00", { situacao: "cancelado" })],
    "2030-03-15",
    { abre: "08:00", fecha: "12:00", passoMin: 60 },
  );
  assert.equal(
    cancelado.every((f) => f.agendamentoId === null),
    true,
  );
});

test("agenda: boxes sem repetir, ignorando maiúsculas e espaços", () => {
  assert.deepEqual(
    boxesDosAgendamentos([
      { box: "Box 2" },
      { box: " box 2 " },
      { box: "Box 10" },
      { box: null },
      { box: "Box 1" },
    ]),
    ["Box 1", "Box 2", "Box 10"],
  );
});

test("agenda: preço previsto (tipo, geral, cadastro) e nunca inventado", () => {
  const precos = [
    { tipo: "carro", preco: 55 },
    { tipo: null, preco: 40 },
  ];
  assert.equal(precoPrevisto(precos, "carro", 30), 55);
  assert.equal(precoPrevisto(precos, "moto", 30), 40);
  assert.equal(precoPrevisto([], "moto", 30), 30);
  assert.equal(precoPrevisto([], "moto", 0), null);
  assert.equal(precoPrevisto([], "moto", null), null);
  assert.deepEqual(
    servicosSemPreco([
      { nome: "A", preco_estimado: 10 },
      { nome: "B", preco_estimado: null },
    ]),
    ["B"],
  );
  assert.equal(
    totalPrevisto([{ preco_estimado: 10 }, { preco_estimado: null }, { preco_estimado: 5.5 }]),
    15.5,
  );
});
