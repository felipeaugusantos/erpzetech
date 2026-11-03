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

export type TarifaPreco = Tarifa & {
  valor_diaria: number;
  valor_adulto_extra: number;
  valor_crianca: number;
  minimo_noites: number;
  /** quantas pessoas a diária já inclui; o adulto além disso paga o extra */
  pessoas_incluidas: number;
};

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

/** Diária + adultos além do incluído × extra + crianças × valor da criança. Espelho de _hs_preco_noite no banco. */
export function precoDaNoite(t: TarifaPreco, adultos: number, criancas: number) {
  const extraAdultos = Math.max(adultos - t.pessoas_incluidas, 0);
  return reais(
    centavos(t.valor_diaria) +
      extraAdultos * centavos(t.valor_adulto_extra) +
      criancas * centavos(t.valor_crianca),
  );
}

export type NoiteCotada = { data: string; valor: number; tarifa_id: string };
export type Cotacao = { noites: NoiteCotada[]; total: number };

/** Datas AAAA-MM-DD das noites de [entrada, saída). */
export function noitesDaEstadia(entrada: string, saida: string) {
  const n = diasEntre(entrada, saida);
  const base = Date.parse(`${entrada}T00:00:00Z`);
  return Array.from({ length: Math.max(n, 0) }, (_, i) =>
    new Date(base + i * DIA_MS).toISOString().slice(0, 10),
  );
}

/**
 * Cotação noite a noite: espelho de _hs_precificar. Sem tarifa para uma noite a venda é recusada
 * (nunca há preço implícito) e o mínimo de noites é o da tarifa da noite de chegada.
 */
export function cotarEstadia<T extends TarifaPreco>(
  tarifas: readonly T[],
  entrada: string,
  saida: string,
  adultos: number,
  criancas: number,
): Cotacao {
  const datas = noitesDaEstadia(entrada, saida);
  if (datas.length === 0) throw new Error("A saída precisa ser depois da entrada");
  if (datas.length > 365) throw new Error("A estadia não pode passar de 365 noites");
  const noites = datas.map((data) => {
    const t = escolherTarifa(tarifas, data);
    if (!t) {
      const [a, m, d] = data.split("-");
      throw new Error(`Sem tarifa para a noite de ${d}/${m}/${a}`);
    }
    return {
      data,
      valor: precoDaNoite(t, adultos, criancas),
      tarifa_id: t.id,
      minimo: t.minimo_noites,
    };
  });
  const minimo = noites[0]?.minimo ?? 1;
  if (noites.length < minimo) throw new Error(`A tarifa exige no mínimo ${minimo} noite(s)`);
  const cotadas = noites.map(({ data, valor, tarifa_id }) => ({ data, valor, tarifa_id }));
  return { noites: cotadas, total: reais(cotadas.reduce((s, n) => s + centavos(n.valor), 0)) };
}

/** Total acordado rateado entre as noites em centavos; a sobra vai para a última (igual a _hs_gravar_diarias). */
export function ratearValor(total: number, noites: number) {
  if (noites < 1) throw new Error("Informe ao menos uma noite");
  const base = Math.floor(centavos(total) / noites);
  const valores = Array.from({ length: noites }, () => base);
  valores[noites - 1] = centavos(total) - base * (noites - 1);
  return valores.map(reais);
}

export type LancamentoConta = { total: number };
export type PagamentoConta = { tipo: "sinal" | "pagamento" | "devolucao"; valor: number };

/**
 * Saldo da conta do hóspede: lançamentos − (sinais + pagamentos) + devoluções, em centavos exatos.
 * Positivo = o hóspede deve; negativo = crédito dele. Espelho de _hs_folio_saldo no banco.
 */
export function saldoDoFolio(
  lancamentos: readonly LancamentoConta[],
  pagamentos: readonly PagamentoConta[],
) {
  const lancado = lancamentos.reduce((s, l) => s + centavos(l.total), 0);
  const recebido = pagamentos.reduce(
    (s, p) => s + (p.tipo === "devolucao" ? -centavos(p.valor) : centavos(p.valor)),
    0,
  );
  return reais(lancado - recebido);
}

/** Taxa de turismo da noite: hóspedes × valor por hóspede e noite (em centavos). */
export const taxaDeTurismo = (hospedes: number, valorPorHospede: number) =>
  reais(Math.round(hospedes * centavos(valorPorHospede)));

/** O estorno é a linha de sinal oposto: o lançamento original nunca muda. */
export function estornoDe<T extends { valor_unitario: number; total: number }>(l: T) {
  return { ...l, valor_unitario: -l.valor_unitario || 0, total: -l.total || 0 };
}

/** O que a conta pede ao encerrar sem estadia (cancelamento ou não comparecimento) com crédito do hóspede. */
export function destinoDoCredito(saldo: number): "devolver_ou_reter" | "quitada" | "a_receber" {
  if (saldo < 0) return "devolver_ou_reter";
  return saldo === 0 ? "quitada" : "a_receber";
}
