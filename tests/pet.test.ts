import assert from "node:assert/strict";
import { test } from "node:test";

import {
  descricaoDoPreco,
  idadeDoPet,
  pontosDoPreco,
  precoDoServico,
  type PetPreco,
} from "../src/lib/pet.ts";

const t = (
  porte: string | null,
  raca: string | null,
  pelagem: string | null,
  preco: number,
): PetPreco => ({
  porte,
  raca,
  pelagem,
  preco,
});

const tabela = [
  t(null, null, null, 50), // qualquer pet
  t("pequeno", null, null, 60),
  t(null, null, "longa", 70),
  t("pequeno", null, "longa", 80),
  t(null, "Poodle", null, 90),
  t("pequeno", "Poodle", "longa", 120),
];

test("cada combinação de critérios tem uma pontuação própria (sem empate entre combinações)", () => {
  const vistos = new Set<number>();
  for (const raca of [null, "x"])
    for (const pelagem of [null, "longa"])
      for (const porte of [null, "pequeno"]) {
        const p = pontosDoPreco({ raca, pelagem, porte });
        assert.ok(!vistos.has(p), `pontuação repetida ${p}`);
        vistos.add(p);
      }
  assert.equal(vistos.size, 8);
});

test("vence o preço mais específico: raça > pelagem > porte", () => {
  const poodle = { porte: "pequeno", raca: "poodle", pelagem: "longa" };
  assert.equal(precoDoServico(tabela, poodle)?.preco, 120); // raça + pelagem + porte
  assert.equal(precoDoServico(tabela, { ...poodle, pelagem: "curta" })?.preco, 90); // raça sozinha
  assert.equal(
    precoDoServico(tabela, { porte: "pequeno", raca: "SRD", pelagem: "longa" })?.preco,
    80,
  );
  assert.equal(
    precoDoServico(tabela, { porte: "grande", raca: "SRD", pelagem: "longa" })?.preco,
    70,
  );
  assert.equal(
    precoDoServico(tabela, { porte: "pequeno", raca: "SRD", pelagem: "curta" })?.preco,
    60,
  );
  assert.equal(
    precoDoServico(tabela, { porte: "grande", raca: "SRD", pelagem: "curta" })?.preco,
    50,
  );
});

test("a raça ignora maiúsculas e espaços", () => {
  assert.equal(
    precoDoServico(tabela, { porte: null, raca: "  POODLE ", pelagem: null })?.preco,
    90,
  );
});

test("sem nenhum preço que sirva, o serviço não é oferecido", () => {
  assert.equal(precoDoServico([t("grande", null, null, 100)], { porte: "mini" }), null);
  assert.equal(precoDoServico([], { porte: "mini" }), null);
  // pet sem porte informado só recebe preço que não exige porte
  assert.equal(precoDoServico([t("pequeno", null, null, 60)], {}), null);
  assert.equal(
    precoDoServico([t(null, null, null, 40), t("pequeno", null, null, 60)], {})?.preco,
    40,
  );
});

test("descrição dos critérios", () => {
  assert.equal(descricaoDoPreco(t(null, null, null, 1)), "Qualquer pet");
  assert.equal(
    descricaoDoPreco(t("pequeno", "Poodle", "longa", 1)),
    "Poodle · Pelagem longa · Porte pequeno",
  );
});

test("idade do pet", () => {
  const hoje = new Date("2026-10-19T12:00:00");
  assert.equal(idadeDoPet("2026-09-01", hoje), "1 mês");
  assert.equal(idadeDoPet("2026-10-10", hoje), "0 meses");
  assert.equal(idadeDoPet("2025-10-20", hoje), "11 meses");
  assert.equal(idadeDoPet("2025-10-19", hoje), "1 ano");
  assert.equal(idadeDoPet("2020-01-01", hoje), "6 anos");
  assert.equal(idadeDoPet(null, hoje), "");
  assert.equal(idadeDoPet("2027-01-01", hoje), "");
});

import {
  duracaoTotal,
  fimDoAtendimento,
  intervalosSeCruzam,
  podeRemarcar,
  proximasSituacoes,
  temConflito,
} from "../src/lib/pet.ts";

const h = (hora: number, min = 0) => new Date(2026, 9, 20, hora, min);

test("agenda: intervalos que se encostam não se cruzam", () => {
  assert.equal(intervalosSeCruzam(h(9), h(10), h(10), h(11)), false);
  assert.equal(intervalosSeCruzam(h(9), h(10), h(9, 59), h(11)), true);
  assert.equal(intervalosSeCruzam(h(9), h(12), h(10), h(11)), true); // um dentro do outro
  assert.equal(intervalosSeCruzam(h(10), h(11), h(9), h(10)), false);
});

test("agenda: conflito por profissional, ignorando cancelado, faltou e o próprio atendimento", () => {
  const lista = [
    { id: "a", profissional_id: "p1", inicio: h(9), fim: h(10), situacao: "agendado" },
    { id: "b", profissional_id: "p1", inicio: h(10), fim: h(11), situacao: "cancelado" },
    { id: "c", profissional_id: "p2", inicio: h(9), fim: h(10), situacao: "confirmado" },
    { id: "d", profissional_id: "p1", inicio: h(13), fim: h(14), situacao: "faltou" },
  ];
  assert.equal(temConflito(lista, "p1", h(9, 30), h(10, 30)), true);
  assert.equal(temConflito(lista, "p1", h(10), h(11)), false); // o cancelado não ocupa
  assert.equal(temConflito(lista, "p1", h(13), h(14)), false); // quem faltou não ocupa
  assert.equal(temConflito(lista, "p3", h(9), h(10)), false); // outro profissional
  assert.equal(temConflito(lista, "p1", h(9), h(10), "a"), false); // remarcar o próprio
});

test("agenda: duração e fim do atendimento", () => {
  assert.equal(duracaoTotal([{ duracao_min: 60 }, { duracao_min: 30 }]), 90);
  assert.equal(fimDoAtendimento(h(9), 90).getTime(), h(10, 30).getTime());
});

test("agenda: caminhos de situação", () => {
  const para = (s: string) => proximasSituacoes(s).map((x) => x.para);
  assert.deepEqual(para("agendado"), ["confirmado", "em_atendimento", "cancelado", "faltou"]);
  assert.deepEqual(para("confirmado"), ["em_atendimento", "cancelado", "faltou"]);
  assert.deepEqual(para("em_atendimento"), ["pronto"]);
  for (const fim of ["pronto", "retirado", "cancelado", "faltou"]) assert.deepEqual(para(fim), []);
  assert.ok(!para("agendado").includes("retirado" as never));
  assert.deepEqual(
    proximasSituacoes("agendado")
      .filter((x) => x.motivo)
      .map((x) => x.para),
    ["cancelado", "faltou"],
  );
  assert.equal(podeRemarcar("agendado"), true);
  assert.equal(podeRemarcar("em_atendimento"), false);
});
