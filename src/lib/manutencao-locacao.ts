// Plano de manutenção dos equipamentos de locação: situação dos planos, conferência dos formulários e quem fica bloqueado.
// A contagem dos dias locados e o bloqueio de verdade ficam no banco; aqui só o que a tela mostra.

export type SituacaoPlano = "em_dia" | "proxima" | "vencida";

export type PlanoSituacao = {
  plano_id: string;
  equipamento_id: string;
  equipamento: string;
  codigo: string | null;
  nome: string;
  intervalo_dias: number;
  referencia_em: string;
  dias: number;
  restantes: number;
  situacao: SituacaoPlano;
};

export const ROTULO_SITUACAO: Record<SituacaoPlano, string> = {
  em_dia: "Em dia",
  proxima: "Vence em breve",
  vencida: "Vencida",
};

/** Mais urgente primeiro: vencida, depois a que vence em breve, depois em dia. */
const ORDEM: Record<SituacaoPlano, number> = { vencida: 0, proxima: 1, em_dia: 2 };

export const ordenarPorUrgencia = (planos: readonly PlanoSituacao[]): PlanoSituacao[] =>
  [...planos].sort(
    (a, b) =>
      ORDEM[a.situacao] - ORDEM[b.situacao] ||
      a.restantes - b.restantes ||
      a.equipamento.localeCompare(b.equipamento, "pt-BR"),
  );

/** Equipamentos com algum plano vencido: não saem para um novo cliente (o banco também recusa). */
export function equipamentosComManutencaoVencida(
  planos: readonly Pick<PlanoSituacao, "equipamento_id" | "situacao" | "nome">[],
): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const p of planos) {
    if (p.situacao !== "vencida") continue;
    mapa.set(p.equipamento_id, [...(mapa.get(p.equipamento_id) ?? []), p.nome]);
  }
  return mapa;
}

export function resumoDosPlanos(planos: readonly Pick<PlanoSituacao, "situacao">[]) {
  return {
    vencidas: planos.filter((p) => p.situacao === "vencida").length,
    proximas: planos.filter((p) => p.situacao === "proxima").length,
  };
}

/** "12 de 30 dias locados (faltam 18)" ou "passou 3 dias". */
export function textoDoProgresso(p: Pick<PlanoSituacao, "dias" | "intervalo_dias" | "restantes">) {
  const base = `${p.dias} de ${p.intervalo_dias} dias locados`;
  return p.restantes > 0
    ? `${base} (faltam ${p.restantes})`
    : `${base} (passou ${Math.abs(p.restantes)} dia(s))`;
}

export type FormPlano = { nome: string; intervaloDias: string; referenciaEm: string };

export function erroDoPlano(f: FormPlano, hoje: string): string | null {
  const nome = f.nome.trim();
  if (nome.length < 2 || nome.length > 80) return "Dê um nome ao plano (de 2 a 80 letras)";
  const n = Number(f.intervaloDias.trim());
  if (!/^\d+$/.test(f.intervaloDias.trim()) || n < 1 || n > 3650)
    return "O intervalo precisa ser de 1 a 3650 dias de locação";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.referenciaEm)) return "Informe a data da última manutenção";
  if (f.referenciaEm > hoje) return "A data da última manutenção não pode ser no futuro";
  return null;
}

export type FormManutencao = {
  planoId: string;
  tipo: "preventiva" | "corretiva";
  realizadaEm: string;
  descricao: string;
  custo: string;
  responsavel: string;
};

export function erroDaManutencao(
  f: FormManutencao,
  hoje: string,
  referenciaDoPlano?: string,
): string | null {
  const d = f.descricao.trim();
  if (d.length < 2 || d.length > 500) return "Descreva o que foi feito (de 2 a 500 letras)";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.realizadaEm)) return "Informe a data da manutenção";
  if (f.realizadaEm > hoje) return "A data da manutenção não pode ser no futuro";
  if (referenciaDoPlano && f.realizadaEm < referenciaDoPlano)
    return `A manutenção não pode ser anterior à última registrada neste plano (${referenciaDoPlano.split("-").reverse().join("/")})`;
  if (f.custo.trim()) {
    const c = Number(f.custo.trim().replace(",", "."));
    if (!/^\d+([.,]\d+)?$/.test(f.custo.trim()) || !Number.isFinite(c) || c >= 1_000_000_000)
      return "Confira o custo (um valor em reais, pode ser zero)";
  }
  if (f.responsavel.length > 120) return "O responsável passa de 120 letras";
  return null;
}
