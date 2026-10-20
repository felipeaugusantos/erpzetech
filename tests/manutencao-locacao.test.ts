import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  equipamentosComManutencaoVencida,
  erroDaManutencao,
  erroDoPlano,
  ordenarPorUrgencia,
  resumoDosPlanos,
  textoDoProgresso,
  type FormManutencao,
  type PlanoSituacao,
} from "../src/lib/manutencao-locacao.ts";

const hoje = "2026-10-20";
const plano = (p: Partial<PlanoSituacao>): PlanoSituacao => ({
  plano_id: "p",
  equipamento_id: "e",
  equipamento: "Betoneira",
  codigo: null,
  nome: "Troca de óleo",
  intervalo_dias: 30,
  referencia_em: "2026-09-01",
  dias: 10,
  restantes: 20,
  situacao: "em_dia",
  ...p,
});

describe("urgência", () => {
  it("vencida primeiro, depois a que vence em breve, depois em dia", () => {
    const r = ordenarPorUrgencia([
      plano({ plano_id: "a", situacao: "em_dia", restantes: 5 }),
      plano({ plano_id: "b", situacao: "vencida", restantes: -2 }),
      plano({ plano_id: "c", situacao: "proxima", restantes: 2 }),
      plano({ plano_id: "d", situacao: "vencida", restantes: -9 }),
    ]);
    assert.deepEqual(
      r.map((p) => p.plano_id),
      ["d", "b", "c", "a"],
    );
  });
  it("resumo e equipamentos bloqueados", () => {
    const ps = [
      plano({ situacao: "vencida", equipamento_id: "x", nome: "Óleo" }),
      plano({ situacao: "vencida", equipamento_id: "x", nome: "Correia" }),
      plano({ situacao: "proxima", equipamento_id: "y" }),
    ];
    assert.deepEqual(resumoDosPlanos(ps), { vencidas: 2, proximas: 1 });
    const m = equipamentosComManutencaoVencida(ps);
    assert.deepEqual(m.get("x"), ["Óleo", "Correia"]);
    assert.equal(m.has("y"), false);
  });
  it("texto do progresso", () => {
    assert.equal(
      textoDoProgresso({ dias: 12, intervalo_dias: 30, restantes: 18 }),
      "12 de 30 dias locados (faltam 18)",
    );
    assert.equal(
      textoDoProgresso({ dias: 33, intervalo_dias: 30, restantes: -3 }),
      "33 de 30 dias locados (passou 3 dia(s))",
    );
  });
});

describe("formulário do plano", () => {
  const ok = { nome: "Troca de óleo", intervaloDias: "60", referenciaEm: "2026-10-01" };
  it("aceita o preenchimento certo e recusa o errado", () => {
    assert.equal(erroDoPlano(ok, hoje), null);
    assert.match(erroDoPlano({ ...ok, nome: "X" }, hoje) ?? "", /nome/);
    assert.match(erroDoPlano({ ...ok, intervaloDias: "0" }, hoje) ?? "", /intervalo/);
    assert.match(erroDoPlano({ ...ok, intervaloDias: "4000" }, hoje) ?? "", /intervalo/);
    assert.match(erroDoPlano({ ...ok, intervaloDias: "abc" }, hoje) ?? "", /intervalo/);
    assert.match(erroDoPlano({ ...ok, referenciaEm: "2026-10-21" }, hoje) ?? "", /futuro/);
  });
});

describe("formulário da manutenção", () => {
  const ok: FormManutencao = {
    planoId: "p",
    tipo: "preventiva",
    realizadaEm: "2026-10-20",
    descricao: "Troca de óleo e filtro",
    custo: "150,50",
    responsavel: "Oficina",
  };
  it("confere descrição, data, custo e responsável", () => {
    assert.equal(erroDaManutencao(ok, hoje, "2026-09-01"), null);
    assert.match(erroDaManutencao({ ...ok, descricao: "" }, hoje) ?? "", /Descreva/);
    assert.match(erroDaManutencao({ ...ok, realizadaEm: "2026-10-21" }, hoje) ?? "", /futuro/);
    assert.match(
      erroDaManutencao({ ...ok, realizadaEm: "2026-08-01" }, hoje, "2026-09-01") ?? "",
      /anterior à última.*01\/09\/2026/,
    );
    assert.match(erroDaManutencao({ ...ok, custo: "abc" }, hoje) ?? "", /custo/);
    assert.match(erroDaManutencao({ ...ok, custo: "-5" }, hoje) ?? "", /custo/);
    assert.equal(erroDaManutencao({ ...ok, custo: "" }, hoje), null);
  });
});
