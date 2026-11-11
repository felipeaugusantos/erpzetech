import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import {
  lerPaginaBackup,
  listarBackupCliente,
  tabelaDoBackup,
  type PaginaBackup,
  type TabelaContada,
} from "./backup-tenant";

// Backup por cliente: só a equipe Ze Tech lê. A leitura usa o serviço (sem RLS) e SEMPRE filtra pelo cliente pedido
// (ver backup-tenant.server.ts). O download manual devolve uma página por vez e o navegador da equipe monta o arquivo;
// os backups da rotina noturna ficam no bucket privado e só abrem por link temporário, que fica registrado.

async function exigirOperador(supabase: {
  rpc: (n: "eh_saas_operador") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("eh_saas_operador");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Área exclusiva da equipe Ze Tech.");
}

export const listarClientesBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirOperador(context.supabase);
    const { bancoDoBackup } = await import("./backup-tenant.server");
    const db = await bancoDoBackup();
    const [tenants, empresas, backups] = await Promise.all([
      db.from("tenants").select("id, nome, ativo").order("nome").limit(5000),
      db.from("empresas").select("tenant_id, ramo_atividade").limit(20000),
      db
        .from("backup_execucoes")
        .select("tenant_id, dia")
        .eq("situacao", "concluido")
        .order("dia", { ascending: false })
        .limit(50000),
    ]);
    if (tenants.error || empresas.error || backups.error)
      throw new Error("Não foi possível consultar os clientes.");
    const ramos = new Map<string, Set<string>>();
    for (const e of empresas.data ?? []) {
      const id = String(e["tenant_id"]);
      if (!ramos.has(id)) ramos.set(id, new Set());
      if (e["ramo_atividade"]) ramos.get(id)!.add(String(e["ramo_atividade"]));
    }
    const ultimo = new Map<string, string>();
    for (const b of backups.data ?? []) {
      const id = String(b["tenant_id"]);
      if (!ultimo.has(id)) ultimo.set(id, String(b["dia"]));
    }
    return {
      clientes: (tenants.data ?? []).map((t) => ({
        tenantId: String(t["id"]),
        nome: String(t["nome"] ?? "Sem nome"),
        ativo: t["ativo"] !== false,
        ramos: [...(ramos.get(String(t["id"])) ?? [])].sort(),
        ultimoBackup: ultimo.get(String(t["id"])) ?? null,
      })),
    };
  });

export const contarBackupClienteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listarBackupCliente>) => listarBackupCliente.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    const { bancoDoBackup, dadosDoCliente, contarCliente } = await import("./backup-tenant.server");
    const db = await bancoDoBackup();
    const cliente = await dadosDoCliente(db, data.tenantId);
    const tabelas: TabelaContada[] = await contarCliente(db, data.tenantId, cliente.empresaIds);
    return { nome: cliente.nome, tabelas };
  });

export const lerPaginaBackupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof lerPaginaBackup>) => lerPaginaBackup.parse(input))
  .handler(async ({ data, context }): Promise<PaginaBackup> => {
    await exigirOperador(context.supabase);
    if (!tabelaDoBackup(data.tabela)) throw new Error("Tabela fora do backup.");
    const { bancoDoBackup, dadosDoCliente, lerPaginaDoCliente } =
      await import("./backup-tenant.server");
    const db = await bancoDoBackup();
    const cliente = await dadosDoCliente(db, data.tenantId);
    return lerPaginaDoCliente(db, {
      tenantId: data.tenantId,
      empresaIds: cliente.empresaIds,
      tabela: data.tabela,
      cursor: data.cursor,
    });
  });

async function registrarNaAuditoria(
  tenantId: string,
  userId: string,
  valor: Record<string, unknown>,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("auditoria").insert({
    tenant_id: tenantId,
    usuario_id: userId,
    entidade: "backup_cliente",
    operacao: "exportacao",
    valor_novo: { ...valor, origem: "equipe_ze_tech" } as never,
  });
  if (error) throw new Error("Não foi possível registrar o backup.");
}

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
    await registrarNaAuditoria(data.tenantId, context.userId, {
      tabelas: data.tabelas,
      linhas: data.linhas,
    });
    return { ok: true as const };
  });

export const listarBackupsGuardadosFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listarBackupCliente>) => listarBackupCliente.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    const { bancoDoBackup } = await import("./backup-tenant.server");
    const db = await bancoDoBackup();
    const r = await db
      .from("backup_execucoes")
      .select("id, dia, tipos, situacao, tamanho, tabelas, linhas, erro")
      .eq("tenant_id", data.tenantId)
      .order("dia", { ascending: false })
      .limit(60);
    if (r.error) throw new Error("Não foi possível consultar os backups guardados.");
    return {
      backups: (r.data ?? []).map((b) => ({
        id: String(b["id"]),
        dia: String(b["dia"]),
        tipos: (b["tipos"] as string[] | null) ?? [],
        situacao: String(b["situacao"]),
        tamanho: b["tamanho"] === null ? null : Number(b["tamanho"]),
        linhas: b["linhas"] === null ? null : Number(b["linhas"]),
        erro: b["erro"] ? String(b["erro"]) : null,
      })),
    };
  });

/** link temporário (5 minutos) para um backup guardado; cada link gerado fica na auditoria do cliente */
export const urlBackupGuardadoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { execucaoId: string }) =>
    z.object({ execucaoId: z.guid("Backup inválido.") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    const { bancoDoBackup, BUCKET_BACKUPS } = await import("./backup-tenant.server");
    const db = await bancoDoBackup();
    const r = await db
      .from("backup_execucoes")
      .select("tenant_id, dia, caminho, linhas")
      .eq("id", data.execucaoId)
      .eq("situacao", "concluido");
    const exec = r.data?.[0];
    if (r.error || !exec || !exec["caminho"]) throw new Error("Backup não encontrado ou expirado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const link = await supabaseAdmin.storage
      .from(BUCKET_BACKUPS)
      .createSignedUrl(String(exec["caminho"]), 300, {
        download: `backup-${exec["dia"]}.ndjson.gz`,
      });
    if (link.error || !link.data?.signedUrl) throw new Error("Não foi possível gerar o link.");
    await registrarNaAuditoria(String(exec["tenant_id"]), context.userId, {
      dia: String(exec["dia"]),
      linhas: Number(exec["linhas"] ?? 0),
      guardado: true,
    });
    return { url: link.data.signedUrl };
  });
