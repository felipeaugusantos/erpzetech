import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  completarDriveInput,
  DRIVE_SCOPES,
  GATEWAY_DRIVE,
  exigirAdministradorBackup,
} from "./backup-drive";
import { politicaDoCliente } from "./backup-rotina";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function tenantAdministrador(db: SupabaseClient<Database>, userId: string) {
  const [perfil, role] = await Promise.all([
    db.from("profiles").select("ativo,tenant_id").eq("id", userId).single(),
    db.rpc("has_role", { _user_id: userId, _role: "administrador" }),
  ]);
  if (perfil.error || role.error) throw new Error("Não foi possível conferir seu acesso.");
  return exigirAdministradorBackup(perfil.data, role.data === true);
}

export const estadoBackupDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await tenantAdministrador(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [config, execucoes, empresas] = await Promise.all([
      db
        .from("backup_drive_config")
        .select("ativo,reconectar,pasta_id,erro,user_id")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("backup_drive_execucoes")
        .select("dia,situacao,tamanho,erro,concluido_em")
        .eq("tenant_id", tenantId)
        .order("dia", { ascending: false })
        .limit(60),
      context.supabase.from("empresas").select("ramo_atividade").eq("tenant_id", tenantId),
    ]);
    if (config.error || execucoes.error || empresas.error)
      throw new Error("Não foi possível consultar os backups.");
    return {
      config: config.data
        ? {
            ativo: config.data.ativo,
            reconectar: config.data.reconectar,
            pastaId: config.data.pasta_id,
            erro: config.data.erro,
            propria: config.data.user_id === context.userId,
          }
        : null,
      execucoes: execucoes.data ?? [],
      politica: politicaDoCliente((empresas.data ?? []).map((e) => e.ramo_atividade ?? "")),
    };
  });

export const iniciarBackupDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await tenantAdministrador(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { hashDrive } = await import("./backup-drive-crypto.server");
    const config = await db
      .from("backup_drive_config")
      .select("user_id,lease_expira")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (config.error) throw config.error;
    if (config.data && config.data.user_id !== context.userId)
      throw new Error(
        "A conexão pertence a outro administrador; ele precisa desconectá-la primeiro.",
      );
    if (config.data?.lease_expira && new Date(config.data.lease_expira).getTime() > Date.now())
      throw new Error("Aguarde o envio em andamento terminar.");
    const nonce = crypto.randomUUID() + crypto.randomUUID();
    const saved = await db.from("backup_drive_config").upsert(
      {
        tenant_id: tenantId,
        user_id: context.userId,
        nonce_hash: hashDrive(nonce),
        nonce_expira: new Date(Date.now() + 600000).toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (saved.error) throw new Error("Esta conta já tem uma conexão de backup em outro cliente.");
    const request = getRequest();
    if (!request) throw new Error("Solicitação não disponível.");
    const url = new URL(request.url);
    const host = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL(
      "/api/public/oauth/backup-drive/return",
      host ? `https://${host}` : url.origin,
    );
    returnUrl.searchParams.set("nonce", nonce);
    const clientAPIKey = process.env["GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientAPIKey) throw new Error("Google Drive não configurado.");
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    return authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_DRIVE,
      connectorId: "google_drive",
      appUserId: context.userId,
      clientAPIKey,
      returnUrl: returnUrl.toString(),
      credentialsConfiguration: { scopes: DRIVE_SCOPES },
      responseMode: "redirect",
    });
  });

export const completarBackupDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => completarDriveInput.parse(input))
  .handler(async ({ context, data }) => {
    const tenantId = await tenantAdministrador(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { hashDrive, cifrarDrive } = await import("./backup-drive-crypto.server");
    // Atomically consume the pending connect, bound to the real account and tenant.
    const consumed = await db
      .from("backup_drive_config")
      .update({ nonce_hash: null, nonce_expira: null })
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .eq("nonce_hash", hashDrive(data.nonce))
      .gt("nonce_expira", new Date().toISOString())
      .select("pasta_id")
      .maybeSingle();
    if (consumed.error || !consumed.data)
      throw new Error("Autorização expirada ou inválida. Conecte novamente.");
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
      GATEWAY_DRIVE,
      data.code,
    );
    if (connectorId !== "google_drive") throw new Error("Conexão de outro serviço recusada.");
    // Always save a newly issued key, including on reconnect.
    const saved = await db
      .from("backup_drive_config")
      .update({
        connection_key_ciphertext: cifrarDrive(connectionAPIKey),
        reconectar: false,
        ativo: false,
        atualizado_em: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (saved.error) throw new Error("Não foi possível guardar a conexão.");
    const { criarPastaDrive, chamadaDrive } = await import("./backup-drive.server");
    let pasta = consumed.data.pasta_id;
    if (pasta) {
      try {
        const res = await chamadaDrive(
          connectionAPIKey,
          `/drive/v3/files/${encodeURIComponent(pasta)}?fields=id,trashed,appProperties`,
        );
        const meta = (await res.json()) as {
          trashed?: boolean;
          appProperties?: { erpTenant?: string };
        };
        if (meta.trashed || meta.appProperties?.erpTenant !== tenantId) pasta = null;
      } catch {
        pasta = null;
      }
    }
    if (!pasta) pasta = await criarPastaDrive(connectionAPIKey, tenantId);
    const ready = await db
      .from("backup_drive_config")
      .update({ pasta_id: pasta, ativo: true, erro: null })
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (ready.error) throw ready.error;
    return { ok: true };
  });

export const alterarBackupDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ acao: z.enum(["pausar", "ativar", "desconectar"]) })
      .strict()
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const tenantId = await tenantAdministrador(context.supabase, context.userId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const config = await db
      .from("backup_drive_config")
      .select("user_id,connection_key_ciphertext,pasta_id,reconectar,lease_expira")
      .eq("tenant_id", tenantId)
      .single();
    if (config.error || config.data.user_id !== context.userId)
      throw new Error("Somente quem conectou esta conta pode alterá-la.");
    if (config.data.lease_expira && new Date(config.data.lease_expira).getTime() > Date.now())
      throw new Error("Aguarde o envio em andamento terminar.");
    if (
      data.acao === "ativar" &&
      (!config.data.pasta_id || !config.data.connection_key_ciphertext || config.data.reconectar)
    )
      throw new Error("Reconecte o Drive primeiro.");
    if (data.acao === "desconectar" && config.data.connection_key_ciphertext) {
      const { decifrarDrive } = await import("./backup-drive-crypto.server");
      const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_DRIVE,
        connectorId: "google_drive",
        connectionAPIKey: decifrarDrive(config.data.connection_key_ciphertext),
      });
    }
    const result =
      data.acao === "desconectar"
        ? await db
            .from("backup_drive_config")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("user_id", context.userId)
        : await db
            .from("backup_drive_config")
            .update({ ativo: data.acao === "ativar" })
            .eq("tenant_id", tenantId)
            .eq("user_id", context.userId);
    if (result.error) throw result.error;
    return { ok: true };
  });
