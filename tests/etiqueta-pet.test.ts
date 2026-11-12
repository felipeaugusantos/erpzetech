import assert from "node:assert/strict";
import { test } from "node:test";

import { htmlEtiquetas, modeloEtiqueta, MODELOS_ETIQUETA } from "../src/lib/etiqueta.ts";
import {
  etiquetaDoPet,
  infoDoPet,
  nomeResumidoDoTutor,
  previsaoDaFicha,
} from "../src/lib/etiqueta-pet.ts";
import { cabeNaEtiqueta, comandosEtiquetas } from "../src/lib/etiqueta-raw.ts";

const FICHA = etiquetaDoPet({
  pet: {
    nome: "Thor",
    especie: "cao",
    raca: "Shih-tzu",
    porte: "pequeno",
    alergias: "frango e milho",
  },
  tutor: { nome: "Maria Aparecida Souza", telefone: "(11) 99999-0000" },
  os: {
    numero: 128,
    previsao: "2026-11-15T20:30:00Z",
    servicos: ["Banho", "Tosa higiênica", "Banho"],
  },
});

test("tutor resumido, informações do animal e retirada em horário de Brasília", () => {
  assert.equal(nomeResumidoDoTutor("  Maria Aparecida souza "), "Maria S.");
  assert.equal(nomeResumidoDoTutor("Cher"), "Cher");
  assert.equal(nomeResumidoDoTutor(" "), null);
  assert.equal(nomeResumidoDoTutor(null), null);
  assert.equal(
    infoDoPet({ especie: "cao", raca: " Shih-tzu ", porte: "pequeno" }),
    "Cão · Shih-tzu · Pequeno",
  );
  assert.equal(infoDoPet({ especie: "gato" }), "Gato");
  assert.equal(infoDoPet({}), null);
  assert.equal(previsaoDaFicha("2026-11-15T20:30:00Z"), "15/11 17:30");
  assert.equal(previsaoDaFicha("2026-11-15"), "15/11");
  assert.equal(previsaoDaFicha(""), null);
  assert.equal(previsaoDaFicha("lixo"), null);
});

test("ficha: telefone só com a opção ligada, serviços sem repetição e nada de observações", () => {
  const m = modeloEtiqueta("t-100x50-pet")!;
  assert.equal(FICHA.pet?.tutorTelefone, "(11) 99999-0000");
  assert.ok(!htmlEtiquetas(m, [FICHA]).includes("99999-0000"));
  assert.ok(!comandosEtiquetas(m, [FICHA], { linguagem: "zpl", dpi: 203 }).includes("99999-0000"));
  assert.ok(!comandosEtiquetas(m, [FICHA], { linguagem: "tspl", dpi: 203 }).includes("99999-0000"));
  const ligado = { mostrarTelefoneTutor: true };
  assert.ok(htmlEtiquetas(m, [FICHA], ligado).includes("Tutor: Maria S. · (11) 99999-0000"));
  assert.ok(
    comandosEtiquetas(m, [FICHA], { linguagem: "zpl", dpi: 203 }, ligado).includes(
      "(11) 99999-0000",
    ),
  );
  assert.ok(
    comandosEtiquetas(m, [FICHA], { linguagem: "tspl", dpi: 203 }, ligado).includes(
      "(11) 99999-0000",
    ),
  );
  assert.deepEqual(FICHA.pet?.servicos, ["Banho", "Tosa higiênica"]);
  assert.equal(FICHA.pet?.os, 128);
  const com = etiquetaDoPet({
    pet: { nome: "Thor" },
    tutor: { nome: "Ana Lima", telefone: " (11) 90000-1111 " },
  });
  assert.equal(com.pet?.tutorTelefone, "(11) 90000-1111");
  assert.ok(!JSON.stringify(FICHA).includes("observ"));
});

test("modelos de pet: só os de pet têm uso pet; a folha de pet cabe na A4", () => {
  const pets = MODELOS_ETIQUETA.filter((m) => m.uso === "pet");
  assert.deepEqual(
    pets.map((m) => m.id),
    ["t-60x40-pet", "t-100x50-pet", "f-2x7-pet"],
  );
  assert.ok(
    MODELOS_ETIQUETA.filter((m) => m.uso !== "pet").every(
      (m) => !(m.campos ?? []).some((c) => ["animal", "tutor", "alergia"].includes(c.campo)),
    ),
  );
});

test("HTML: ficha com o nome do animal, tutor resumido, retirada e alergia em destaque", () => {
  const html = htmlEtiquetas(modeloEtiqueta("t-100x50-pet")!, [FICHA]);
  for (const t of [
    "OS 128",
    "Thor",
    "Cão · Shih-tzu · Pequeno",
    "Tutor: Maria S.",
    "Banho, Tosa higiênica",
    "Retirada: 15/11 17:30",
    "ALERGIA: frango e milho",
  ]) {
    assert.ok(html.includes(t), t);
  }
  assert.ok(!html.includes("99999-0000") && !html.includes("Aparecida"));
  assert.ok(html.includes("font-weight:800"));
});

test("HTML: campo sem dado não ocupa lugar; texto do usuário é escapado", () => {
  const f = etiquetaDoPet({ pet: { nome: "<b>Rex</b>" } });
  const html = htmlEtiquetas(modeloEtiqueta("t-60x40-pet")!, [f]);
  assert.ok(html.includes("&lt;b&gt;Rex&lt;/b&gt;"));
  assert.ok(!html.includes("Tutor:") && !html.includes("Retirada:") && !html.includes("ALERGIA"));
});

test("ZPL e TSPL: a ficha sai com os campos de pet e sem caracteres de comando", () => {
  const m = modeloEtiqueta("t-100x50-pet")!;
  const z = comandosEtiquetas(m, [FICHA], { linguagem: "zpl", dpi: 203 });
  for (const t of [
    "OS 128",
    "Thor",
    "Tutor: Maria S.",
    "Retirada: 15/11 17:30",
    "ALERGIA: frango e milho",
  ])
    assert.ok(z.includes(t), `zpl ${t}`);
  const t = comandosEtiquetas(m, [FICHA], { linguagem: "tspl", dpi: 203 });
  for (const x of ["OS 128", "Thor", "Tutor: Maria S.", "ALERGIA: frango"])
    assert.ok(t.includes(x), `tspl ${x}`);
  const sujo = etiquetaDoPet({ pet: { nome: "A^B~C", alergias: 'dizem "tudo"' } });
  assert.ok(comandosEtiquetas(m, [sujo], { linguagem: "zpl", dpi: 203 }).includes("^FDA B C^FS"));
  assert.ok(!comandosEtiquetas(m, [sujo], { linguagem: "tspl", dpi: 203 }).includes('""'));
});

test("a ficha cabe nas térmicas de pet, em 203 e 300 dpi, com os dados mais cheios", () => {
  const cheia = etiquetaDoPet({
    pet: {
      nome: "Bartolomeu Júnior",
      especie: "cao",
      raca: "Cavalier King Charles Spaniel",
      porte: "medio",
      alergias: "frango, milho, soja e corantes artificiais",
    },
    tutor: { nome: "Maria Aparecida Souza", telefone: "(11) 99999-0000" },
    os: {
      numero: 12345,
      previsao: "2026-11-15T20:30:00Z",
      servicos: ["Banho", "Tosa higiênica", "Hidratação", "Corte de unhas"],
    },
  });
  for (const id of ["t-60x40-pet", "t-100x50-pet"])
    for (const dpi of [203, 300] as const)
      for (const linguagem of ["zpl", "tspl"] as const)
        assert.deepEqual(
          cabeNaEtiqueta(
            modeloEtiqueta(id)!,
            [cheia],
            { linguagem, dpi },
            { mostrarTelefoneTutor: true },
          ),
          [true],
          `${id} ${dpi} ${linguagem}`,
        );
});
