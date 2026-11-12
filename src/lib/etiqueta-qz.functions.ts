import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { normalizarPem, validarMensagemQz } from "@/lib/etiqueta-qz-assinatura";

/**
 * Assinatura das requisições do QZ Tray, para ele confiar no sistema sem pedir autorização a cada impressão.
 * O certificado (público) fica em QZ_CERTIFICADO e a chave privada em QZ_CHAVE_PRIVADA, só no servidor.
 * Sem as duas variáveis o envio continua funcionando, sem assinatura (o QZ Tray pede autorização).
 */
export const certificadoQz = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ certificado: string | null }> => {
    const cert = process.env["QZ_CERTIFICADO"];
    const chave = process.env["QZ_CHAVE_PRIVADA"];
    return { certificado: cert && chave ? normalizarPem(cert) : null };
  });

export const assinarQz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { mensagem: string }) => ({ mensagem: String(d?.mensagem ?? "") }))
  .handler(async ({ data }): Promise<{ assinatura: string }> => {
    const chave = process.env["QZ_CHAVE_PRIVADA"];
    if (!chave) throw new Error("A assinatura do QZ Tray não está configurada.");
    const v = validarMensagemQz(data.mensagem);
    if (!v.ok) throw new Error(`Requisição do QZ Tray recusada (${v.motivo}).`);
    const { createSign } = await import("node:crypto");
    const s = createSign("RSA-SHA512");
    s.update(data.mensagem, "utf8");
    s.end();
    return { assinatura: s.sign(normalizarPem(chave), "base64") };
  });
