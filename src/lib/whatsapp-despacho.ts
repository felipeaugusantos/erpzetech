// Regras do envio automático de WhatsApp, sem banco nem rede: texto final, espera entre tentativas e ritmo de envio.
import { MENSAGEM_LAVA_PADRAO, montarMensagemLava, type TipoAviso } from "./lava-rapido.ts";

export const RODAPE_SAIR = "\n\nPara não receber mais avisos, responda SAIR.";

/** Tentativas por mensagem e espera (em minutos) antes de cada nova tentativa. */
export const ESPERA_TENTATIVAS_MIN = [2, 10, 30] as const;
export const MAX_TENTATIVAS = ESPERA_TENTATIVAS_MIN.length;

/** Texto enviado ao cliente: o modelo da empresa (ou o padrão), com as variáveis e o aviso de como sair. */
export function textoDoAviso(
  tipo: TipoAviso,
  variaveis: Parameters<typeof montarMensagemLava>[1],
  modelo?: string | null,
) {
  const base = modelo && modelo.trim() ? modelo : MENSAGEM_LAVA_PADRAO[tipo];
  return montarMensagemLava(base, variaveis).trim() + RODAPE_SAIR;
}

/** Quando tentar de novo depois da falha número `tentativa` (1, 2, …). null = esgotou, a mensagem fica como falha. */
export function proximaTentativaEm(tentativa: number, agora: Date = new Date()): Date | null {
  const min = ESPERA_TENTATIVAS_MIN[tentativa - 1];
  return min === undefined ? null : new Date(agora.getTime() + min * 60_000);
}

/** Tempo de "digitando…" antes do envio, entre 1,5 e 4 segundos, para o envio não sair em rajada. */
export function atrasoDeEnvio(aleatorio: () => number = Math.random) {
  return Math.round(1500 + aleatorio() * 2500);
}

/** Dentro do horário comercial de envio (8h às 20h, horário de Brasília)? Avisos fora dele esperam. */
export function dentroDoHorario(agora: Date = new Date()) {
  const h = (agora.getUTCHours() + 24 - 3) % 24;
  return h >= 8 && h < 20;
}
