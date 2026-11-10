import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TABELAS_BACKUP,
  TAMANHO_PAGINA_BACKUP,
  COLUNAS_FORA_DO_BACKUP,
  escopoDaTabela,
  grupoDaTabela,
  leCursorPorId,
  lerPaginaBackup,
  listarBackupCliente,
  ordemDaTabela,
  tabelaDoBackup,
  type PaginaBackup,
  type RegistroBackup,
  type TabelaContada,
} from "./backup-tenant";

// Backup por cliente: só a equipe Ze Tech lê. A leitura usa o serviço (sem RLS) e SEMPRE filtra pelo cliente pedido;
// o servidor devolve uma página por vez e o navegador da equipe monta o arquivo (nada é guardado no servidor).

async function exigirOperador(supabase: {
  rpc: (n: "eh_saas_operador") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("eh_saas_operador");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Área exclusiva da equipe Ze Tech.");
}

type Resposta = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
  count?: number | null;
};
type Consulta = PromiseLike<Resposta> & {
  eq(coluna: string, valor: unknown): Consulta;
  in(coluna: string, valores: unknown[]): Consulta;
  gt(coluna: string, valor: unknown): Consulta;
  order(coluna: string): Consulta;
  range(de: number, ate: number): Consulta;
  limit(n: number): Consulta;
};
type Banco = {
  from(tabela: string): {
    select(colunas: string, opcoes?: { count: "exact"; head: true }): Consulta;
  };
};

async function banco(): Promise<Banco> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Banco;
}

async function dadosDoCliente(db: Banco, tenantId: string) {
  const t = await db.from("tenants").select("id, nome").eq("id", tenantId);
  if (t.error) throw new Error("Não foi possível consultar o cliente.");
  const cliente = t.data?.[0];
  if (!cliente) throw new Error("Cliente não encontrado.");
  const e = await db.from("empresas").select("id").eq("tenant_id", tenantId);
  if (e.error) throw new Error("Não foi possível consultar as empresas do cliente.");
  return {
    nome: String(cliente["nome"] ?? "Cliente"),
    empresaIds: (e.data ?? []).map((x) => String(x["id"])),
  };
}

function filtrarPorCliente(
  q: Consulta,
  tabela: string,
  tenantId: string,
  empresaIds: string[],
): Consulta {
  const escopo = escopoDaTabela(tabela);
  if (escopo === "tenants") return q.eq("id", tenantId);
  // sem empresas, nenhuma linha pode casar: o filtro "in" vazio é trocado por um id que não existe
  if (escopo === "empresa")
    return q.in("empresa_id", empresaIds.length > 0 ? empresaIds : [tenantId]);
  return q.eq("tenant_id", tenantId);
}

export const listarClientesBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirOperador(context.supabase);
    const db = await banco();
    const [tenants, empresas] = await Promise.all([
      db.from("tenants").select("id, nome, ativo").order("nome").limit(5000),
      db.from("empresas").select("tenant_id, ramo_atividade").limit(20000),
    ]);
    if (tenants.error || empresas.error) throw new Error("Não foi possível consultar os clientes.");
    const ramos = new Map<string, Set<string>>();
    for (const e of empresas.data ?? []) {
      const id = String(e["tenant_id"]);
      if (!ramos.has(id)) ramos.set(id, new Set());
      if (e["ramo_atividade"]) ramos.get(id)!.add(String(e["ramo_atividade"]));
    }
    return {
      clientes: (tenants.data ?? []).map((t) => ({
        tenantId: String(t["id"]),
        nome: String(t["nome"] ?? "Sem nome"),
        ativo: t["ativo"] !== false,
        ramos: [...(ramos.get(String(t["id"])) ?? [])].sort(),
      })),
    };
  });

export const contarBackupClienteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listarBackupCliente>) => listarBackupCliente.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    const db = await banco();
    const cliente = await dadosDoCliente(db, data.tenantId);
    const tabelas: TabelaContada[] = [];
    // em lotes, para não abrir centenas de consultas ao mesmo tempo
    for (let i = 0; i < TABELAS_BACKUP.length; i += 20) {
      const lote = TABELAS_BACKUP.slice(i, i + 20);
      const contagens = await Promise.all(
        lote.map(async (tabela) => {
          const r = await filtrarPorCliente(
            db.from(tabela).select("*", { count: "exact", head: true }),
            tabela,
            data.tenantId,
            cliente.empresaIds,
          );
          if (r.error) throw new Error(`Não foi possível contar ${tabela}.`);
          return { tabela, grupo: grupoDaTabela(tabela), linhas: r.count ?? 0 };
        }),
      );
      tabelas.push(...contagens);
    }
    return { nome: cliente.nome, tabelas };
  });

export const lerPaginaBackupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof lerPaginaBackup>) => lerPaginaBackup.parse(input))
  .handler(async ({ data, context }): Promise<PaginaBackup> => {
    await exigirOperador(context.supabase);
    if (!tabelaDoBackup(data.tabela)) throw new Error("Tabela fora do backup.");
    const db = await banco();
    const cliente = await dadosDoCliente(db, data.tenantId);
    const ordem = ordemDaTabela(data.tabela);
    const porId = leCursorPorId(data.tabela);
    let q = filtrarPorCliente(
      db.from(data.tabela).select("*"),
      data.tabela,
      data.tenantId,
      cliente.empresaIds,
    );
    for (const c of ordem) q = q.order(c);
    let inicio = 0;
    if (porId) {
      if (data.cursor !== null) q = q.gt("id", data.cursor);
      q = q.limit(TAMANHO_PAGINA_BACKUP);
    } else {
      inicio = data.cursor === null ? 0 : Number.parseInt(data.cursor, 10);
      if (!Number.isInteger(inicio) || inicio < 0) throw new Error("Posição inválida.");
      q = q.range(inicio, inicio + TAMANHO_PAGINA_BACKUP - 1);
    }
    const r = await q;
    if (r.error) throw new Error(`Não foi possível ler ${data.tabela}.`);
    const fora = new Set(COLUNAS_FORA_DO_BACKUP[data.tabela] ?? []);
    const registros = (r.data ?? []).map(
      (linha) =>
        Object.fromEntries(
          Object.entries(linha).filter(([coluna]) => !fora.has(coluna)),
        ) as RegistroBackup,
    );
    const cheia = (r.data ?? []).length === TAMANHO_PAGINA_BACKUP;
    const ultimo = r.data?.[r.data.length - 1];
    const proximo = !cheia
      ? null
      : porId
        ? String(ultimo?.["id"] ?? "")
        : String(inicio + TAMANHO_PAGINA_BACKUP);
    return { registros, proximo: proximo === "" ? null : proximo };
  });

export const registrarBackupClienteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; tabelas: number; linhas: number }) =>
    z
      .object({
        tenantId: z.guid("Cliente inválido."),
        tabelas: z.number().int().min(0).max(1000),
        linhas: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("auditoria").insert({
      tenant_id: data.tenantId,
      usuario_id: context.userId,
      entidade: "backup_cliente",
      operacao: "exportacao",
      valor_novo: { tabelas: data.tabelas, linhas: data.linhas, origem: "equipe_ze_tech" },
    });
    if (error) throw new Error("Não foi possível registrar o backup.");
    return { ok: true as const };
  });
