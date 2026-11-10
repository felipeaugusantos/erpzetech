import { createHash } from "node:crypto";
import { callAsAppUser, appUserReconnectRequired } from "@/integrations/lovable/appUserConnector";
import { decifrarDrive } from "./backup-drive-crypto.server";
import { DRIVE_SCOPES, GATEWAY_DRIVE, janelaNoturnaDrive, nomeBackupDrive } from "./backup-drive";
import {
  diaDeBrasilia,
  politicaDoCliente,
  selecionarParaApagar,
  tiposDoDia,
} from "./backup-rotina";

export class FalhaDrive extends Error {
  constructor(
    public status: number,
    public reconectar: boolean,
    message: string,
  ) {
    super(message);
  }
}
export async function chamadaDrive(
  key: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_DRIVE,
    connectorId: "google_drive",
    connectionAPIKey: key,
    path,
    init: { ...init, signal: AbortSignal.timeout(60000) },
    requiredScopes: DRIVE_SCOPES,
  });
  if (!res.ok) {
    const reconectar = await appUserReconnectRequired(res);
    const text = await res.text();
    // Raw provider errors remain server-side, not stored in browser-readable data.
    console.error(`Google Drive [${res.status}]: ${text}`);
    throw new FalhaDrive(
      res.status,
      reconectar,
      reconectar
        ? "Reconecte o Google Drive para retomar os backups."
        : `Google Drive recusou a operação (${res.status}).`,
    );
  }
  return res;
}
export async function criarPastaDrive(key: string, tenantId: string): Promise<string> {
  const res = await chamadaDrive(key, "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `ERP Ze Tech — ${tenantId}`,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { erpTenant: tenantId },
    }),
  });
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Não foi possível criar a pasta de backup.");
  return data.id;
}
export async function rodadaDrive(agora = new Date()) {
  if (!janelaNoturnaDrive(agora)) return { enviados: 0, foraDoHorario: true };
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const dia = diaDeBrasilia(agora);
  const configs = await db
    .from("backup_drive_config")
    .select("tenant_id,user_id,pasta_id,connection_key_ciphertext")
    .eq("ativo", true)
    .eq("reconectar", false);
  if (configs.error) throw configs.error;
  const feitos = await db
    .from("backup_drive_execucoes")
    .select("tenant_id,situacao,tentativas")
    .eq("dia", dia);
  if (feitos.error) throw feitos.error;
  const fila = (configs.data ?? []).filter(
    (c) =>
      !(feitos.data ?? []).some(
        (e) =>
          e.tenant_id === c.tenant_id &&
          (e.situacao === "concluido" || e.situacao === "expirado" || e.tentativas >= 3),
      ),
  );
  let enviados = 0;
  for (const c of fila.slice(0, 3)) {
    if (!c.pasta_id || !c.connection_key_ciphertext) continue;
    const local = await db
      .from("backup_execucoes")
      .select("caminho,tamanho")
      .eq("tenant_id", c.tenant_id)
      .eq("dia", dia)
      .eq("situacao", "concluido")
      .maybeSingle();
    if (local.error) throw local.error;
    if (!local.data?.caminho) continue; // Use only completed tenant exports; never copy unrelated storage files.
    const reserva = await db.rpc("backup_drive_reservar", {
      p_tenant: c.tenant_id,
      p_dia: dia,
      p_tipos: tiposDoDia(dia),
    });
    if (reserva.error) throw reserva.error;
    if (!reserva.data) continue;
    const token = reserva.data;
    try {
      const key = decifrarDrive(c.connection_key_ciphertext);
      if ((local.data.tamanho ?? 0) > 50 * 1024 * 1024)
        throw new Error("Cópia acima de 50 MB: envio requer revisão da equipe Ze Tech.");
      const file = await db.storage.from("backups-clientes").download(local.data.caminho);
      if (file.error || !file.data)
        throw new Error("Não foi possível ler a cópia concluída do cliente.");
      if (file.data.size > 50 * 1024 * 1024)
        throw new Error("Cópia acima de 50 MB: envio requer revisão da equipe Ze Tech.");
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      const md5 = createHash("md5").update(bytes).digest("hex");
      const q = `'${c.pasta_id.replace(/'/g, "\\'")}' in parents and trashed=false and appProperties has { key='erpTenant' and value='${c.tenant_id}' } and appProperties has { key='erpDay' and value='${dia}' }`;
      const search = await chamadaDrive(
        key,
        `/drive/v3/files?fields=files(id,md5Checksum,size)&q=${encodeURIComponent(q)}&pageSize=100`,
      );
      const existing = (await search.json()) as {
        files?: { id: string; md5Checksum?: string; size?: string }[];
      };
      let remote = existing.files?.find(
        (f) => f.md5Checksum === md5 && Number(f.size) === bytes.length,
      );
      if (!remote) {
        const boundary = `erp_${crypto.randomUUID()}`;
        const metadata = {
          name: nomeBackupDrive(c.tenant_id, dia),
          parents: [c.pasta_id],
          appProperties: { erpTenant: c.tenant_id, erpDay: dia },
        };
        const body = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
          bytes,
          `\r\n--${boundary}--\r\n`,
        ]);
        const upload = await chamadaDrive(
          key,
          "/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum,size",
          {
            method: "POST",
            headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
            body,
          },
        );
        remote = (await upload.json()) as { id: string; md5Checksum?: string; size?: string };
      }
      if (!remote?.id || remote.md5Checksum !== md5 || Number(remote.size) !== bytes.length)
        throw new Error("A cópia enviada não passou na conferência de integridade.");
      const saved = await db
        .from("backup_drive_execucoes")
        .update({
          situacao: "concluido",
          arquivo_id: remote.id,
          tamanho: bytes.length,
          md5,
          concluido_em: new Date().toISOString(),
          erro: null,
        })
        .eq("tenant_id", c.tenant_id)
        .eq("dia", dia);
      if (saved.error) throw saved.error;
      enviados++;
      // Retention applies only after an upload is verified, and only to tracked files in this tenant's folder.
      const empresas = await db
        .from("empresas")
        .select("ramo_atividade")
        .eq("tenant_id", c.tenant_id);
      const historico = await db
        .from("backup_drive_execucoes")
        .select("id,dia,tipos,situacao,arquivo_id")
        .eq("tenant_id", c.tenant_id)
        .eq("situacao", "concluido");
      if (empresas.error || historico.error) throw new Error("Falha ao consultar retenção.");
      const apagar = selecionarParaApagar(
        historico.data ?? [],
        politicaDoCliente((empresas.data ?? []).map((e) => e.ramo_atividade ?? "")),
      );
      for (const e of (historico.data ?? []).filter((e) => apagar.includes(e.id)).slice(0, 10)) {
        if (!e.arquivo_id) continue;
        const info = await chamadaDrive(
          key,
          `/drive/v3/files/${encodeURIComponent(e.arquivo_id)}?fields=parents,appProperties`,
        );
        const meta = (await info.json()) as {
          parents?: string[];
          appProperties?: { erpTenant?: string };
        };
        if (!meta.parents?.includes(c.pasta_id) || meta.appProperties?.erpTenant !== c.tenant_id)
          throw new Error("Arquivo fora da pasta de backup: limpeza bloqueada.");
        await chamadaDrive(key, `/drive/v3/files/${encodeURIComponent(e.arquivo_id)}`, {
          method: "DELETE",
        });
        const expired = await db
          .from("backup_drive_execucoes")
          .update({ situacao: "expirado" })
          .eq("id", e.id)
          .eq("tenant_id", c.tenant_id);
        if (expired.error) throw expired.error;
      }
      await db
        .from("backup_drive_config")
        .update({ erro: null })
        .eq("tenant_id", c.tenant_id)
        .eq("lease_id", token);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Falha no envio ao Drive.";
      await db
        .from("backup_drive_execucoes")
        .update({ situacao: "erro", erro: mensagem })
        .eq("tenant_id", c.tenant_id)
        .eq("dia", dia)
        .neq("situacao", "concluido");
      await db
        .from("backup_drive_config")
        .update({
          erro: mensagem,
          ...(error instanceof FalhaDrive && error.reconectar ? { reconectar: true } : {}),
          ...(error instanceof FalhaDrive && [402, 403].includes(error.status)
            ? { ativo: false }
            : {}),
        })
        .eq("tenant_id", c.tenant_id)
        .eq("lease_id", token);
    } finally {
      await db
        .from("backup_drive_config")
        .update({ lease_id: null, lease_expira: null })
        .eq("tenant_id", c.tenant_id)
        .eq("lease_id", token);
    }
  }
  return { enviados, pendentes: Math.max(0, fila.length - enviados) };
}
