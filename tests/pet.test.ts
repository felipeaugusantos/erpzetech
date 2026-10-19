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
