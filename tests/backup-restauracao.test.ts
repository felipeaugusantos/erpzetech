import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TABELAS_BACKUP,
  linhaFim,
  linhaManifesto,
  linhasDaTabela,
  montarManifesto,
} from "../src/lib/backup-tenant.ts";
import {
  TABELAS_RESTAURAVEIS,
  confirmacaoConfere,
  emLotes,
  lerArquivoBackup,
  montarPlano,
  pontoDeSegurancaValido,
  restaurarLote,
  tabelaRestauravel,
} from "../src/lib/backup-restauracao.ts";

const T = "11111111-1111-4111-8111-111111111111";
const OUTRO = "99999999-9999-4999-8999-999999999999";

function arquivo(p: {
  tenant?: string;
  tabelas: Record<string, Record<string, unknown>[]>;
  comFim?: boolean;
  fimTotal?: number;
}): string {
  const tabelas = Object.entries(p.tabelas).map(([tabela, l]) => ({ tabela, linhas: l.length }));
  const m = montarManifesto({
    tenantId: p.tenant ?? T,
    nome: "Cliente",
    geradoEm: new Date("2026-11-10T00:00:00Z"),
    geradoPor: "rotina_noturna",
    tabelas,
  });
  let s = linhaManifesto(m);
  for (const [t, l] of Object.entries(p.tabelas)) s += linhasDaTabela(t, l);
  if (p.comFim !== false) {
    const fim = linhaFim(tabelas);
    s +=
      p.fimTotal === undefined
        ? fim
        : fim.replace(/"total_linhas":\d+/, `"total_linhas":${p.fimTotal}`);
  }
  return s;
}

const FORN = (id: string) => ({ id, tenant_id: T, razao_social: "F " + id });

describe("restauração: lista de tabelas restauráveis", () => {
  it("é um subconjunto do backup, sem repetição", () => {
    assert.equal(new Set(TABELAS_RESTAURAVEIS).size, TABELAS_RESTAURAVEIS.length);
    for (const t of TABELAS_RESTAURAVEIS) assert.ok(TABELAS_BACKUP.includes(t), t);
  });

  it("a função do banco aceita exatamente as mesmas tabelas, na mesma ordem", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20261231000000_backup_restauracao.sql", import.meta.url),
      "utf8",
    );
    const lista = /permitidas constant text\[\] := ARRAY\[([^\]]+)\]/.exec(sql)![1]!;
    const noBanco = [...lista.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(noBanco, [...TABELAS_RESTAURAVEIS]);
  });

  it("nunca inclui acessos, permissões, integrações, vendas, estoque, financeiro, fiscal nem prontuário", () => {
    const proibidas =
      /^(user_roles|role_permissoes|profiles|empresas|tenants|link_acesso_usuarios|portal_|clinica_acessos|gestor_autorizacoes|wa_|tef_|cobranca_|fiscal_|nfce_|nfe|pedido|caixa|estoque|financeiro_|contas_|banco_|compra|devolucao|comanda|auditoria|pet_atendimento|pet_exame|pet_documento|pet_internac|sngpc_|hs_|locacoes|os_)/;
    for (const t of TABELAS_RESTAURAVEIS)
      assert.ok(!proibidas.test(t), `${t} não pode ser restaurável`);
  });

  it("toda tabela restaurável tem id e tenant_id no esquema", () => {
    const s = readFileSync(
      new URL("../src/integrations/supabase/types.ts", import.meta.url),
      "utf8",
    );
    const bloco = s.slice(s.indexOf("Tables: {"), s.indexOf("Views: {"));
    const partes = bloco.split(/\n {6}(\w+): \{\n {8}Row: \{/);
    const cols = new Map<string, string[]>();
    for (let i = 1; i < partes.length; i += 2) {
      const row = partes[i + 1]!.split("Insert: {")[0]!;
      cols.set(
        partes[i]!,
        [...row.matchAll(/\n {10}(\w+)\??:/g)].map((m) => m[1]!),
      );
    }
    for (const t of TABELAS_RESTAURAVEIS) {
      assert.ok(cols.get(t)?.includes("id"), `${t} sem id`);
      assert.ok(cols.get(t)?.includes("tenant_id"), `${t} sem tenant_id`);
    }
  });

  it("nenhuma tabela restaurável tem coluna de segredo fora do backup", () => {
    for (const t of ["cobranca_config", "fiscal_config", "nfce_config"])
      assert.ok(!tabelaRestauravel(t));
  });
});

describe("restauração: leitura e conferência do arquivo", () => {
  it("arquivo íntegro do cliente certo é aceito", () => {
    const r = lerArquivoBackup(arquivo({ tabelas: { fornecedores: [FORN("a"), FORN("b")] } }), T);
    assert.deepEqual(r.problemas, []);
    assert.equal(r.totalLinhas, 2);
    assert.equal(r.registros.get("fornecedores")!.length, 2);
  });

  it("backup de outro cliente é bloqueado, mesmo que as linhas estejam certas", () => {
    const r = lerArquivoBackup(
      arquivo({ tenant: OUTRO, tabelas: { fornecedores: [FORN("a")] } }),
      T,
    );
    assert.ok(r.problemas.some((p) => /outro cliente/.test(p)));
  });

  it("linha com tenant_id de outro cliente é recusada", () => {
    const r = lerArquivoBackup(
      arquivo({
        tabelas: { fornecedores: [{ id: "x", tenant_id: OUTRO, razao_social: "Intruso" }] },
      }),
      T,
    );
    assert.ok(r.problemas.some((p) => /pertence a outro cliente/.test(p)));
    assert.equal(r.totalLinhas, 0);
  });

  it("arquivo cortado (sem a linha final) ou com contagem errada é recusado", () => {
    const base = { tabelas: { fornecedores: [FORN("a"), FORN("b")] } };
    assert.ok(
      lerArquivoBackup(arquivo({ ...base, comFim: false }), T).problemas.some((p) =>
        /cortado/.test(p),
      ),
    );
    assert.ok(
      lerArquivoBackup(arquivo({ ...base, fimTotal: 5 }), T).problemas.some((p) =>
        /5 linhas/.test(p),
      ),
    );
  });

  it("sem manifesto, JSON quebrado, tabela fora do catálogo e coluna de segredo são problemas", () => {
    assert.ok(
      lerArquivoBackup('{"t":"fornecedores","d":{}}\n', T).problemas.some((p) =>
        /manifesto/.test(p),
      ),
    );
    const quebrado = arquivo({ tabelas: { fornecedores: [FORN("a")] } }) + "{isto não é json\n";
    assert.ok(lerArquivoBackup(quebrado, T).problemas.some((p) => /JSON/.test(p)));
    const fora = arquivo({ tabelas: { saas_clientes: [{ id: "1", tenant_id: T }] } });
    assert.ok(lerArquivoBackup(fora, T).problemas.some((p) => /não faz parte do backup/.test(p)));
    const segredo = arquivo({ tabelas: { cobranca_config: [{ tenant_id: T, api_key: "X" }] } });
    assert.ok(lerArquivoBackup(segredo, T).problemas.some((p) => /nunca deveria sair/.test(p)));
  });

  it("versão mais nova que a conhecida e formato desconhecido são recusados", () => {
    const novo = arquivo({ tabelas: { fornecedores: [FORN("a")] } }).replace(
      '"versao":1',
      '"versao":99',
    );
    assert.ok(lerArquivoBackup(novo, T).problemas.some((p) => /Versão/.test(p)));
    const outro = arquivo({ tabelas: { fornecedores: [FORN("a")] } }).replace(
      "ezra-backup-cliente",
      "outra-coisa",
    );
    assert.ok(lerArquivoBackup(outro, T).problemas.some((p) => /Formato/.test(p)));
  });

  it("a lista de problemas tem limite, para arquivo muito ruim não travar a tela", () => {
    const lixo = Array.from({ length: 200 }, () => "{x").join("\n");
    assert.ok(lerArquivoBackup(lixo, T).problemas.length <= 20);
  });
});

describe("restauração: plano", () => {
  it("separa o que falta do que já existe, na ordem de dependência, e lista o que é ignorado", () => {
    const leitura = lerArquivoBackup(
      arquivo({
        tabelas: {
          produtos: [{ id: "p1", tenant_id: T }],
          fornecedores: [FORN("a"), FORN("b"), FORN("c")],
          pedidos: [{ id: "v1", tenant_id: T }],
        },
      }),
      T,
    );
    const plano = montarPlano(leitura, new Map([["fornecedores", new Set(["a"])]]));
    assert.deepEqual(
      plano.tabelas.map((t) => t.tabela),
      ["fornecedores", "produtos"], // fornecedores vem antes de produtos
    );
    const forn = plano.tabelas[0]!;
    assert.equal(forn.noArquivo, 3);
    assert.equal(forn.jaExistem, 1);
    assert.deepEqual(
      forn.ausentes.map((l) => l["id"]),
      ["b", "c"],
    );
    assert.equal(plano.totalAusentes, 3);
    assert.deepEqual(plano.ignoradas, [{ tabela: "pedidos", linhas: 1 }]);
  });

  it("lotes respeitam o tamanho e a entrada do servidor recusa lote grande ou tabela com id inválido", () => {
    assert.deepEqual(emLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.ok(
      restaurarLote.safeParse({ tenantId: T, tabela: "fornecedores", registros: [{ id: "a" }] })
        .success,
    );
    assert.ok(
      !restaurarLote.safeParse({ tenantId: "x", tabela: "fornecedores", registros: [{ id: "a" }] })
        .success,
    );
    assert.ok(
      !restaurarLote.safeParse({
        tenantId: T,
        tabela: "fornecedores",
        registros: Array.from({ length: 301 }, () => ({ id: "a" })),
      }).success,
    );
  });
});

describe("restauração: confirmações", () => {
  it("o nome do cliente precisa ser digitado igual (sem diferenciar caixa nem espaços repetidos)", () => {
    assert.ok(confirmacaoConfere("  clínica   do Zé ", "Clínica do Zé"));
    assert.ok(!confirmacaoConfere("Clínica do Ze", "Clínica do Zé"));
    assert.ok(!confirmacaoConfere("", ""));
  });

  it("ponto de segurança vale por 24 horas e nunca no futuro", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    assert.ok(pontoDeSegurancaValido("2026-11-10T03:00:00Z", agora));
    assert.ok(!pontoDeSegurancaValido("2026-11-09T11:59:00Z", agora));
    assert.ok(!pontoDeSegurancaValido("2026-11-11T00:00:00Z", agora));
    assert.ok(!pontoDeSegurancaValido(null, agora));
    assert.ok(!pontoDeSegurancaValido("lixo", agora));
  });
});
