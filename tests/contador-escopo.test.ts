import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conferirNotaDoContador,
  exigirContador,
  intervaloDoMes,
  recusarContador,
} from "../src/lib/contador-escopo.ts";

const acessoOk = { empresa_id: "e1", empresa_nome: "F1", cnpj: "1", pode_editar_tributos: false };
const rpc = (resposta: { data: unknown; error: unknown }) => ({ rpc: async () => resposta });

test("exigirContador: um acesso ativo passa, vazio (revogado) ou erro recusam", async () => {
  assert.equal((await exigirContador(rpc({ data: [acessoOk], error: null }))).empresa_id, "e1");
  await assert.rejects(() => exigirContador(rpc({ data: [], error: null })), /revogado/);
  await assert.rejects(() => exigirContador(rpc({ data: null, error: null })), /revogado/);
  await assert.rejects(
    () => exigirContador(rpc({ data: null, error: { message: "x" } })),
    /conferir/,
  );
  await assert.rejects(
    () => exigirContador(rpc({ data: [acessoOk, { ...acessoOk, empresa_id: "e2" }], error: null })),
    /revogado/,
  );
});

test("conferirNotaDoContador: só nota da empresa autorizada, autorizada ou cancelada, com id do emissor", () => {
  const nota = {
    empresa_id: "e1",
    situacao: "autorizada",
    provider_id: "p1",
    chave: "k",
    ambiente: "producao",
  };
  assert.deepEqual(conferirNotaDoContador(nota, acessoOk), {
    providerId: "p1",
    chave: "k",
    ambiente: "producao",
  });
  assert.equal(
    conferirNotaDoContador({ ...nota, situacao: "cancelada" }, acessoOk).providerId,
    "p1",
  );
  // outra empresa (mesmo com id de emissor válido), empresa nula, rascunho, nota inexistente: mesma mensagem
  for (const ruim of [
    { ...nota, empresa_id: "e2" },
    { ...nota, empresa_id: null },
    { ...nota, situacao: "rascunho" },
    { ...nota, situacao: "pronta" },
    null,
  ]) {
    assert.throws(() => conferirNotaDoContador(ruim, acessoOk), /Nota fiscal não encontrada/);
  }
  assert.throws(
    () => conferirNotaDoContador({ ...nota, provider_id: null }, acessoOk),
    /ainda não está disponível/,
  );
  // ambiente desconhecido não vira produção
  assert.equal(
    conferirNotaDoContador({ ...nota, ambiente: "x" }, acessoOk).ambiente,
    "homologacao",
  );
});

test("recusarContador: só passa quando o banco responde claramente que não é contador", async () => {
  await recusarContador(rpc({ data: false, error: null }));
  await assert.rejects(() => recusarContador(rpc({ data: true, error: null })), /não tem acesso/);
  await assert.rejects(() => recusarContador(rpc({ data: null, error: null })), /não tem acesso/);
  await assert.rejects(
    () => recusarContador(rpc({ data: false, error: { message: "x" } })),
    /não tem acesso/,
  );
});

test("intervaloDoMes: janeiro a dezembro e formatos inválidos", () => {
  assert.deepEqual(intervaloDoMes("2026-11"), { inicio: "2026-11-01", fim: "2026-12-01" });
  assert.deepEqual(intervaloDoMes("2026-12"), { inicio: "2026-12-01", fim: "2027-01-01" });
  for (const ruim of ["2026-13", "2026-00", "26-11", "2026-11-01", "", "'; drop"]) {
    assert.throws(() => intervaloDoMes(ruim), /AAAA-MM/);
  }
});
