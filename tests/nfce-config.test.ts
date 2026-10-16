import assert from "node:assert/strict";
import test from "node:test";

import { faltaParaEmitir, validarConfigNfce } from "../src/lib/nfce-config.ts";

const ok = { serie: "1", cscId: "1", cscToken: "ABCDEF0123456789abcd" };

test("configuração completa é aceita", () => {
  assert.equal(validarConfigNfce(ok, false), null);
});

test("série precisa ser número de 0 a 999", () => {
  assert.match(validarConfigNfce({ ...ok, serie: "" }, false) ?? "", /série/);
  assert.match(validarConfigNfce({ ...ok, serie: "1000" }, false) ?? "", /série/);
  assert.match(validarConfigNfce({ ...ok, serie: "-1" }, false) ?? "", /série/);
  assert.equal(validarConfigNfce({ ...ok, serie: "0" }, false), null);
});

test("código do CSC: só números, até 6", () => {
  assert.match(validarConfigNfce({ ...ok, cscId: "abc" }, false) ?? "", /código/);
  assert.match(validarConfigNfce({ ...ok, cscId: "1234567" }, false) ?? "", /código/);
  assert.equal(validarConfigNfce({ ...ok, cscId: "000001" }, false), null);
});

test("token: 16 a 40 letras e números", () => {
  assert.match(validarConfigNfce({ ...ok, cscToken: "curto" }, false) ?? "", /token/);
  assert.match(validarConfigNfce({ ...ok, cscToken: "COM-SIMBOLO-1234567" }, false) ?? "", /token/);
  assert.match(validarConfigNfce({ ...ok, cscToken: "A".repeat(41) }, false) ?? "", /token/);
});

test("token em branco só vale se já existe um guardado", () => {
  assert.match(validarConfigNfce({ ...ok, cscToken: "" }, false) ?? "", /token/);
  assert.equal(validarConfigNfce({ ...ok, cscToken: "" }, true), null);
});

test("pode salvar só a série e a contingência, sem CSC nenhum", () => {
  assert.equal(validarConfigNfce({ serie: "2", cscId: "", cscToken: "" }, false), null);
  assert.match(
    validarConfigNfce({ serie: "2", cscId: "", cscToken: "ABCDEF0123456789abcd" }, false) ?? "",
    /código/,
  );
  assert.match(validarConfigNfce({ serie: "2", cscId: "", cscToken: "" }, true) ?? "", /código/);
});

test("faltaParaEmitir lista o que ainda não está configurado", () => {
  assert.deepEqual(
    faltaParaEmitir({ csc_configurado: true, certificado_nome: "a.pfx", emissor: "acbr" }),
    [],
  );
  assert.deepEqual(
    faltaParaEmitir({ csc_configurado: false, certificado_nome: null, emissor: null }),
    ["CSC (código e token)", "certificado digital A1", "emissor fiscal"],
  );
});
