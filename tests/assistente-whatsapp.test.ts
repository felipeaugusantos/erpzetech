import assert from "node:assert/strict";
import test from "node:test";
import { preferenciasAssistenteSchema } from "../src/lib/assistente-whatsapp.ts";

const preferencias = {
  nome: "Atendimento",
  boas_vindas: "Olá! Como podemos ajudar?",
  responsavel_numero: "",
  orcamentos: true,
  agendamentos: true,
};

test("preferências não autorizam ativação gratuita ou preço inventado", () => {
  assert.equal(preferenciasAssistenteSchema.safeParse(preferencias).success, true);
  assert.equal(
    preferenciasAssistenteSchema.safeParse({ ...preferencias, ativo: true }).success,
    false,
  );
  assert.equal(
    preferenciasAssistenteSchema.safeParse({ ...preferencias, preco_mensal: 0 }).success,
    false,
  );
});
test("responsável pode ficar pendente mas número preenchido precisa ser válido", () => {
  assert.equal(
    preferenciasAssistenteSchema.safeParse({ ...preferencias, responsavel_numero: "5516988547561" })
      .success,
    true,
  );
  assert.equal(
    preferenciasAssistenteSchema.safeParse({ ...preferencias, responsavel_numero: "abc" }).success,
    false,
  );
});
