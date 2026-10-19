// Regras de vacinas e vermífugos sem dependência de tela: tipos, rótulos, sugestões de catálogo e situação da próxima dose
// (as regras de verdade ficam no banco: série, reforço, lote e validade).

export type ItemCatalogo = {
  id: string;
  nome: string;
  tipo: "vacina" | "vermifugo";
  especie: "cao" | "gato" | "todas";
  doses_serie: number;
  intervalo_serie_dias: number | null;
  reforco_dias: number;
  idade_minima_dias: number | null;
  produto_id: string;
  produto: string;
  ativo: boolean;
};

export type AplicacaoVacina = {
  id: string;
  nome: string;
  tipo: "vacina" | "vermifugo";
  origem: "clinica" | "outro_local";
  dose_tipo: "serie" | "reforco";
  dose_numero: number;
  aplicada_em: string;
  proxima_dose_em: string | null;
  lote: string | null;
  validade_lote: string | null;
  informado_por: string | null;
  veterinario: string | null;
  crmv: string | null;
  crmv_uf: string | null;
  aplicador: string | null;
};

export type CartaoVacinacao = {
  clinica: string | null;
  pet: {
    id: string;
    nome: string;
    especie: string;
    raca: string | null;
    sexo: string | null;
    nascimento: string | null;
  };
  tutor: string;
  aplicacoes: AplicacaoVacina[];
  proximas: { nome: string; tipo: string; proxima_dose_em: string }[];
};

export const TIPOS_VACINA = [
  { value: "vacina", label: "Vacina" },
  { value: "vermifugo", label: "Vermífugo" },
] as const;

export const ESPECIES_VACINA = [
  { value: "todas", label: "Cães e gatos" },
  { value: "cao", label: "Cães" },
  { value: "gato", label: "Gatos" },
] as const;

/** Rótulo da dose: "1ª dose", "3ª dose" ou "Reforço" / "2º reforço". */
export function rotuloDose(tipo: string, numero: number): string {
  if (tipo === "serie") return `${numero}ª dose`;
  return numero <= 1 ? "Reforço" : `${numero}º reforço`;
}

export type SituacaoDose = "atrasada" | "proxima" | "em_dia";

/** Dias de hoje até a data (negativo se já passou). Datas "AAAA-MM-DD", sem fuso. */
export function diasAte(data: string, hoje: string): number {
  const d = (s: string) => {
    const [a, m, dia] = s.split("-").map(Number);
    return Date.UTC(a!, m! - 1, dia!);
  };
  return Math.round((d(data) - d(hoje)) / 86_400_000);
}

/** Atrasada se já passou; "próxima" nos 30 dias seguintes; senão em dia. */
export function situacaoDaDose(proxima: string, hoje: string): SituacaoDose {
  const dias = diasAte(proxima, hoje);
  if (dias < 0) return "atrasada";
  if (dias <= 30) return "proxima";
  return "em_dia";
}

export type SugestaoCatalogo = {
  nome: string;
  tipo: "vacina" | "vermifugo";
  especie: "cao" | "gato" | "todas";
  doses_serie: number;
  intervalo_serie_dias: number | null;
  reforco_dias: number;
  idade_minima_dias: number | null;
};

/**
 * Valores iniciais para a clínica não começar do zero. São SUGESTÕES: o veterinário responsável confere e ajusta
 * cada item ao protocolo da clínica e à bula do produto. O sistema não decide protocolo.
 */
export const SUGESTOES_CATALOGO: readonly SugestaoCatalogo[] = [
  {
    nome: "V10 (múltipla canina)",
    tipo: "vacina",
    especie: "cao",
    doses_serie: 3,
    intervalo_serie_dias: 21,
    reforco_dias: 365,
    idade_minima_dias: 42,
  },
  {
    nome: "Antirrábica",
    tipo: "vacina",
    especie: "todas",
    doses_serie: 1,
    intervalo_serie_dias: null,
    reforco_dias: 365,
    idade_minima_dias: 90,
  },
  {
    nome: "Tríplice/Quádrupla felina",
    tipo: "vacina",
    especie: "gato",
    doses_serie: 3,
    intervalo_serie_dias: 21,
    reforco_dias: 365,
    idade_minima_dias: 56,
  },
  {
    nome: "Vermífugo",
    tipo: "vermifugo",
    especie: "todas",
    doses_serie: 1,
    intervalo_serie_dias: null,
    reforco_dias: 90,
    idade_minima_dias: 15,
  },
];

/** Texto curto do protocolo do item: "3 doses a cada 21 dias, depois reforço a cada 365 dias". */
export function resumoDoProtocolo(
  i: Pick<ItemCatalogo, "doses_serie" | "intervalo_serie_dias" | "reforco_dias">,
): string {
  const serie =
    i.doses_serie > 1
      ? `${i.doses_serie} doses a cada ${i.intervalo_serie_dias} dias, depois `
      : "";
  return `${serie}${serie ? "reforço" : "Reforço"} a cada ${i.reforco_dias} dias`;
}
