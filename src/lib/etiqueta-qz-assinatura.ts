/**
 * Regras de quando o servidor aceita assinar uma requisição do QZ Tray. Quem tem a assinatura imprime
 * no computador do caixa sem pedir autorização, então só assinamos o que o sistema realmente pede:
 * listar impressoras e imprimir comando cru (nunca arquivo, imagem, PDF, USB, etc.).
 */
export const LIMITE_MENSAGEM_QZ = 2_000_000;
/** Tolerância entre o relógio do computador e o do servidor. */
export const TOLERANCIA_QZ_MS = 15 * 60 * 1000;

const CHAMADAS_LIBERADAS = new Set(["printers.find", "printers.getDefault", "print"]);
const FLAVORS_CRUS = new Set(["base64", "plain"]);

export type ResultadoValidacaoQz = { ok: true } | { ok: false; motivo: string };

const objeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validarMensagemQz(mensagem: string, agora = Date.now()): ResultadoValidacaoQz {
  if (typeof mensagem !== "string" || mensagem.length === 0) return { ok: false, motivo: "vazia" };
  if (mensagem.length > LIMITE_MENSAGEM_QZ) return { ok: false, motivo: "grande demais" };
  let m: unknown;
  try {
    m = JSON.parse(mensagem);
  } catch {
    return { ok: false, motivo: "não é JSON" };
  }
  if (!objeto(m)) return { ok: false, motivo: "formato inesperado" };
  const { call, params, timestamp } = m;
  if (typeof call !== "string" || !CHAMADAS_LIBERADAS.has(call)) {
    return { ok: false, motivo: "chamada não liberada" };
  }
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(agora - t) > TOLERANCIA_QZ_MS) {
    return { ok: false, motivo: "fora do prazo" };
  }
  if (call === "print") {
    if (
      !objeto(params) ||
      !objeto(params["printer"]) ||
      typeof params["printer"]["name"] !== "string"
    ) {
      return { ok: false, motivo: "impressora ausente" };
    }
    const dados = params["data"];
    if (!Array.isArray(dados) || dados.length === 0) return { ok: false, motivo: "sem dados" };
    for (const d of dados) {
      if (
        !objeto(d) ||
        d["type"] !== "raw" ||
        d["format"] !== "command" ||
        typeof d["flavor"] !== "string" ||
        !FLAVORS_CRUS.has(d["flavor"].toLowerCase()) ||
        typeof d["data"] !== "string"
      ) {
        return { ok: false, motivo: "só comando cru é liberado" };
      }
    }
  }
  return { ok: true };
}

/** Chave PEM guardada em variável de ambiente costuma vir com "\n" escrito; devolve com quebras de linha de verdade. */
export const normalizarPem = (v: string) => v.trim().replace(/\\n/g, "\n");
