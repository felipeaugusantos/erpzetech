import assert from "node:assert/strict";
import { test } from "node:test";

import { Output, generateText, streamText } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";

// A leitura de DANFE em PDF e a sugestão da frente de caixa mandam um esquema zod para a biblioteca de IA. Este teste usa os mesmos
// recursos (campo anulável, descrição, lista de objetos) para a troca de versão do zod não quebrar o formato enviado.
test("o esquema zod vira o formato JSON que a IA recebe (anulável, descrição e lista)", async () => {
  const esquema = z.object({
    chave: z.string().nullable(),
    total: z.number(),
    vencimentos: z.array(z.object({ data: z.string().describe("AAAA-MM-DD"), valor: z.number() })),
  });
  const formato = await Output.object({ schema: esquema }).responseFormat;
  assert.ok(formato && formato.type === "json", "o formato enviado à IA é JSON");
  const schema = (formato as { schema: unknown }).schema as {
    properties: Record<
      string,
      { type?: unknown; items?: { properties: Record<string, { description?: string }> } }
    >;
    required?: string[];
    additionalProperties?: boolean;
  };
  assert.deepEqual(Object.keys(schema.properties), ["chave", "total", "vencimentos"]);
  assert.deepEqual(schema.required, ["chave", "total", "vencimentos"]);
  assert.deepEqual(schema.properties["chave"]?.type, ["string", "null"]);
  assert.equal(
    schema.properties["vencimentos"]?.items?.properties["data"]?.description,
    "AAAA-MM-DD",
  );
  assert.equal(schema.additionalProperties, false);
});

// As duas chamadas reais usam `generateText` (DANFE) e `streamText` + `await result.output` (frente de caixa) com `Output.object`.
// Aqui um modelo simulado devolve a resposta, e o esquema zod valida e converte, sem chave nem rede.
const USO = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};
const FIM = { unified: "stop", raw: "stop" } as const;
const Nota = z.object({
  numero: z.string().nullable(),
  total: z.number(),
  vencimentos: z.array(z.object({ data: z.string().describe("AAAA-MM-DD"), valor: z.number() })),
});
const Sugestao = z.object({
  itens: z.array(z.object({ codigo: z.string(), quantidade: z.number(), motivo: z.string() })),
  observacao: z.string(),
});

test("generateText com Output.object valida a resposta da IA com o zod (leitura de DANFE)", async () => {
  const resposta = {
    numero: "123",
    total: 150.5,
    vencimentos: [{ data: "2026-12-01", valor: 150.5 }],
  };
  const modelo = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(resposta) }],
      finishReason: FIM,
      usage: USO,
      warnings: [],
    }),
  });
  const r = await generateText({
    model: modelo,
    output: Output.object({ schema: Nota }),
    prompt: "texto",
  });
  assert.deepEqual(r.output, resposta);
  assert.equal(modelo.doGenerateCalls[0]?.responseFormat?.type, "json");
});

test("resposta da IA fora do esquema (número em texto) é recusada em vez de seguir adiante", async () => {
  const modelo = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ numero: "1", total: "cento e cinquenta", vencimentos: [] }),
        },
      ],
      finishReason: FIM,
      usage: USO,
      warnings: [],
    }),
  });
  await assert.rejects(async () => {
    const r = await generateText({
      model: modelo,
      output: Output.object({ schema: Nota }),
      prompt: "x",
    });
    await r.output;
  });
});

test("streamText com Output.object entrega a sugestão validada em `await result.output` (frente de caixa)", async () => {
  const sugestao = {
    itens: [
      { codigo: "P0", quantidade: 3, motivo: "pedido do cliente" },
      { codigo: "P2", quantidade: 1.5, motivo: "complemento" },
    ],
    observacao: "ok",
  };
  const pedacos = JSON.stringify(sugestao).match(/.{1,25}/g) ?? [];
  const modelo = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          ...pedacos.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: FIM, usage: USO },
        ],
      }),
    }),
  });
  const resultado = streamText({
    model: modelo,
    output: Output.object({ schema: Sugestao }),
    prompt: "catálogo",
  });
  assert.deepEqual(await resultado.output, sugestao);
});
