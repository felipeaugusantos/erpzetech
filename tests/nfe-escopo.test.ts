import assert from "node:assert/strict";
import { test } from "node:test";
import {
  carregarNota,
  cnpjsDaEmpresa,
  exigirPapelFiscal,
  filtrarPorCnpj,
} from "../src/lib/nfe-escopo.ts";

type Dados = {
  papeis: string[];
  perfil: { tenant_id: string | null; empresa_id: string | null } | null;
  nota: Record<string, unknown> | null;
  empresas?: { cnpj: string | null }[];
};

/** Cliente de mentira: responde só o que a conferência pergunta. */
function falso(d: Dados) {
  return {
    rpc: async (_nome: string, args: { _role: string }) => ({
      data: d.papeis.includes(args._role),
    }),
    from: (tabela: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- o falso devolve a si mesmo, como o cliente de verdade
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: tabela === "profiles" ? d.perfil : tabela === "nfe" ? d.nota : null,
          error: null,
        }),
        then: (ok: (v: unknown) => unknown) =>
          ok({ data: tabela === "empresas" ? (d.empresas ?? []) : [], error: null }),
      };
      return q;
    },
  };
}

const nota = { id: "n1", tenant_id: "t1", empresa_id: "e1" };
const perfil = { tenant_id: "t1", empresa_id: "e1" };

test("motorista, vendedor e estoquista não operam nota fiscal", async () => {
  for (const papel of ["motorista", "vendedor", "estoquista", "caixa"]) {
    await assert.rejects(
      carregarNota(falso({ papeis: [papel], perfil, nota }), "n1", "u1"),
      /Somente administrador, gestor ou financeiro/,
    );
  }
});

test("administrador, gestor e financeiro leem a nota da própria empresa", async () => {
  for (const papel of ["administrador", "gestor", "financeiro"]) {
    const r = await carregarNota(falso({ papeis: [papel], perfil, nota }), "n1", "u1");
    assert.equal(r.id, "n1");
  }
});

test("nota de outra empresa não aparece nem para quem tem papel fiscal", async () => {
  await assert.rejects(
    carregarNota(
      falso({ papeis: ["administrador"], perfil, nota: { ...nota, tenant_id: "t2" } }),
      "n1",
      "u1",
    ),
    /Nota fiscal não encontrada/,
  );
  await assert.rejects(
    carregarNota(
      falso({ papeis: ["administrador"], perfil, nota: { ...nota, empresa_id: "e9" } }),
      "n1",
      "u1",
    ),
    /Nota fiscal não encontrada/,
  );
});

test("nota que não existe", async () => {
  await assert.rejects(
    carregarNota(falso({ papeis: ["gestor"], perfil, nota: null }), "n1", "u1"),
    /Nota fiscal não encontrada/,
  );
});

test("perfil sem empresa vinculada", async () => {
  await assert.rejects(
    exigirPapelFiscal(falso({ papeis: ["gestor"], perfil: null, nota }), "u1"),
    /Perfil sem empresa vinculada/,
  );
});

test("a conta compartilhada do emissor mostra só as empresas do cliente", async () => {
  const todas = [
    { cpfCnpj: "11.222.333/0001-81", nome: "Minha Loja" },
    { cpfCnpj: "44555666000199", nome: "Outro Cliente" },
    { cpfCnpj: "", nome: "Sem CNPJ" },
  ];
  const meus = await cnpjsDaEmpresa(
    falso({ papeis: [], perfil, nota, empresas: [{ cnpj: "11.222.333/0001-81" }, { cnpj: null }] }),
    "t1",
  );
  assert.deepEqual(meus, ["11222333000181"]);
  assert.deepEqual(
    filtrarPorCnpj(todas, meus).map((e) => e.nome),
    ["Minha Loja"],
  );
  assert.deepEqual(filtrarPorCnpj(todas, []), []);
});
