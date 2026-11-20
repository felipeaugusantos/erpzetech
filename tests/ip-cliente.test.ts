import assert from "node:assert/strict";
import test from "node:test";

import { ipDoCliente, origemDoIpConfigurada } from "../src/lib/ip-cliente.ts";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

test("padrão (Cloudflare): usa cf-connecting-ip e, sem ele, o ÚLTIMO item do x-forwarded-for", () => {
  assert.equal(ipDoCliente(h({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" })), "198.51.100.7");
  assert.equal(ipDoCliente(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" })), "203.0.113.9");
  assert.equal(ipDoCliente(h({})), null);
});

test("proxy próprio (nginx): ignora cf-connecting-ip, que o cliente poderia forjar", () => {
  assert.equal(
    ipDoCliente(h({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), "proxy"),
    "203.0.113.9",
  );
});

test("nenhum: não confia em cabeçalho algum", () => {
  assert.equal(ipDoCliente(h({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }), "nenhum"), null);
});

test("IP_ORIGEM desconhecido volta ao padrão", () => {
  assert.equal(origemDoIpConfigurada("xpto"), "cloudflare");
  assert.equal(origemDoIpConfigurada(" PROXY "), "proxy");
  assert.equal(origemDoIpConfigurada(undefined), "cloudflare");
});
