import { cpfValido } from "./nfce-consumidor.ts";

// Regras da Hotelaria sem dependência de tela: ficam à parte para os testes rodarem no Node.
// As mesmas regras estão no banco (hs_* em supabase/migrations/20261209000000_hotelaria_base.sql); o banco é quem decide.

export const TIPOS_DOCUMENTO = [
  { value: "cpf", label: "CPF" },
  { value: "rg", label: "RG" },
  { value: "cnh", label: "CNH" },
  { value: "passaporte", label: "Passaporte" },
  { value: "outro", label: "Outro" },
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]["value"];

export const MOTIVOS_VIAGEM = [
  { value: "lazer", label: "Lazer" },
  { value: "negocios", label: "Negócios" },
  { value: "congresso", label: "Congresso ou evento" },
  { value: "parentes", label: "Visita a parentes ou amigos" },
  { value: "estudos", label: "Estudos" },
  { value: "saude", label: "Saúde" },
  { value: "religiao", label: "Religião" },
  { value: "compras", label: "Compras" },
  { value: "outro", label: "Outro" },
] as const;

export const MEIOS_TRANSPORTE = [
  { value: "aviao", label: "Avião" },
  { value: "automovel", label: "Automóvel" },
  { value: "onibus", label: "Ônibus" },
  { value: "navio", label: "Navio" },
  { value: "trem", label: "Trem" },
  { value: "outro", label: "Outro" },
] as const;

export const SITUACOES_LIMPEZA = [
  { value: "limpo", label: "Limpo" },
  { value: "sujo", label: "Sujo" },
  { value: "inspecionado", label: "Inspecionado" },
] as const;

export const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
] as const;

export const rotuloDocumento = (tipo: string | null | undefined) =>
  TIPOS_DOCUMENTO.find((t) => t.value === tipo)?.label ?? "Documento";

/** Como o documento é guardado: CPF só com dígitos; os demais em maiúsculas, só letras e números. */
export function normalizarDocumento(tipo: string, numero: string) {
  return tipo === "cpf"
    ? numero.replace(/\D/g, "")
    : numero.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Texto do erro do documento digitado, ou nulo se está bom. Vazio é válido: o documento é opcional no cadastro. */
export function erroDocumento(tipo: string | null | undefined, numero: string): string | null {
  const texto = numero.trim();
  if (!tipo && !texto) return null;
  if (!tipo) return "Escolha o tipo do documento.";
  if (!texto) return "Informe o número do documento.";
  const n = normalizarDocumento(tipo, texto);
  if (tipo === "cpf") return cpfValido(n) ? null : "CPF inválido. Confira os números.";
  return n.length >= 3 ? null : "Número do documento muito curto.";
}

export type Tarifa = {
  id: string;
  vigencia_de: string; // AAAA-MM-DD
  vigencia_ate: string;
  /** 0 = domingo … 6 = sábado; vazio = todos os dias */
  dias_semana: number[];
  prioridade: number;
  ativo: boolean;
};

/** Dia da semana de uma data AAAA-MM-DD (0 = domingo), sem depender do fuso do navegador. */
export function diaDaSemana(data: string) {
  return new Date(`${data}T00:00:00Z`).getUTCDay();
}

const DIA_MS = 86_400_000;
/** Dias entre duas datas AAAA-MM-DD (fim − início). */
export const diasEntre = (inicio: string, fim: string) =>
  Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / DIA_MS);

/**
 * Tarifa que vale para a noite: espelho de _hs_tarifa no banco.
 * Entre as ativas que cobrem a data (vigência e dia da semana) vence a de maior prioridade;
 * empate: menor vigência (menos dias), depois a que começou mais tarde, depois o id.
 */
export function escolherTarifa<T extends Tarifa>(tarifas: readonly T[], noite: string): T | null {
  const candidatas = tarifas.filter(
    (t) =>
      t.ativo &&
      noite >= t.vigencia_de &&
      noite <= t.vigencia_ate &&
      (t.dias_semana.length === 0 || t.dias_semana.includes(diaDaSemana(noite))),
  );
  candidatas.sort(
    (a, b) =>
      b.prioridade - a.prioridade ||
      diasEntre(a.vigencia_de, a.vigencia_ate) - diasEntre(b.vigencia_de, b.vigencia_ate) ||
      (a.vigencia_de < b.vigencia_de ? 1 : a.vigencia_de > b.vigencia_de ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return candidatas[0] ?? null;
}
