// Fila do dia da clínica sem dependência de tela: gravidades da triagem, ordem de atendimento e as
// transições de situação (o banco confere as mesmas regras na gravação).

export type GravidadeTriagem = "emergencia" | "urgente" | "comum";

export const GRAVIDADES: readonly {
  value: GravidadeTriagem;
  label: string;
  /** classes de badge: emergência e urgente pedem atenção imediata */
  classe: "destructive" | "warning" | "secondary";
}[] = [
  { value: "emergencia", label: "Emergência", classe: "destructive" },
  { value: "urgente", label: "Urgente", classe: "warning" },
  { value: "comum", label: "Comum", classe: "secondary" },
];

export const rotuloGravidade = (g: string) => GRAVIDADES.find((x) => x.value === g)?.label ?? g;

/** Ordem da triagem: menor número atende antes. Gravidade desconhecida vai para o fim. */
export function pesoGravidade(g: string): number {
  const i = GRAVIDADES.findIndex((x) => x.value === g);
  return i === -1 ? GRAVIDADES.length : i;
}

export type SituacaoFila = "aguardando" | "em_atendimento" | "atendido" | "desistiu";

export const ROTULO_SITUACAO_FILA: Record<SituacaoFila, string> = {
  aguardando: "Aguardando",
  em_atendimento: "Em atendimento",
  atendido: "Atendido",
  desistiu: "Desistiu",
};

/** Transições permitidas (o banco exige as mesmas). */
export const TRANSICOES_FILA: Record<SituacaoFila, readonly SituacaoFila[]> = {
  aguardando: ["em_atendimento", "desistiu"],
  em_atendimento: ["atendido", "aguardando"],
  atendido: [],
  desistiu: [],
};

export function podeTransicionar(de: SituacaoFila, para: SituacaoFila): boolean {
  return (TRANSICOES_FILA[de] ?? []).includes(para);
}

export type EntradaFila = {
  id: string;
  situacao: SituacaoFila;
  gravidade: string;
  chegada_em: string;
  encerrado_em?: string | null;
};

/**
 * A fila como a recepção vê: quem aguarda primeiro (gravidade, depois chegada), em atendimento em
 * seguida, e as passagens encerradas por último (mais recente primeiro).
 */
export function ordenarFila<T extends EntradaFila>(entradas: readonly T[]): T[] {
  const pesoSituacao = (s: SituacaoFila) =>
    s === "aguardando" ? 0 : s === "em_atendimento" ? 1 : 2;
  return [...entradas].sort((a, b) => {
    const s = pesoSituacao(a.situacao) - pesoSituacao(b.situacao);
    if (s !== 0) return s;
    if (a.situacao === "aguardando") {
      const g = pesoGravidade(a.gravidade) - pesoGravidade(b.gravidade);
      if (g !== 0) return g;
      return a.chegada_em.localeCompare(b.chegada_em);
    }
    if (a.situacao === "em_atendimento") return a.chegada_em.localeCompare(b.chegada_em);
    return (b.encerrado_em ?? b.chegada_em).localeCompare(a.encerrado_em ?? a.chegada_em);
  });
}

/** Quantos estão na frente desta entrada (só quem aguarda conta, na ordem de atendimento). */
export function posicaoNaFila<T extends EntradaFila>(entradas: readonly T[], id: string): number {
  const espera = ordenarFila(entradas.filter((e) => e.situacao === "aguardando"));
  const i = espera.findIndex((e) => e.id === id);
  return i === -1 ? 0 : i + 1;
}
