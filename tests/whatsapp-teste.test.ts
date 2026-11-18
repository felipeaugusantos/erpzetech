import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entradaTesteWhatsApp, textoTesteWhatsApp } from "../src/lib/whatsapp-teste.ts";
import { MENSAGEM_PADRAO, montarMensagem } from "../src/lib/contato-pet.ts";
import { RODAPE_SAIR } from "../src/lib/whatsapp-despacho.ts";

const dados = {
  numero: "(16) 99999-0000",
  modelo: "vacina_antes",
  tutor: "Ana Silva",
  pet: "Thor",
  data: "2026-11-20",
  itens: "V10",
};
describe("teste do lembrete da clínica", () => {
  it("normaliza o número digitado com DDD", () => {
    assert.equal(entradaTesteWhatsApp.parse(dados).numero, "5516999990000");
    assert.equal(entradaTesteWhatsApp.safeParse({ ...dados, numero: "999" }).success, false);
  });
  for (const modelo of ["vacina_antes", "vacina_atrasada", "consulta_antes"] as const) {
    it(`envia o texto real do modelo ${modelo}`, () => {
      const entrada = entradaTesteWhatsApp.parse({ ...dados, modelo });
      assert.equal(
        textoTesteWhatsApp(entrada, "Minha clínica"),
        montarMensagem(MENSAGEM_PADRAO[modelo], {
          tutor: "Ana Silva",
          pet: "Thor",
          loja: "Minha clínica",
          data: "20/11/2026",
          itens: "V10",
        }) + RODAPE_SAIR,
      );
    });
  }
  it("prefere o modelo salvo pela empresa e preenche todas as datas", () => {
    assert.equal(
      textoTesteWhatsApp(
        entradaTesteWhatsApp.parse(dados),
        "Clínica",
        "{tutor}, {pet}: {data} / {data} · {itens}",
      ),
      "Ana, Thor: 20/11/2026 / 20/11/2026 · V10" + RODAPE_SAIR,
    );
  });
});
