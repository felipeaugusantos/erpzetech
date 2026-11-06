import assert from "node:assert/strict";
import { test } from "node:test";

import { Output } from "ai";
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
