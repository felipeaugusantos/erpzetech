import test from "node:test";
import assert from "node:assert/strict";

import {
  erroDaChapa,
  perdaDoPlano,
  planoDeCorte,
  type ChapaCorte,
  type PecaCorte,
} from "../src/lib/plano-corte.ts";

const chapa: ChapaCorte = { largura: 2750, altura: 1850, refilo: 10, serra: 3 };
const peca = (
  nome: string,
  largura: number,
  altura: number,
  quantidade: number,
  girar = true,
): PecaCorte => ({
  nome,
  largura,
  altura,
  quantidade,
  girar,
});

function semSobreposicao(plano: ReturnType<typeof planoDeCorte>, c: ChapaCorte) {
  for (const ch of plano.chapas) {
    for (const p of ch.pecas) {
      assert.ok(p.x >= c.refilo && p.y >= c.refilo, "dentro do refilo");
      assert.ok(
        p.x + p.largura <= c.largura - c.refilo && p.y + p.altura <= c.altura - c.refilo,
        "dentro da chapa",
      );
    }
    for (let i = 0; i < ch.pecas.length; i++)
      for (let j = i + 1; j < ch.pecas.length; j++) {
        const a = ch.pecas[i]!;
        const b = ch.pecas[j]!;
        const separa =
          a.x + a.largura <= b.x ||
          b.x + b.largura <= a.x ||
          a.y + a.altura <= b.y ||
          b.y + b.altura <= a.y;
        assert.ok(separa, `peças ${a.nome} e ${b.nome} se sobrepõem`);
      }
  }
}

test("plano de corte: peças pequenas cabem numa chapa e não se sobrepõem", () => {
  const plano = planoDeCorte(
    [peca("Lateral", 600, 800, 2), peca("Prateleira", 560, 400, 4)],
    chapa,
  );
  assert.equal(plano.chapas.length, 1);
  assert.equal(plano.naoCabem.length, 0);
  assert.equal(plano.chapas[0]!.pecas.length, 6);
  assert.equal(plano.areaPecas, 600 * 800 * 2 + 560 * 400 * 4);
  semSobreposicao(plano, chapa);
});

test("plano de corte: precisa de mais chapas quando não cabe e usa todas as peças", () => {
  const plano = planoDeCorte([peca("Painel", 1200, 1800, 5)], chapa);
  // 2 painéis de 1200 por chapa (2 x 1203 <= 2753); sobra faixa de ~540 que não comporta outro
  assert.equal(plano.chapas.length, 3);
  assert.equal(
    plano.chapas.reduce((s, c) => s + c.pecas.length, 0),
    5,
  );
  semSobreposicao(plano, chapa);
});

test("plano de corte: o veio da madeira impede girar a peça", () => {
  // 1900 x 100 só cabe na chapa de 2750 x 1850 se for deitada; com veio travado a peça (1900 > 1850 em altura) não cabe de pé
  const plano = planoDeCorte([peca("Régua", 100, 1900, 1, false)], chapa);
  assert.deepEqual(plano.naoCabem, ["Régua"]);
  assert.equal(plano.chapas.length, 0);
  const livre = planoDeCorte([peca("Régua", 100, 1900, 1, true)], chapa);
  assert.equal(livre.naoCabem.length, 0);
  assert.equal(livre.chapas.length, 1);
  assert.equal(livre.chapas[0]!.pecas[0]!.girada, true);
});

test("plano de corte: peça maior que a chapa útil não cabe", () => {
  const plano = planoDeCorte([peca("Gigante", 2800, 1000, 1)], chapa);
  assert.deepEqual(plano.naoCabem, ["Gigante"]);
});

test("plano de corte: serra e refilo entram na conta", () => {
  // útil 2730 x 1830; 3 peças de 910 de largura ocupam 3 x 913 = 2739 > 2733 (útil + serra): a terceira vai para outra faixa/chapa
  const c: ChapaCorte = { largura: 2750, altura: 1850, refilo: 10, serra: 3 };
  const duas = planoDeCorte([peca("A", 910, 1830, 3, false)], c);
  assert.equal(duas.chapas.length, 2);
  const sem = planoDeCorte([peca("A", 910, 1830, 3, false)], { ...c, serra: 0, refilo: 0 });
  assert.equal(sem.chapas.length, 1);
});

test("plano de corte: aproveitamento e perda para a lista de materiais", () => {
  const plano = planoDeCorte([peca("Tampo", 1375, 925, 4)], {
    largura: 2750,
    altura: 1850,
    refilo: 0,
    serra: 0,
  });
  assert.equal(plano.chapas.length, 1);
  assert.equal(plano.aproveitamento, 100);
  assert.equal(perdaDoPlano(plano.aproveitamento), 0);
  assert.equal(perdaDoPlano(82.34), 17.7);
});

test("plano de corte: linhas vazias ou inválidas são ignoradas e a chapa é validada", () => {
  assert.equal(
    planoDeCorte([peca("Zero", 0, 100, 1), peca("Sem qtd", 100, 100, 0)], chapa).chapas.length,
    0,
  );
  assert.equal(erroDaChapa(chapa), "");
  assert.notEqual(erroDaChapa({ ...chapa, largura: 0 }), "");
  assert.notEqual(erroDaChapa({ ...chapa, refilo: 1000 }), "");
});
