import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_CAMPANHA, nomesPets, textoCampanha, validarCampanha } from "../src/lib/campanha-whatsapp.ts";

describe("campanha de WhatsApp", () => {
  it("aceita no máximo 10 tutores por envio", () => {
    assert.equal(MAX_CAMPANHA, 10);
    assert.equal(validarCampanha("Olá, {tutor}!", 10), null);
    assert.match(validarCampanha("Olá, {tutor}!", 11) ?? "", /no máximo 10/);
    assert.match(validarCampanha("Olá, {tutor}!", 0) ?? "", /ao menos um/);
  });
  it("personaliza tutor, pets e clínica", () => {
    assert.equal(textoCampanha("Oi {tutor}, {pet} na {clinica}", { tutor: "Felipe Santos", pets: ["Thor", "Mel"] }, "Vet Zé"), "Oi Felipe, Thor e Mel na Vet Zé");
    assert.equal(nomesPets([]), "seu pet");
    assert.equal(nomesPets(["A", "B", "C"]), "A, B e C");
  });
});
