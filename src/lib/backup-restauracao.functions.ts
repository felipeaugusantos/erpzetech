import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { listarBackupCliente } from "./backup-tenant";
import {
  conferirIds,
  pontoDeSegurancaValido,
  restaurarLote,
  tabelaRestauravel,
  MOTIVO_NAO_RESTAURAVEL,
} from "./backup-restauracao";

// Restauração assistida: só a equipe Ze Tech. Só devolve linhas de cadastro que FALTAM (nunca sobrescreve nem apaga) e só
// depois de um backup do estado atual feito nas últimas 24 horas (ponto de segurança). Tudo fica na auditoria do cliente.

async function exigirOperador(supabase: {
  rpc: (n: "eh_saas_operador") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("eh_saas_operador");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Área exclusiva da equipe Ze Tech.");
}

/** quais ids ainda existem hoje no cliente: a conferência (sem gravar nada) compara com o arquivo */
export const conferirIdsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof conferirIds>) => conferirIds.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    if (!tabelaRestauravel(data.tabela)) throw new Error(MOTIVO_NAO_RESTAURAVEL);
    const { bancoDoBackup } = await import("./backup-tenant.server");
    const db = await bancoDoBackup();
    const r = await db
      .from(data.tabela)
      .select("id")
      .eq("tenant_id", data.tenantId)
      .in("id", data.ids);
    if (r.error) throw new Error(`Não foi possível conferir ${data.tabela}.`);
    return { existentes: (r.data ?? []).map((l) => String(l["id"])) };
  });

export const estadoPontoDeSegurancaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listarBackupCliente>) => listarBackupCliente.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    return { valido: await pontoValido(data.tenantId) };
  });

async function pontoValido(tenantId: string): Promise<boolean> {
  const { bancoDoBackup } = await import("./backup-tenant.server");
  const db = await bancoDoBackup();
  const r = await db
    .from("backup_execucoes")
    .select("concluido_em")
    .eq("tenant_id", tenantId)
    .eq("situacao", "concluido")
    .order("concluido_em", { ascending: false })
    .limit(1);
  if (r.error) throw new Error("Não foi possível consultar os backups do cliente.");
  const ultimo = r.data?.[0]?.["concluido_em"];
  return pontoDeSegurancaValido(ultimo ? String(ultimo) : null, new Date());
}

/** gera agora o backup do estado atual (o ponto de segurança); se já há um do dia, ele vale */
export const gerarPontoDeSegurancaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof listarBackupCliente>) => listarBackupCliente.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    if (await pontoValido(data.tenantId)) return { valido: true as const };
    const { gerarBackupDoCliente } = await import("./backup-tenant.server");
    const { diaDeBrasilia } = await import("./backup-rotina");
    const r = await gerarBackupDoCliente(data.tenantId, diaDeBrasilia(new Date()));
    if (r.situacao === "erro") throw new Error(r.erro ?? "Não foi possível gerar o backup.");
    return { valido: await pontoValido(data.tenantId) };
  });

export const restaurarLoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof restaurarLote>) => restaurarLote.parse(input))
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    if (!tabelaRestauravel(data.tabela)) throw new Error(MOTIVO_NAO_RESTAURAVEL);
    if (!(await pontoValido(data.tenantId)))
      throw new Error("Gere um backup deste cliente (ponto de segurança) antes de restaurar.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc as unknown as (
      nome: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    const r = await rpc.call(supabaseAdmin, "backup_restaurar_tabela", {
      p_tenant: data.tenantId,
      p_tabela: data.tabela,
      p_linhas: data.registros,
      p_usuario: context.userId,
    });
    if (r.error) throw new Error(`Falha ao restaurar ${data.tabela}: ${r.error.message}`);
    const x = r.data as { enviadas: number; inseridas: number; ja_existiam: number };
    return { enviadas: x.enviadas, inseridas: x.inseridas, jaExistiam: x.ja_existiam };
  });
