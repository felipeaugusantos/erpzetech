import assert from "node:assert/strict";
import test from "node:test";

import {
  alteracoes,
  fimDoDia,
  formatarValor,
  inicioDoDia,
  rotuloCampo,
  rotuloEntidade,
  rotuloOperacao,
} from "../src/lib/auditoria.ts";

test("nomes em português para entidades, operações e campos", () => {
  assert.equal(rotuloEntidade("contas_receber"), "Conta a receber");
  assert.equal(rotuloEntidade("user_roles"), "Perfil de acesso");
  assert.equal(rotuloEntidade("tabela_nova"), "tabela_nova");
  assert.equal(rotuloOperacao("delete"), "Exclusão");
  assert.equal(rotuloCampo("nfse_iss_retido"), "ISS retido");
  assert.equal(rotuloCampo("campo_novo_qualquer"), "campo novo qualquer");
});

test("valores aparecem como moeda, percentual, data, sim/não e perfil", () => {
  assert.match(formatarValor("valor", 90), /R\$\s?90,00/);
  assert.match(formatarValor("valor", "100.50"), /R\$\s?100,50/);
  assert.match(formatarValor("preco", 12.5), /R\$\s?12,50/);
  assert.equal(rotuloCampo("preco"), "Preço");
  assert.equal(formatarValor("aliquota_icms", 18), "18%");
  assert.equal(formatarValor("vencimento", "2026-10-03"), "03/10/2026");
  assert.equal(formatarValor("nfse_iss_retido", true), "Sim");
  assert.equal(formatarValor("ativo", false), "Não");
  assert.equal(formatarValor("role", "financeiro"), "Financeiro");
  assert.equal(formatarValor("situacao", "pago"), "pago");
});

test("vazio e segredo: sem valor aparece traço; token mascarado não mostra nada", () => {
  assert.equal(formatarValor("motivo_cancelamento", null), "—");
  assert.equal(formatarValor("motivo_cancelamento", undefined), "—");
  assert.equal(formatarValor("nfse_token", "***"), "•••• (valor protegido)");
});

test("alteração mostra antes e depois; inclusão só depois; exclusão só antes", () => {
  const alt = alteracoes({ situacao: "aberto", valor: 80 }, { situacao: "pago", valor: 80 });
  assert.deepEqual(
    alt.map((a) => [a.rotulo, a.antes, a.depois]),
    [
      ["Situação", "aberto", "pago"],
      ["Valor", formatarValor("valor", 80), formatarValor("valor", 80)],
    ],
  );
  const inc = alteracoes(null, { user_id: "u1", role: "gestor" });
  assert.equal(inc[1]?.antes, "—");
  assert.equal(inc[1]?.depois, "Gestor");
  const exc = alteracoes({ valor: 90 }, null);
  assert.equal(exc[0]?.depois, "—");
  assert.match(exc[0]?.antes ?? "", /90,00/);
  assert.deepEqual(alteracoes(null, null), []);
});

test("busca por dia usa o início e o fim do dia de Brasília", () => {
  assert.equal(inicioDoDia("2026-10-15"), "2026-10-15T00:00:00-03:00");
  assert.equal(fimDoDia("2026-10-15"), "2026-10-15T23:59:59.999-03:00");
  // 23h de Brasília ainda é o dia 15, mesmo já sendo dia 16 em UTC
  const instante = new Date("2026-10-16T02:00:00Z").getTime();
  assert.ok(instante >= new Date(inicioDoDia("2026-10-15")).getTime());
  assert.ok(instante <= new Date(fimDoDia("2026-10-15")).getTime());
});
