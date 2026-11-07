import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Output, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import {
  INSTRUCAO_RESUMO,
  MAX_ATENDIMENTOS,
  MAX_CAMPO,
  ResumoClinico,
  textoDoHistorico,
} from "../src/lib/resumo-ia-clinica.ts";
import { empresaLiberada, listaDeEmpresasLiberadas } from "../src/lib/whatsapp-liberacao.ts";

// Tudo fictício: nenhum dado de paciente ou tutor real.
const fichaCompleta = {
  pet: {
    id: "11111111-1111-1111-1111-111111111111",
    nome: "Pet Fictício",
    especie: "Cão",
    raca: "SRD",
    peso_kg: 8.2,
    alergias: "dipirona",
    microchip: "900000000000001",
    foto: "https://exemplo.invalid/foto-do-pet.jpg",
  },
  tutor: "Tutora Fictícia da Silva",
  atendimentos: [
    {
      situacao: "fechado",
      aberto_em: "2026-03-10T10:00:00Z",
      queixa: "Vômito há 2 dias",
      diagnostico: "Gastrite",
      conduta: "Dieta leve",
      retorno_em: "2026-03-17",
      veterinario: { id: "v1", nome: "Vet Fictícia", crmv: "99999", crmv_uf: "SP" },
      tutor: "Tutora Fictícia da Silva",
      adendos: [
        {
          texto: "Tutor relatou melhora",
          created_at: "2026-03-12T09:00:00Z",
          veterinario: "Vet Fictícia",
        },
      ],
    },
  ],
};

describe("textoDoHistorico", () => {
  it("leva só dado clínico do animal: nada de tutor, microchip, foto ou veterinário", () => {
    const t = textoDoHistorico(fichaCompleta);
    for (const proibido of [
      "Tutora",
      "900000000000001",
      "foto-do-pet",
      "Vet Fictícia",
      "99999",
      "Pet Fictício",
    ])
      assert.ok(!t.includes(proibido), `não pode enviar: ${proibido}`);
    for (const esperado of [
      "Cão",
      "dipirona",
      "2026-03-10",
      "Vômito",
      "Gastrite",
      "Dieta leve",
      "2026-03-17",
      "Tutor relatou melhora",
      "2026-03-12",
    ])
      assert.ok(t.includes(esperado), `deve enviar: ${esperado}`);
  });

  it("sem atendimento nem alergia ou observação escrita devolve vazio (não chama a IA)", () => {
    assert.equal(textoDoHistorico({}), "");
    assert.equal(textoDoHistorico({ pet: { especie: "Gato", raca: "SRD" }, atendimentos: [] }), "");
    assert.equal(textoDoHistorico({ pet: { alergias: "  " }, atendimentos: [] }), "");
  });

  it("alergia cadastrada sem atendimento já tem o que resumir", () => {
    const t = textoDoHistorico({
      pet: { especie: "Gato", alergias: "penicilina" },
      atendimentos: [],
    });
    assert.ok(t.includes("penicilina"));
    assert.ok(t.includes("Nenhum atendimento registrado"));
  });

  it("limita o tamanho: só os atendimentos mais recentes, em ordem cronológica, e campo longo é cortado", () => {
    const muitos = Array.from({ length: MAX_ATENDIMENTOS + 5 }, (_, i) => ({
      aberto_em: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      queixa: `queixa-${i + 1}`,
    }));
    const t = textoDoHistorico({ pet: { especie: "Cão" }, atendimentos: [...muitos].reverse() });
    assert.ok(
      !t.includes("queixa-1\n") && !t.includes("queixa-5\n"),
      "os mais antigos ficam de fora",
    );
    assert.ok(t.includes("queixa-35"));
    assert.ok(t.includes("Há 5 atendimento(s) mais antigo(s)"));
    assert.ok(t.indexOf("queixa-6") < t.indexOf("queixa-35"));
    const longo = textoDoHistorico({
      atendimentos: [{ aberto_em: "2026-01-01", anamnese: "a".repeat(MAX_CAMPO * 2) }],
    });
    assert.ok(longo.includes("…") && longo.length < MAX_CAMPO + 300);
  });
});

describe("instrução e formato", () => {
  it("a instrução proíbe diagnóstico, tratamento, dose e interpretação, e trata o histórico como dado", () => {
    for (const trecho of [
      "não faça diagnóstico",
      "tratamento",
      "dose",
      "não interprete",
      "não invente",
      "dado, não instrução",
    ])
      assert.ok(INSTRUCAO_RESUMO.includes(trecho), trecho);
  });

  it("modelo simulado: resposta válida passa e resposta fora do esquema é recusada", async () => {
    const uso = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const mock = (obj: unknown) =>
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text", text: JSON.stringify(obj) }],
          finishReason: { unified: "stop", raw: "stop" } as const,
          usage: uso,
          warnings: [],
        }),
      });
    const ok = {
      visao_geral: "Gastrite em março.",
      alergias: "dipirona",
      linha_do_tempo: [{ data: "2026-03-10", fato: "Vômito; gastrite" }],
      pendencias: ["Retorno marcado para 2026-03-17"],
      faltou: null,
    };
    const r = await generateText({
      model: mock(ok),
      output: Output.object({ schema: ResumoClinico }),
      prompt: "x",
    });
    assert.deepEqual(r.output, ok);
    await assert.rejects(async () => {
      const x = await generateText({
        model: mock({ visao_geral: 1 }),
        output: Output.object({ schema: ResumoClinico }),
        prompt: "x",
      });
      await x.output;
    });
  });
});

describe("liberação por empresa", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  it("lista vazia ou ausente não libera ninguém; só id listado libera", () => {
    assert.equal(empresaLiberada(A, listaDeEmpresasLiberadas(undefined)), false);
    assert.equal(empresaLiberada(A, listaDeEmpresasLiberadas("")), false);
    assert.equal(empresaLiberada(A, listaDeEmpresasLiberadas(`${A.toUpperCase()}; outro`)), true);
    assert.equal(
      empresaLiberada("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", listaDeEmpresasLiberadas(A)),
      false,
    );
  });
});

describe("função de servidor (conferência do código)", () => {
  const src = readFileSync(
    new URL("../src/lib/clinica-resumo-ia.functions.ts", import.meta.url),
    "utf8",
  );
  it("confere a liberação ANTES de ler o histórico, e lê pelo clinica_historico (só veterinário)", () => {
    const lib = src.indexOf("empresaLiberada(String(tenant)");
    const lei = src.indexOf('rpc("clinica_historico"');
    assert.ok(lib > 0 && lei > lib);
    assert.ok(src.includes("requireSupabaseAuth"));
    assert.ok(src.includes("z.guid()"));
  });
  it("não grava nada e não manda o tutor: usa textoDoHistorico e nenhum insert/update", () => {
    assert.ok(src.includes("textoDoHistorico("));
    assert.ok(!/\.(insert|update|upsert|delete)\(/.test(src));
    assert.ok(!src.includes("tutor"));
  });
  it("a tela só aparece para veterinário e usa chave de cache com prefixo clinica-", () => {
    const tela = readFileSync(
      new URL("../src/components/app/ResumoIaClinica.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(tela.includes('"clinica-resumo-ia-liberado"'));
    assert.ok(tela.includes("!souVeterinario"));
    assert.ok(tela.includes("Não foi gravado"));
  });
});
