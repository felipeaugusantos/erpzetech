// NF-e de ajuste (finNFe 3): regras puras. Uso EXCEPCIONAL, só onde a legislação do estado prevê, por isso a
// versão do sistema é protegida: só administrador, sempre referenciando uma NF-e de venda autorizada, sem frete e
// com motivo obrigatório. Regras apuradas (fontes de terceiros, conferir no MOC): referência obrigatória a um
// documento fiscal; sem frete; indPres 0; a vPag pode ser menor que vNF.

import { chaveAcessoValida } from "./nfe-devolucao.ts";
import { MIN_JUSTIFICATIVA, normalizarTexto } from "./nfe-eventos.ts";

export type NotaAjustada = {
  situacao: string;
  chave: string | null;
  modelo?: string | null;
  ajusta_nfe_id?: string | null;
  fornecedor_id?: string | null;
};

/** Confere se a nota pode ser ajustada e devolve a chave que a nota de ajuste referencia. */
export function chaveDaOrigemAjuste(o: NotaAjustada): string {
  if (o.situacao !== "autorizada") throw new Error("Só nota autorizada pode ser ajustada.");
  if (o.modelo != null && o.modelo !== "nfe" && o.modelo !== "55") {
    throw new Error("Só NF-e (modelo 55) pode ser ajustada por esta tela.");
  }
  if (o.ajusta_nfe_id) throw new Error("Uma nota de ajuste não pode ser ajustada de novo.");
  if (o.fornecedor_id) {
    throw new Error("Nota de devolução de compra não pode ser ajustada por esta tela.");
  }
  const chave = String(o.chave ?? "").trim();
  if (!chaveAcessoValida(chave)) {
    throw new Error("A nota original não tem uma chave de acesso válida para ser referenciada.");
  }
  return chave;
}

/** O motivo do ajuste é obrigatório: é o registro do amparo legal que levou à emissão. */
export function validarMotivoAjuste(v: unknown): string {
  const t = normalizarTexto(v);
  if (t.length < MIN_JUSTIFICATIVA) {
    throw new Error(
      `Informe o motivo e o amparo legal do ajuste (pelo menos ${MIN_JUSTIFICATIVA} caracteres).`,
    );
  }
  return t.slice(0, 200);
}

/** Campos do ide da nota de ajuste: finalidade 3, saída, indPres 0 e a ÚNICA nota referenciada. */
export function ideAjuste(chave: string) {
  return { finNFe: 3, tpNF: 1, indPres: 0, NFref: [{ refNFe: chave }] } as const;
}
