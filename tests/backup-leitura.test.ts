import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TAMANHO_PAGINA_BACKUP } from "../src/lib/backup-tenant.ts";
import { contarCliente, lerPaginaDoCliente } from "../src/lib/backup-tenant.server.ts";

// Banco de mentira: registra os filtros que a leitura aplicou e devolve linhas prontas.
type Chamada = {
  tabela: string;
  filtros: [string, unknown][];
  ordem: string[];
  faixa?: [number, number];
  limite?: number;
};

function bancoFalso(linhasPorTabela: Record<string, Record<string, unknown>[]>) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string) {
      return {
        select(_colunas: string, opcoes?: { count: "exact"; head: true }) {
          const c: Chamada = { tabela, filtros: [], ordem: [] };
          chamadas.push(c);
          const q: Record<string, unknown> = {
            eq: (col: string, v: unknown) => (c.filtros.push([`eq:${col}`, v]), q),
            in: (col: string, v: unknown) => (c.filtros.push([`in:${col}`, v]), q),
            gt: (col: string, v: unknown) => (c.filtros.push([`gt:${col}`, v]), q),
            order: (col: string) => (c.ordem.push(col), q),
            range: (a: number, b: number) => ((c.faixa = [a, b]), q),
            limit: (n: number) => ((c.limite = n), q),
            then: (ok: (r: unknown) => unknown) =>
              ok({
                data: opcoes ? null : (linhasPorTabela[tabela] ?? []),
                error: null,
                count: (linhasPorTabela[tabela] ?? []).length,
              }),
          };
          return q;
        },
      };
    },
  };
  return { db: db as never, chamadas };
}

const T = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";

describe("backup por cliente: a leitura sempre filtra pelo cliente", () => {
  it("tabela comum filtra por tenant_id e lê por cursor de id", async () => {
    const { db, chamadas } = bancoFalso({ pedidos: [{ id: "a" }, { id: "b" }] });
    const r = await lerPaginaDoCliente(db, {
      tenantId: T,
      empresaIds: [E1],
      tabela: "pedidos",
      cursor: "z0",
    });
    assert.deepEqual(chamadas[0]!.filtros, [
      ["eq:tenant_id", T],
      ["gt:id", "z0"],
    ]);
    assert.deepEqual(chamadas[0]!.ordem, ["id"]);
    assert.equal(chamadas[0]!.limite, TAMANHO_PAGINA_BACKUP);
    assert.equal(r.proximo, null); // página incompleta: acabou
    assert.equal(r.registros.length, 2);
  });

  it("página cheia devolve o último id como próximo cursor", async () => {
    const cheia = Array.from({ length: TAMANHO_PAGINA_BACKUP }, (_, i) => ({ id: `id${i}` }));
    const { db } = bancoFalso({ pedidos: cheia });
    const r = await lerPaginaDoCliente(db, {
      tenantId: T,
      empresaIds: [],
      tabela: "pedidos",
      cursor: null,
    });
    assert.equal(r.proximo, `id${TAMANHO_PAGINA_BACKUP - 1}`);
  });

  it("tenants filtra pelo id; módulos liberados, pelas empresas do cliente; sem empresas nada casa", async () => {
    const a = bancoFalso({});
    await lerPaginaDoCliente(a.db, {
      tenantId: T,
      empresaIds: [E1],
      tabela: "tenants",
      cursor: null,
    });
    assert.deepEqual(a.chamadas[0]!.filtros, [["eq:id", T]]);

    const b = bancoFalso({});
    await lerPaginaDoCliente(b.db, {
      tenantId: T,
      empresaIds: [E1],
      tabela: "empresa_modulos_liberados",
      cursor: null,
    });
    assert.deepEqual(b.chamadas[0]!.filtros, [["in:empresa_id", [E1]]]);
    assert.deepEqual(b.chamadas[0]!.ordem, ["empresa_id", "modulo"]);

    const c = bancoFalso({});
    await lerPaginaDoCliente(c.db, {
      tenantId: T,
      empresaIds: [],
      tabela: "empresa_modulos_liberados",
      cursor: null,
    });
    assert.deepEqual(c.chamadas[0]!.filtros, [["in:empresa_id", [T]]]); // nunca um "in" vazio
  });

  it("tabela sem id lê por posição", async () => {
    const { db, chamadas } = bancoFalso({ wa_config: [{ tenant_id: T }] });
    await lerPaginaDoCliente(db, {
      tenantId: T,
      empresaIds: [],
      tabela: "wa_config",
      cursor: "1000",
    });
    assert.deepEqual(chamadas[0]!.faixa, [1000, 1000 + TAMANHO_PAGINA_BACKUP - 1]);
    await assert.rejects(
      lerPaginaDoCliente(db, { tenantId: T, empresaIds: [], tabela: "wa_config", cursor: "-5" }),
      /Posição inválida/,
    );
  });

  it("os segredos são retirados de cada linha", async () => {
    const { db } = bancoFalso({
      cobranca_config: [
        { tenant_id: T, provedor: "x", api_key: "SEGREDO", webhook_token_hash: "H" },
      ],
      fiscal_config: [{ id: "1", nfse_token: "SEGREDO", regime: "simples" }],
    });
    const a = await lerPaginaDoCliente(db, {
      tenantId: T,
      empresaIds: [],
      tabela: "cobranca_config",
      cursor: null,
    });
    assert.deepEqual(a.registros, [{ tenant_id: T, provedor: "x" }]);
    const b = await lerPaginaDoCliente(db, {
      tenantId: T,
      empresaIds: [],
      tabela: "fiscal_config",
      cursor: null,
    });
    assert.deepEqual(b.registros, [{ id: "1", regime: "simples" }]);
    assert.ok(!JSON.stringify([a, b]).includes("SEGREDO"));
  });

  it("a contagem também filtra pelo cliente em todas as tabelas", async () => {
    const { db, chamadas } = bancoFalso({ pedidos: [{ id: "a" }] });
    const r = await contarCliente(db, T, [E1]);
    assert.equal(r.find((x) => x.tabela === "pedidos")!.linhas, 1);
    for (const c of chamadas) {
      const ok = c.filtros.some(
        ([k, v]) =>
          (k === "eq:tenant_id" && v === T) ||
          (k === "eq:id" && v === T && c.tabela === "tenants") ||
          (k === "in:empresa_id" && c.tabela === "empresa_modulos_liberados"),
      );
      assert.ok(ok, `${c.tabela} sem filtro do cliente`);
    }
  });
});
