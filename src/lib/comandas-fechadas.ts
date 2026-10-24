// Tela de comandas fechadas: período de busca (dia de Brasília) e o rótulo da NFC-e de cada comanda.

/** Brasília está em UTC-3 o ano todo (sem horário de verão desde 2019). */
const DESLOCAMENTO_BRASILIA = "-03:00";

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Dia seguinte a uma data AAAA-MM-DD, sem depender do fuso do aparelho. */
export function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Intervalo [início, fim) em instantes ISO que cobre os dias de `de` a `ate` (inclusive), no horário de Brasília. */
export function intervaloDias(de: string, ate: string): { inicio: string; fim: string } | null {
  if (!DIA.test(de) || !DIA.test(ate) || Number.isNaN(Date.parse(`${de}T12:00:00Z`)) || de > ate)
    return null;
  return {
    inicio: new Date(`${de}T00:00:00${DESLOCAMENTO_BRASILIA}`).toISOString(),
    fim: new Date(`${diaSeguinte(ate)}T00:00:00${DESLOCAMENTO_BRASILIA}`).toISOString(),
  };
}

export type NotaDaComanda = {
  comanda_id: string | null;
  situacao: string;
  numero: number | null;
  created_at: string;
};

/** A NFC-e viva mais recente de cada comanda (as canceladas não contam: uma nova pode ser emitida). */
export function notaPorComanda<T extends NotaDaComanda>(notas: readonly T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const n of notas) {
    if (!n.comanda_id || n.situacao === "cancelada") continue;
    const atual = mapa.get(n.comanda_id);
    if (!atual || n.created_at > atual.created_at) mapa.set(n.comanda_id, n);
  }
  return mapa;
}

const ROTULO_NOTA: Record<string, string> = {
  rascunho: "Rascunho (falta resolver)",
  pronta: "Pronta para transmitir",
  transmitida: "Enviada, aguardando a Sefaz",
  contingencia: "Em contingência",
  autorizada: "Autorizada",
  rejeitada: "Rejeitada",
};

/** Texto curto da situação da NFC-e na lista; sem nota, "Sem NFC-e". */
export function rotuloNota(nota: Pick<NotaDaComanda, "situacao" | "numero"> | undefined): string {
  if (!nota) return "Sem NFC-e";
  const base = ROTULO_NOTA[nota.situacao] ?? nota.situacao;
  return nota.numero != null ? `${base} · nº ${nota.numero}` : base;
}
