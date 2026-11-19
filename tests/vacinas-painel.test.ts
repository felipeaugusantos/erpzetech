import assert from "node:assert/strict";
import test from "node:test";

import { filtrarPainel, resumoPainel, type LinhaPainelVacina } from "../src/lib/vacinas-painel.ts";

const base = {
  especie: "cão",
  cliente_id: "c",
  telefone: null,
  tipo: "vacina",
  aplicada_em: "2025-11-01",
};
const linhas: LinhaPainelVacina[] = [
  {
    ...base,
    pet_id: "1",
    pet: "Rex",
    tutor: "Ana",
    vacina: "V10",
    proxima_dose_em: "2026-11-10",
    dias: -9,
  },
  {
    ...base,
    pet_id: "1",
    pet: "Rex",
    tutor: "Ana",
    vacina: "Antirrábica",
    proxima_dose_em: "2026-11-19",
    dias: 0,
  },
  {
    ...base,
    pet_id: "2",
    pet: "Mel",
    tutor: "Bia",
    vacina: "V4",
    proxima_dose_em: "2026-12-01",
    dias: 12,
  },
];

test("vacina com data já vencida conta como atrasada; a de hoje é próximo reforço", () => {
  assert.deepEqual(
    filtrarPainel(linhas, "atrasadas").map((l) => l.vacina),
    ["V10"],
  );
  assert.deepEqual(
    filtrarPainel(linhas, "proximas").map((l) => l.vacina),
    ["Antirrábica", "V4"],
  );
  assert.deepEqual(resumoPainel(linhas), { atrasadas: 1, proximas: 2, pets: 2 });
});

test("busca encontra por tutor, pet ou vacina", () => {
  assert.equal(filtrarPainel(linhas, "todas", "bia").length, 1);
  assert.equal(filtrarPainel(linhas, "todas", "rex").length, 2);
});
