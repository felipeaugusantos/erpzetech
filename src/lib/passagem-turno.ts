// Passagem de turno da internação: lógica pura da tela. Três regras que a tela nunca quebra:
//   1. quem recebe dá "ciente" (com horário); ciente NÃO resolve pendência nem executa dose;
//   2. pendência só deixa de estar aberta por uma ação explícita (resolvida ou descartada), com autor e horário;
//   3. as doses aparecem só para consulta: a passagem não altera prescrição nem marca dose como administrada.

import type { PrescricaoInternacao } from "./internacao.ts";

export const LIMITE_RESUMO = 2000;
export const MINIMO_RESUMO = 3;
export const LIMITE_PENDENCIAS = 20;
export const LIMITE_TEXTO_PENDENCIA = 300;
/** Janela das doses mostradas na passagem (horas à frente). */
export const HORAS_DOSES = 12;

export type BaixaPendencia = {
  situacao: "resolvida" | "descartada";
  observacao: string | null;
  profissional: string;
  created_at: string;
};

export type PendenciaTurno = {
  id: string;
  texto: string;
  ordem: number;
  baixa: BaixaPendencia | null;
};

export type CienciaTurno = { profissional: string; funcao: string; created_at: string };

export type TurnoInternacao = {
  id: string;
  resumo: string;
  created_at: string;
  autor: { id: string; nome: string; funcao: string };
  sou_autor: boolean;
  minha_ciencia: boolean;
  pendencias: PendenciaTurno[];
  ciencias: CienciaTurno[];
};

export type PendenciaAberta = {
  id: string;
  texto: string;
  turno_id: string;
  created_at: string;
  autor: string;
};

export type HistoricoTurnos = {
  meu_profissional_id: string;
  turnos: TurnoInternacao[];
  pendencias_abertas: PendenciaAberta[];
};

export type ItemPlantao = {
  internacao_id: string;
  pendencias_abertas: number;
  ultima_passagem_em: string | null;
  ultima_passagem_por: string | null;
  aguarda_minha_ciencia: boolean;
};

export type EntradaPassagem = { resumo: string; pendencias: string[] };

/** Tira linhas em branco e espaços das pendências digitadas (a tela deixa campos vazios no meio). */
export function limparPendencias(textos: string[]): string[] {
  return textos.map((t) => t.trim()).filter((t) => t !== "");
}

/** Mesmas regras do banco, para avisar antes de enviar. O banco continua sendo quem decide. */
export function validarPassagem(e: EntradaPassagem): string | null {
  const resumo = e.resumo.trim();
  if (resumo.length < MINIMO_RESUMO) return "Escreva o resumo da passagem.";
  if (resumo.length > LIMITE_RESUMO) return `O resumo aceita até ${LIMITE_RESUMO} caracteres.`;
  const pend = limparPendencias(e.pendencias);
  if (pend.length > LIMITE_PENDENCIAS) return `Até ${LIMITE_PENDENCIAS} pendências por passagem.`;
  if (pend.some((p) => p.length > LIMITE_TEXTO_PENDENCIA)) {
    return `Cada pendência aceita até ${LIMITE_TEXTO_PENDENCIA} caracteres.`;
  }
  return null;
}

/** Texto curto do estado de uma pendência, sem inferir nada: aberta é aberta até alguém a baixar. */
export function rotuloPendencia(p: PendenciaTurno): string {
  if (!p.baixa) return "Aberta";
  return p.baixa.situacao === "resolvida" ? "Resolvida" : "Descartada";
}

/** A passagem espera o ciente de quem está lendo? (a tela mostra o botão só então) */
export function aguardaMeuCiente(t: TurnoInternacao, aberta: boolean): boolean {
  return aberta && !t.sou_autor && !t.minha_ciencia;
}

export type DoseProxima = {
  id: string;
  medicamento: string;
  dose: string;
  via: string | null;
  previsto_em: string;
  /** minutos de atraso (negativo = ainda falta); só para a cor do texto */
  atraso_min: number;
};

/**
 * Doses ainda pendentes de prescrições ativas, do mais cedo ao mais tarde, de até HORAS_DOSES à frente (as atrasadas
 * entram: continuam pendentes). Só consulta: a passagem não executa nem altera dose.
 */
export function dosesProximas(
  prescricoes: readonly PrescricaoInternacao[],
  agora: Date = new Date(),
  horas: number = HORAS_DOSES,
): DoseProxima[] {
  const limite = agora.getTime() + horas * 3_600_000;
  const doses: DoseProxima[] = [];
  for (const p of prescricoes) {
    if (p.situacao !== "ativa") continue;
    for (const e of p.execucoes) {
      if (e.situacao !== "pendente") continue;
      const t = new Date(e.previsto_em).getTime();
      if (Number.isNaN(t) || t > limite) continue;
      doses.push({
        id: e.id,
        medicamento: p.medicamento,
        dose: p.dose,
        via: p.via,
        previsto_em: e.previsto_em,
        atraso_min: Math.round((agora.getTime() - t) / 60_000),
      });
    }
  }
  return doses.sort(
    (a, b) => a.previsto_em.localeCompare(b.previsto_em) || a.id.localeCompare(b.id),
  );
}

/** Aviso do cartão do internado na lista: o que o plantão precisa ver primeiro, ou null. */
export function avisosDoPlantao(
  item: ItemPlantao | undefined,
): { texto: string; alerta: boolean }[] {
  if (!item) return [];
  const avisos: { texto: string; alerta: boolean }[] = [];
  if (item.aguarda_minha_ciencia) {
    avisos.push({
      texto: `Passagem de ${item.ultima_passagem_por ?? "outro profissional"} aguarda seu ciente`,
      alerta: true,
    });
  }
  if (item.pendencias_abertas > 0) {
    avisos.push({
      texto: `${item.pendencias_abertas} pendência${item.pendencias_abertas === 1 ? "" : "s"} aberta${item.pendencias_abertas === 1 ? "" : "s"}`,
      alerta: false,
    });
  }
  return avisos;
}
