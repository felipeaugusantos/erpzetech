import { z } from "zod";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
export const GATEWAY_DRIVE = "https://connector-gateway.lovable.dev";
export const completarDriveInput = z
  .object({ code: z.string().min(1).max(4096), nonce: z.string().min(32).max(128) })
  .strict();

export function janelaNoturnaDrive(agora: Date): boolean {
  const hora = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(agora),
  );
  return hora >= 2 && hora < 5;
}

export function exigirAdministradorBackup(
  perfil: { ativo?: boolean; tenant_id?: string | null } | null,
  administrador: boolean,
): string {
  if (!perfil?.ativo || !perfil.tenant_id || !administrador)
    throw new Error("Somente o administrador pode configurar o backup da empresa.");
  return perfil.tenant_id;
}

export function nomeBackupDrive(tenantId: string, dia: string): string {
  return `erp-${tenantId}-${dia}.ndjson.gz`;
}
