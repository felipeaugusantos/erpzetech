import { it } from "node:test";
import assert from "node:assert/strict";
import { corpoLaudoFivFelv } from "../src/lib/laudo-fiv-felv.ts";
const dados = { amostra: "Sangue", data: "2026-11-05", produto: "Teste combinado", lote: "003/26", validade: "mai/27", fiv: "Negativo", felv: "Positivo", observacao: "" };
it("preserva os resultados independentes e a data do teste", () => {
  const corpo = corpoLaudoFivFelv(dados);
  assert.ok(corpo.includes("FIV: Negativo\nFeLV: Positivo"));
  assert.ok(corpo.includes("05/11/2026"));
  assert.ok(corpo.includes("003/26"));
});
it("não emite sem resultado ou lote e aceita inválido informado pelo veterinário", () => {
  assert.throws(() => corpoLaudoFivFelv({ ...dados, fiv: "" }));
  assert.throws(() => corpoLaudoFivFelv({ ...dados, lote: "" }));
  assert.ok(corpoLaudoFivFelv({ ...dados, fiv: "Inválido" }).includes("FIV: Inválido"));
});