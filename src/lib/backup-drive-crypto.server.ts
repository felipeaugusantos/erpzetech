import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function chave() {
  const raw = process.env["APP_USER_CONNECTION_KEY_SECRET"];
  if (!raw) throw new Error("A proteção da conexão ainda não está configurada.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error("Configuração de proteção inválida.");
  return bytes;
}
export function cifrarDrive(valor: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chave(), iv);
  const ct = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}
export function decifrarDrive(valor: string): string {
  const bytes = Buffer.from(valor, "base64");
  const cipher = createDecipheriv("aes-256-gcm", chave(), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
}
export const hashDrive = (valor: string) => createHash("sha256").update(valor).digest("hex");