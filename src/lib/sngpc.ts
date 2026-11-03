// SNGPC (medicamentos controlados de uso veterinário) sem dependência de tela: rótulos, tipos e conferências.
// Valores e códigos seguem o Guia para geração do padrão de transmissão SNGPC (Anvisa, v2.3); docs/sngpc.md lista o que falta confirmar.
// O banco confere tudo de novo (supabase/migrations/20261214000000_sngpc.sql).

export const LISTAS_PORTARIA = [
  "A1",
  "A2",
  "A3",
  "B1",
  "B2",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
] as const;

export const UNIDADES_MEDIDA = [
  { value: 1, label: "Caixas" },
  { value: 2, label: "Frascos" },
] as const;

/** Só os receituários de controle especial; o 5 (antimicrobiano em 2 vias) não é usado. */
export const TIPOS_RECEITUARIO = [
  { value: 1, label: "Receita de Controle Especial em 2 vias (branca)" },
  { value: 2, label: "Notificação de Receita B (azul)" },
  { value: 3, label: "Notificação de Receita Especial (branca)" },
  { value: 4, label: "Notificação de Receita A (amarela)" },
] as const;

export const MOTIVOS_PERDA = [
  { value: 1, label: "Furto / roubo" },
  { value: 2, label: "Avaria" },
  { value: 3, label: "Vencimento" },
  { value: 4, label: "Apreensão / recolhimento pela Visa" },
  { value: 5, label: "Perda no processo" },
  { value: 6, label: "Coleta para controle de qualidade" },
  { value: 7, label: "Perda de exclusão da Portaria 344" },
  { value: 8, label: "Desvio de qualidade" },
  { value: 9, label: "Recolhimento do fabricante" },
] as const;

/** O guia só confirma o código 1 (documento com órgão expedidor e UF); ver docs/sngpc.md. */
export const TIPO_DOCUMENTO_COMPRADOR = 1;

export type TipoLancamento = "saldo_inicial" | "entrada" | "venda" | "perda";

export const ROTULO_LANCAMENTO: Record<TipoLancamento, string> = {
  saldo_inicial: "Saldo inicial",
  entrada: "Entrada (compra)",
  venda: "Dispensação",
  perda: "Perda",
};

const achar = <T extends { value: number; label: string }>(
  lista: readonly T[],
  v: number | null | undefined,
) => lista.find((o) => o.value === v)?.label ?? "";
export const rotuloReceituario = (v: number | null | undefined) => achar(TIPOS_RECEITUARIO, v);
export const rotuloMotivoPerda = (v: number | null | undefined) => achar(MOTIVOS_PERDA, v);
export const rotuloUnidade = (v: number | null | undefined) => achar(UNIDADES_MEDIDA, v);

export type MedicamentoControlado = {
  id: string;
  produto_id: string;
  produto: string;
  registro_ms: string;
  lista: string;
  unidade_medida: number;
  ativo: boolean;
};

export type SaldoLote = {
  medicamento_id: string;
  produto: string;
  registro_ms: string;
  lista: string;
  unidade_medida: number;
  lote: string;
  validade: string | null;
  saldo: number;
};

export type ItemLivro = {
  produto: string;
  lote: string;
  validade: string | null;
  quantidade: number;
  unidade_medida: number;
};

export type DocumentoLivro = {
  id: string;
  tipo: TipoLancamento;
  data: string;
  created_at: string;
  registrado_nome: string;
  observacao: string | null;
  nf_numero: number | null;
  nf_data: string | null;
  cnpj_origem: string | null;
  tipo_receituario: number | null;
  numero_notificacao: string | null;
  data_prescricao: string | null;
  prescritor_nome: string | null;
  prescritor_registro: string | null;
  prescritor_uf: string | null;
  comprador_nome: string | null;
  paciente_nome: string | null;
  motivo_perda: number | null;
  cancelado_em: string | null;
  cancelado_por_nome: string | null;
  cancelado_motivo: string | null;
  itens: ItemLivro[];
};

export type ItemEnvio = {
  registro_ms: string;
  lote: string;
  quantidade: number;
  unidade_medida: number;
};

export type DocumentoEnvio = {
  id: string;
  tipo: Exclude<TipoLancamento, "saldo_inicial">;
  data: string;
  created_at: string;
  nf_numero: number | null;
  nf_data: string | null;
  cnpj_origem: string | null;
  tipo_receituario: number | null;
  numero_notificacao: string | null;
  data_prescricao: string | null;
  prescritor_nome: string | null;
  prescritor_registro: string | null;
  prescritor_uf: string | null;
  comprador_nome: string | null;
  comprador_tipo_documento: number | null;
  comprador_documento: string | null;
  comprador_orgao: string | null;
  comprador_uf: string | null;
  paciente_nome: string | null;
  paciente_idade: number | null;
  paciente_unidade_idade: number | null;
  paciente_sexo: number | null;
  motivo_perda: number | null;
  itens: ItemEnvio[];
};

/** `assinatura` é a impressão digital do livro na hora da montagem: o envio recusa se o livro mudou depois. */
export type PeriodoSngpc = {
  cnpj: string;
  inicio: string;
  fim: string;
  assinatura: string;
  documentos: DocumentoEnvio[];
};
export type InventarioSngpc = {
  cnpj: string;
  data: string;
  assinatura: string;
  itens: ItemEnvio[];
};

export type PeriodoTravado = { inicio: string; fim: string; situacao: "gerado" | "transmitido" };

/** A data está dentro de um período que já tem arquivo gerado ou transmitido (o livro dela não muda). */
export const dataTravada = (data: string, periodos: readonly PeriodoTravado[]) =>
  periodos.some((p) => data >= p.inicio && data <= p.fim);
export type ResponsavelSngpc = {
  id: string;
  nome: string;
  crf: string;
  crf_uf: string;
  cpf: string;
};

export type EnvioSngpc = {
  id: string;
  tipo: "movimentacao" | "inventario";
  inicio: string;
  fim: string;
  situacao: "gerado" | "transmitido" | "cancelado";
  protocolo: string | null;
  transmitido_em: string | null;
  cancelado_motivo: string | null;
  sha256: string;
  created_at: string;
  gerado_por: string;
  farmaceutico: string;
};

export const soNumeros = (t: string) => t.replace(/\D/g, "");

/** Idade do animal como o SNGPC pede: anos (1) a partir de 1 ano, meses (2) antes disso. */
export function idadeParaSngpc(
  nascimento: string | null | undefined,
  hoje: Date = new Date(),
): { idade: number; unidade: 1 | 2 } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nascimento ?? "");
  if (!m) return null;
  const n = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(n.getTime()) || n > hoje) return null;
  let meses = (hoje.getFullYear() - n.getFullYear()) * 12 + (hoje.getMonth() - n.getMonth());
  if (hoje.getDate() < n.getDate()) meses -= 1;
  if (meses < 12) return { idade: Math.max(meses, 0), unidade: 2 };
  return { idade: Math.min(Math.floor(meses / 12), 100), unidade: 1 };
}

/** Sexo do pet no código do SNGPC: 1 masculino, 2 feminino (null se não informado). */
export const sexoParaSngpc = (sexo: string | null | undefined): 1 | 2 | null =>
  sexo === "macho" ? 1 : sexo === "femea" ? 2 : null;

/** Quantidade de cada lote nas linhas digitadas (a tela avisa antes de o banco recusar). */
export function somaPorLote<T extends { medicamento_id: string; lote: string; quantidade: number }>(
  itens: readonly T[],
) {
  const mapa = new Map<string, number>();
  for (const i of itens) {
    const k = `${i.medicamento_id}|${i.lote.trim().toUpperCase()}`;
    mapa.set(k, (mapa.get(k) ?? 0) + i.quantidade);
  }
  return mapa;
}

/** Confere uma linha de item; devolve a mensagem do primeiro problema. */
export function erroDoItem(i: {
  medicamento_id: string;
  lote: string;
  quantidade: string;
}): string | null {
  if (!i.medicamento_id) return "Escolha o medicamento.";
  if (!/^[A-Za-z0-9._/-]{1,20}$/.test(i.lote.trim()))
    return "Lote: letras, números, ponto, barra ou hífen (até 20).";
  const q = Number(i.quantidade);
  if (!Number.isInteger(q) || q < 1 || q > 999) return "A quantidade vai de 1 a 999.";
  return null;
}
