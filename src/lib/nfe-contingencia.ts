// Contingência SVC da NF-e (modelo 55): regras puras, sem rede nem banco.
// SVC é a contingência que AUTORIZA online em outro ambiente (SVC-AN ou SVC-RS) quando a Sefaz da UF do
// emitente está fora. EPEC e FS-DA (que exigem enviar depois) não são cobertos: o emissor não os expõe.

import { normalizarTexto } from "./nfe-eventos.ts";

export const MIN_JUSTIFICATIVA_CONTINGENCIA = 15;
export const MAX_JUSTIFICATIVA_CONTINGENCIA = 256;

/**
 * UFs atendidas pela SVC-RS; todas as demais usam a SVC-AN (MOC, tabela de ambientes de contingência).
 * Conferir com o MOC vigente antes de ligar em produção: a Sefaz pode mudar a distribuição.
 */
export const UFS_SVC_RS = ["AM", "BA", "GO", "MA", "MS", "MT", "PE", "PR"] as const;
// prettier-ignore
export const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN",
  "RO","RR","RS","SC","SE","SP","TO",
] as const;

export type Svc = { tpEmis: 6 | 7; autorizador: "SVCAN" | "SVCRS"; nome: "SVC-AN" | "SVC-RS" };

/** Ambiente de contingência da UF do emitente, ou null se a UF for desconhecida. */
export function svcDaUf(uf: unknown): Svc | null {
  const u = String(uf ?? "")
    .trim()
    .toUpperCase();
  if (!(UFS as readonly string[]).includes(u)) return null;
  return (UFS_SVC_RS as readonly string[]).includes(u)
    ? { tpEmis: 7, autorizador: "SVCRS", nome: "SVC-RS" }
    : { tpEmis: 6, autorizador: "SVCAN", nome: "SVC-AN" };
}

export function validarJustificativaContingencia(v: unknown): string {
  const t = normalizarTexto(v);
  if (t.length < MIN_JUSTIFICATIVA_CONTINGENCIA) {
    throw new Error(
      `A justificativa da contingência precisa ter pelo menos ${MIN_JUSTIFICATIVA_CONTINGENCIA} caracteres.`,
    );
  }
  if (t.length > MAX_JUSTIFICATIVA_CONTINGENCIA) {
    throw new Error(
      `A justificativa da contingência pode ter no máximo ${MAX_JUSTIFICATIVA_CONTINGENCIA} caracteres.`,
    );
  }
  return t;
}

export type EstadoContingencia = { justificativa: string; entrou_em: string } | null;

/** Mesmo formato que a emissão já usa para dhEmi. */
const dataHora = (d: Date) => d.toISOString().replace("Z", "-00:00");

/**
 * Campos de ide.tpEmis/dhCont/xJust. Sem contingência ativa: emissão normal. Com ela: SVC da UF, com a
 * data de entrada e a justificativa. UF desconhecida com contingência ativa é erro (não emite como normal
 * em silêncio, porque a pessoa acredita que está em contingência).
 */
export function identEmissao(
  estado: EstadoContingencia,
  uf: unknown,
): { tpEmis: 1 } | { tpEmis: 6 | 7; dhCont: string; xJust: string } {
  if (!estado) return { tpEmis: 1 };
  const svc = svcDaUf(uf);
  if (!svc) throw new Error("UF do emitente desconhecida: não dá para escolher a SVC.");
  return {
    tpEmis: svc.tpEmis,
    dhCont: dataHora(new Date(estado.entrou_em)),
    xJust: validarJustificativaContingencia(estado.justificativa),
  };
}

/** Código 107 = "Serviço em Operação" (MOC). Qualquer outro, ou ausência de resposta, não é operação. */
export function servicoEmOperacao(status: { codigo_status?: unknown } | null | undefined): boolean {
  return Number(status?.codigo_status) === 107;
}
