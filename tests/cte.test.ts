import assert from "node:assert/strict";
import { test } from "node:test";
import { lerTextoDacte, rateioFrete } from "../src/lib/cte.ts";

const DACTE = `                                    R R TRANSPORTES LTDA
                                    RUA GALATEA, 1205                                     14/10/26 19:07
 CNPJ 00.564.267/0002-92 IE 149673729116 RNTRC 02682741
                     35.2610.00.564.267/0002-92-57-002-000.727.506-100.175.943-4
 CNPJ 13.322.613/0001-97        IE 582535200117        VALOR ICMS(R$)        17,38
 FRETE TOTAL (R$)          144,83        VALOR A RECEBER (R$)                        144,83
                                                        NF-E: 35261000574422000170550010000130801293016607`;

test("lê o DACTE da R R Transportes: frete R$ 144,83 da NF-e 13.080", () => {
  const c = lerTextoDacte(DACTE);
  assert.equal(c.valor, 144.83);
  assert.equal(c.icms, 17.38);
  assert.equal(c.numero, "727506");
  assert.equal(c.serie, "2");
  assert.equal(c.cnpj, "00564267000292");
  assert.equal(c.emissao, "2026-10-14");
  assert.equal(c.razao_social, "R R TRANSPORTES LTDA");
  assert.deepEqual(c.nfe_chaves, ["35261000574422000170550010000130801293016607"]);
});

test("rateia o frete pelo valor de cada item", () => {
  assert.deepEqual(rateioFrete([750, 250], 100), [75, 25]);
});

test("lê dois CT-e com título espaçado e número da NF-e em outra coluna do PDF", async () => {
  const { lerDactes } = await import("../src/lib/cte.ts");
  const primeira = `D A C T E\n${DACTE} | 000013080`;
  const segunda = `D A C T E\nR R TRANSPORTES LTDA\n35.2610.00.564.267/0002-92-57-002-000.727.538-100.175.975-6\nVALOR A RECEBER (R$) | 145,76\nNF-E: 35261015324813000104550010000166701300700009 | 000016670`;
  const ctes = lerDactes(`${primeira}\n${primeira}\n${segunda}\n${segunda}`);
  assert.equal(ctes.length, 2);
  assert.equal(ctes[0]?.numero, "727506");
  assert.equal(ctes[0]?.valor, 144.83);
  assert.deepEqual(ctes[0]?.nfe_chaves, ["35261000574422000170550010000130801293016607"]);
  assert.equal(ctes[1]?.numero, "727538");
  assert.equal(ctes[1]?.valor, 145.76);
  assert.deepEqual(ctes[1]?.nfe_chaves, ["35261015324813000104550010000166701300700009"]);
});

test("separa dois DACTEs no mesmo PDF e acha o da nota certa", async () => {
  const { lerDactes, cteDaNota } = await import("../src/lib/cte.ts");
  const outro = `DACTE\n 35.2610.00.564.267/0002-92-57-002-000.727.538-100.175.975-6\n VALOR A RECEBER (R$)   145,76\n NF-E: 35261015324813000104550010000166701300700009`;
  const ctes = lerDactes(`DACTE\n${DACTE}\nDACTE\n${DACTE}\n${outro}\nDACTE\n${outro}`);
  assert.equal(ctes.length, 2);
  assert.equal(cteDaNota(ctes, "35261000574422000170550010000130801293016607").valor, 144.83);
  assert.equal(cteDaNota(ctes, "35261015324813000104550010000166701300700009").numero, "727538");
  assert.throws(() => cteDaNota(ctes, "x"));
});
