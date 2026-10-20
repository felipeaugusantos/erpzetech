import assert from "node:assert/strict";
import { test } from "node:test";
import { obrasLiberadasEmpresa } from "../src/lib/modulos-empresa.ts";

test("Obras fica liberada por exceção sem perder o ramo de roupas", () => {
  assert.equal(obrasLiberadasEmpresa({ ramo_atividade: "roupas", modulos_liberados: ["obras"] }), true);
  assert.equal(obrasLiberadasEmpresa({ ramo_atividade: "roupas", modulos_liberados: [] }), false);
  assert.equal(obrasLiberadasEmpresa({ ramo_atividade: "construcao" }), true);
});