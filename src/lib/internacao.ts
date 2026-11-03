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
