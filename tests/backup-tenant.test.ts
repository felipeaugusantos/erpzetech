import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  COLUNAS_FORA_DO_BACKUP,
  ORDEM_BACKUP,
  TABELAS_BACKUP,
  TABELAS_FORA_DO_BACKUP,
  TAMANHO_PAGINA_BACKUP,
  coletarBackup,
  type RegistroBackup,
  colunasDaTabela,
  escopoDaTabela,
  grupoDaTabela,
  leCursorPorId,
  linhaManifesto,
  linhasDaTabela,
  lerPaginaBackup,
  montarManifesto,
  nomeArquivoBackup,
  ordemDaTabela,
} from "../src/lib/backup-tenant.ts";

// colunas de cada tabela, lidas do esquema gerado do banco
function esquema(): Map<string, string[]> {
  const s = readFileSync(new URL("../src/integrations/supabase/types.ts", import.meta.url), "utf8");
  const bloco = s.slice(s.indexOf("Tables: {"), s.indexOf("Views: {"));
  const partes = bloco.split(/\n {6}(\w+): \{\n {8}Row: \{/);
  const mapa = new Map<string, string[]>();
  for (let i = 1; i < partes.length; i += 2) {
    const row = partes[i + 1]!.split("Insert: {")[0]!;
    mapa.set(
      partes[i]!,
      [...row.matchAll(/\n {10}(\w+)\??:/g)].map((m) => m[1]!),
    );
  }
  return mapa;
}

describe("backup por cliente: catálogo contra o esquema do banco", () => {
  const tabelas = esquema();

  it("toda tabela com tenant_id entra no backup ou está na lista de fora, com motivo", () => {
    const comTenant = [...tabelas].filter(([, c]) => c.includes("tenant_id")).map(([t]) => t);
    const sem = comTenant.filter(
      (t) => !TABELAS_BACKUP.includes(t) && !(t in TABELAS_FORA_DO_BACKUP),
    );
    assert.deepEqual(sem, [], `tabelas novas fora do catálogo do backup: ${sem.join(", ")}`);
  });

  it("não há tabela repetida nem ao mesmo tempo dentro e fora", () => {
    assert.equal(new Set(TABELAS_BACKUP).size, TABELAS_BACKUP.length);
    for (const t of Object.keys(TABELAS_FORA_DO_BACKUP)) assert.ok(!TABELAS_BACKUP.includes(t), t);
  });

  it("todas as tabelas do catálogo existem e têm a coluna de escopo do cliente", () => {
    for (const t of TABELAS_BACKUP) {
      const cols = tabelas.get(t);
      assert.ok(cols, `tabela inexistente no esquema: ${t}`);
      const escopo = escopoDaTabela(t);
      if (escopo === "tenant") assert.ok(cols.includes("tenant_id"), `${t} sem tenant_id`);
      if (escopo === "empresa") assert.ok(cols.includes("empresa_id"), `${t} sem empresa_id`);
      if (escopo === "tenants") assert.ok(cols.includes("id"), `${t} sem id`);
    }
    for (const t of Object.keys(TABELAS_FORA_DO_BACKUP)) assert.ok(tabelas.has(t), t);
  });

  it("toda ordem de leitura aponta para colunas que existem", () => {
    for (const t of TABELAS_BACKUP) {
      const cols = tabelas.get(t)!;
      for (const c of ordemDaTabela(t)) assert.ok(cols.includes(c), `${t}.${c} não existe`);
    }
    for (const t of Object.keys(ORDEM_BACKUP)) assert.ok(TABELAS_BACKUP.includes(t), t);
  });

  it("tabela sem coluna id tem ordem própria declarada", () => {
    for (const t of TABELAS_BACKUP)
      if (!tabelas.get(t)!.includes("id")) assert.ok(t in ORDEM_BACKUP, `${t} precisa de ordem`);
  });

  it("colunas de segredo existem e saem do pacote", () => {
    for (const [t, fora] of Object.entries(COLUNAS_FORA_DO_BACKUP)) {
      assert.ok(TABELAS_BACKUP.includes(t), t);
      for (const c of fora) assert.ok(tabelas.get(t)!.includes(c), `${t}.${c}`);
      const resto = colunasDaTabela(t, tabelas.get(t)!);
      for (const c of fora) assert.ok(!resto.includes(c));
    }
  });

  it("nenhuma coluna de segredo conhecida fica de fora da lista de exclusão", () => {
    const suspeita = /(^|_)(senha|token|secret|api_key|password|hash)(_|$)/;
    for (const t of TABELAS_BACKUP) {
      for (const c of tabelas.get(t)!) {
        if (!suspeita.test(c)) continue;
        // senha da comanda é a senha de retirada do cliente, não uma credencial
        if (t === "comandas" && (c === "senha" || c === "senha_data")) continue;
        assert.ok(
          COLUNAS_FORA_DO_BACKUP[t]?.includes(c),
          `${t}.${c} parece segredo e entra no backup`,
        );
      }
    }
  });
});

describe("backup por cliente: regras", () => {
  it("escopo, grupo e tipo de cursor", () => {
    assert.equal(escopoDaTabela("tenants"), "tenants");
    assert.equal(escopoDaTabela("empresa_modulos_liberados"), "empresa");
    assert.equal(escopoDaTabela("pedidos"), "tenant");
    assert.equal(grupoDaTabela("pet_internacoes"), "clinica");
    assert.equal(grupoDaTabela("lr_ordens"), "lava_rapido");
    assert.equal(grupoDaTabela("nfe_itens"), "fiscal");
    assert.equal(grupoDaTabela("pedidos"), "base");
    assert.equal(leCursorPorId("pedidos"), true);
    assert.equal(leCursorPorId("wa_config"), false);
  });

  it("a entrada da leitura recusa id de cliente inválido", () => {
    assert.ok(
      lerPaginaBackup.safeParse({ tenantId: "x", tabela: "pedidos", cursor: null }).success ===
        false,
    );
    assert.ok(
      lerPaginaBackup.safeParse({
        tenantId: "11111111-1111-1111-1111-111111111111",
        tabela: "pedidos",
        cursor: null,
      }).success,
    );
  });

  it("nome do arquivo sem acento nem símbolo", () => {
    assert.equal(
      nomeArquivoBackup("Clínica Ão & Cia!", new Date("2026-11-10T12:00:00Z")),
      "backup-clinica-ao-cia-2026-11-10.ndjson.gz",
    );
    assert.equal(
      nomeArquivoBackup("###", new Date("2026-01-02T00:00:00Z")),
      "backup-cliente-2026-01-02.ndjson.gz",
    );
  });

  it("manifesto soma as linhas e o arquivo é NDJSON", () => {
    const m = montarManifesto({
      tenantId: "t",
      nome: "Cliente",
      geradoEm: new Date("2026-11-10T00:00:00Z"),
      geradoPor: "equipe_ze_tech",
      tabelas: [
        { tabela: "a", linhas: 2 },
        { tabela: "b", linhas: 3 },
      ],
    });
    assert.equal(m.total_linhas, 5);
    assert.ok(m.avisos.length > 0);
    const l = linhaManifesto(m);
    assert.ok(l.endsWith("\n"));
    assert.equal(JSON.parse(l).manifesto.formato, "ezra-backup-cliente");
    assert.equal(
      linhasDaTabela("a", [{ x: 1 }, { x: 2 }]),
      '{"t":"a","d":{"x":1}}\n{"t":"a","d":{"x":2}}\n',
    );
  });
});

describe("backup por cliente: leitura por páginas", () => {
  it("segue o cursor até o fim, soma por tabela e ignora tabela vazia no manifesto", async () => {
    const paginas: Record<string, { registros: RegistroBackup[]; proximo: string | null }[]> = {
      pedidos: [
        { registros: [{ id: 1 }, { id: 2 }], proximo: "2" },
        { registros: [{ id: 3 }], proximo: null },
      ],
      clientes: [{ registros: [], proximo: null }],
    };
    const chamadas: string[] = [];
    const progresso: number[] = [];
    const r = await coletarBackup({
      tabelas: ["pedidos", "clientes"],
      lerPagina: async (t, cursor) => {
        chamadas.push(`${t}:${cursor}`);
        return paginas[t]![cursor === null ? 0 : 1]!;
      },
      aoProgredir: (p) => progresso.push(p.linhasTotal),
    });
    assert.deepEqual(chamadas, ["pedidos:null", "pedidos:2", "clientes:null"]);
    assert.deepEqual(r.tabelas, [{ tabela: "pedidos", linhas: 3 }]);
    assert.equal(r.partes.join("").split("\n").filter(Boolean).length, 3);
    assert.deepEqual(progresso, [2, 3]);
  });

  it("recusa tabela fora do catálogo, cursor que não avança e cancelamento", async () => {
    await assert.rejects(
      coletarBackup({
        tabelas: ["saas_clientes"],
        lerPagina: async () => ({ registros: [], proximo: null }),
      }),
      /fora do catálogo/,
    );
    await assert.rejects(
      coletarBackup({
        tabelas: ["pedidos"],
        lerPagina: async () => ({ registros: [{ id: 1 }], proximo: "1" }),
      }),
      /não avançou/,
    );
    await assert.rejects(
      coletarBackup({
        tabelas: ["pedidos"],
        lerPagina: async () => ({ registros: [], proximo: null }),
        cancelado: () => true,
      }),
      /cancelado/,
    );
    assert.ok(TAMANHO_PAGINA_BACKUP > 0);
  });
});
