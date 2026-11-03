// Internação da clínica sem dependência de tela: tipos, rótulos e contas simples (o banco confere as regras de verdade).

export type SituacaoInternacao = "internado" | "alta" | "obito";

export const SITUACOES_INTERNACAO: readonly {
  value: SituacaoInternacao | "todas";
  label: string;
}[] = [
  { value: "internado", label: "Internados" },
  { value: "alta", label: "Altas" },
  { value: "obito", label: "Óbitos" },
  { value: "todas", label: "Todas" },
];

export const rotuloSituacaoInternacao = (s: string) =>
  s === "internado" ? "Internado" : s === "alta" ? "Alta" : s === "obito" ? "Óbito" : s;

export const TIPOS_OCORRENCIA = [
  { value: "intercorrencia", label: "Intercorrência" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "medicacao", label: "Medicação" },
  { value: "higiene", label: "Higiene" },
  { value: "outro", label: "Outro" },
] as const;

/** Inclui "transferencia", que só o sistema registra ao trocar de box. */
export const rotuloTipoOcorrencia = (t: string) =>
  t === "transferencia"
    ? "Transferência"
    : (TIPOS_OCORRENCIA.find((o) => o.value === t)?.label ?? t);

export type Box = { id: string; nome: string; ativo: boolean; ocupado: boolean };

export type ResumoInternacao = {
  id: string;
  situacao: SituacaoInternacao;
  admitido_em: string;
  encerrado_em: string | null;
  box: { id: string; nome: string };
  pet: { id: string; nome: string; especie: string; raca: string | null; alergias: string | null };
  tutor: string;
  veterinario: string;
  ultimo_peso: number | null;
  ocorrencias: number;
};

export type FichaInternacao = {
  internacao: {
    id: string;
    situacao: SituacaoInternacao;
    admitido_em: string;
    encerrado_em: string | null;
    box: { id: string; nome: string };
    veterinario: { nome: string; crmv: string; crmv_uf: string };
    /** só vêm para o veterinário */
    motivo: string | null;
    observacoes: string | null;
    encerramento_texto: string | null;
  };
  pet: {
    id: string;
    nome: string;
    especie: string;
    raca: string | null;
    porte: string | null;
    sexo: string | null;
    peso_kg: number | null;
    nascimento: string | null;
    castrado: boolean | null;
    alergias: string | null;
    microchip: string | null;
    obito_em: string | null;
  };
  tutor: string;
  tutor_telefone: string | null;
  prescricoes: PrescricaoInternacao[];
  itens: ItemInternacao[];
  total_itens: number;
  relatos:
    | {
        id: string;
        texto: string;
        created_at: string;
        veterinario: string;
        crmv: string;
        crmv_uf: string;
      }[]
    | null;
  ocorrencias: {
    id: string;
    tipo: string;
    texto: string;
    created_at: string;
    profissional: string;
  }[];
  pesagens: { id: string; peso_kg: number; created_at: string; observacao: string | null }[];
  sou_veterinario: boolean;
};

/** Dias de internação (pelo relógio da clínica): 1 no dia da admissão. */
export function diasInternado(admitidoEm: string, ate: Date | string = new Date()): number {
  const ini = new Date(admitidoEm).getTime();
  const fim = (typeof ate === "string" ? new Date(ate) : ate).getTime();
  if (Number.isNaN(ini) || Number.isNaN(fim) || fim < ini) return 1;
  const dia = (t: number) => Math.floor((t - 3 * 3_600_000) / 86_400_000);
  return dia(fim) - dia(ini) + 1;
}

/** Variação de peso desde a primeira pesagem da internação (kg), do mais antigo ao mais novo; null com menos de duas pesagens. */
export function variacaoDePeso(
  pesagens: readonly { peso_kg: number; created_at: string }[],
): number | null {
  if (pesagens.length < 2) return null;
  const ordem = [...pesagens].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    Math.round((Number(ordem[ordem.length - 1]!.peso_kg) - Number(ordem[0]!.peso_kg)) * 100) / 100
  );
}

export type ExecucaoDose = {
  id: string;
  previsto_em: string;
  situacao: "pendente" | "executada" | "nao_executada" | "cancelada";
  executado_em: string | null;
  executado_por: string | null;
  observacao: string | null;
};

export type PrescricaoInternacao = {
  id: string;
  medicamento: string;
  dose: string;
  via: string | null;
  frequencia_horas: number | null;
  dias: number | null;
  inicio: string;
  observacao: string | null;
  situacao: "ativa" | "suspensa";
  suspensa_em: string | null;
  suspensa_motivo: string | null;
  veterinario: string;
  crmv: string;
  crmv_uf: string;
  execucoes: ExecucaoDose[];
};

export type ItemInternacao = {
  id: string;
  tipo: "produto" | "servico";
  descricao: string;
  quantidade: number;
  preco_unitario: number;
  total: number;
  lancado_por: string;
  created_at: string;
  cancelado_em: string | null;
  cancelado_motivo: string | null;
};

/** "A cada 8 h por 3 dias" ou "Dose única". */
export function descricaoDaFrequencia(
  p: Pick<PrescricaoInternacao, "frequencia_horas" | "dias">,
): string {
  if (!p.frequencia_horas || !p.dias) return "Dose única";
  return `A cada ${p.frequencia_horas} h por ${p.dias} dia${p.dias === 1 ? "" : "s"}`;
}

export type CorExecucao = "verde" | "cinza" | "laranja" | "azul" | "amarelo" | "vermelho";

/** Minutos de atraso (negativo = ainda falta) de uma dose em relação ao relógio do servidor. */
export const atrasoEmMinutos = (previsto: string, agora: string | Date) =>
  Math.round((new Date(agora).getTime() - new Date(previsto).getTime()) / 60_000);

/**
 * Cor do aviso da dose no mapa de execuções:
 * verde = feita · laranja = não feita · cinza = cancelada · azul = programada (falta mais de 1 h) ·
 * amarelo = na hora (de 1 h antes até 15 min depois do horário) · vermelho = atrasada (mais de 15 min depois do horário).
 */
export function corDaExecucao(
  e: { situacao: ExecucaoDose["situacao"]; previsto_em: string },
  agora: string | Date,
): CorExecucao {
  if (e.situacao === "executada") return "verde";
  if (e.situacao === "nao_executada") return "laranja";
  if (e.situacao === "cancelada") return "cinza";
  const atraso = atrasoEmMinutos(e.previsto_em, agora);
  if (atraso > 15) return "vermelho";
  if (atraso >= -60) return "amarelo";
  return "azul";
}

export const ROTULO_COR: Record<CorExecucao, string> = {
  verde: "Feita",
  laranja: "Não feita",
  cinza: "Cancelada",
  azul: "Programada",
  amarelo: "Na hora",
  vermelho: "Atrasada",
};

/** Texto do prazo ao lado do rótulo da cor: "em 40 min", "agora", "há 25 min" (o rótulo já diz "Atrasada"). */
export function textoDoPrazo(previsto: string, agora: string | Date): string {
  const atraso = atrasoEmMinutos(previsto, agora);
  const fmt = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
  if (atraso > 15) return `há ${fmt(atraso)}`;
  if (atraso >= -1) return "agora";
  return `em ${fmt(-atraso)}`;
}
