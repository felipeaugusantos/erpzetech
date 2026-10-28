// Senha dos avisos do Evolution: derivada da instância com um segredo do servidor, então vale só para aquela instância
// e nada precisa ser guardado no banco.
import { createHmac, timingSafeEqual } from "node:crypto";

export function tokenDoWebhook(segredo: string, instancia: string) {
  return createHmac("sha256", segredo).update(`webhook:${instancia}`).digest("hex");
}

export function tokenConfere(segredo: string, instancia: string, informado: string | null) {
  if (!informado) return false;
  const esperado = Buffer.from(tokenDoWebhook(segredo, instancia));
  const recebido = Buffer.from(informado);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
