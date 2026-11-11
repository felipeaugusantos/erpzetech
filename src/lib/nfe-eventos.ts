// Regras puras dos eventos de NF-e (carta de correção e inutilização de numeração).
// Ficam à parte das funções de servidor para serem testadas sem rede nem banco.

export const MIN_JUSTIFICATIVA = 15;
export const MAX_JUSTIFICATIVA_INUTILIZACAO = 255;
export const MAX_CORRECAO = 1000;
/** A Sefaz aceita até 20 cartas de correção por nota. */
export const MAX_CARTAS_POR_NOTA = 20;
/** Trava do sistema (não da Sefaz): evita inutilizar uma faixa enorme por engano. */
export const MAX_FAIXA_INUTILIZACAO = 500;

/** Tira caracteres de controle e espaços repetidos: a Sefaz recusa quebra de linha e espaço duplo. */
export function normalizarTexto(v: unknown): string {
  return (
    String(v ?? "")
      // eslint-disable-next-line no-control-regex -- é exatamente o que se quer remover
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function validarCorrecao(texto: unknown): string {
  const t = normalizarTexto(texto);
  if (t.length < MIN_JUSTIFICATIVA) {
    throw new Error(`O texto da correção precisa ter pelo menos ${MIN_JUSTIFICATIVA} caracteres.`);
  }
  if (t.length > MAX_CORRECAO) {
    throw new Error(`O texto da correção pode ter no máximo ${MAX_CORRECAO} caracteres.`);
  }
  return t;
}

export type PedidoInutilizacao = {
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
};

const inteiro = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").trim()));

export function validarInutilizacao(entrada: {
  serie: unknown;
  numeroInicial: unknown;
  numeroFinal: unknown;
  justificativa: unknown;
}): PedidoInutilizacao {
  const serie = inteiro(entrada.serie);
  const numeroInicial = inteiro(entrada.numeroInicial);
  const numeroFinal = inteiro(entrada.numeroFinal);
  if (!Number.isInteger(serie) || serie < 0 || serie > 999) {
    throw new Error("A série deve ser um número de 0 a 999.");
  }
  for (const n of [numeroInicial, numeroFinal]) {
    if (!Number.isInteger(n) || n < 1 || n > 999_999_999) {
      throw new Error("Os números inicial e final devem ficar entre 1 e 999999999.");
    }
  }
  if (numeroFinal < numeroInicial) {
    throw new Error("O número final não pode ser menor que o inicial.");
  }
  if (numeroFinal - numeroInicial + 1 > MAX_FAIXA_INUTILIZACAO) {
    throw new Error(`Inutilize no máximo ${MAX_FAIXA_INUTILIZACAO} números por vez.`);
  }
  const justificativa = normalizarTexto(entrada.justificativa);
  if (justificativa.length < MIN_JUSTIFICATIVA) {
    throw new Error(`A justificativa precisa ter pelo menos ${MIN_JUSTIFICATIVA} caracteres.`);
  }
  if (justificativa.length > MAX_JUSTIFICATIVA_INUTILIZACAO) {
    throw new Error(
      `A justificativa pode ter no máximo ${MAX_JUSTIFICATIVA_INUTILIZACAO} caracteres.`,
    );
  }
  return { serie, numeroInicial, numeroFinal, justificativa };
}

/** Situações de nota que já existem na Sefaz (ou podem existir): o número não pode ser inutilizado. */
const SITUACOES_QUE_USAM_NUMERO = ["autorizada", "transmitida", "cancelada", "denegada"];

/**
 * Notas da mesma série dentro da faixa que impedem a inutilização. Inutilizar número de nota autorizada
 * (ou ainda em processamento) não é permitido: nesse caso o caminho é o cancelamento.
 */
export function notasQueImpedemInutilizacao<T extends { numero: number | null; situacao: string }>(
  notas: T[],
  inicial: number,
  final: number,
): T[] {
  return notas.filter(
    (n) =>
      n.numero != null &&
      n.numero >= inicial &&
      n.numero <= final &&
      SITUACOES_QUE_USAM_NUMERO.includes(n.situacao),
  );
}

export type SituacaoEvento = "registrado" | "rejeitado" | "pendente" | "erro";

/** Converte o status do emissor para o que o sistema guarda; o que não se reconhece fica pendente. */
export function situacaoDoEvento(status: unknown): SituacaoEvento {
  const s = String(status ?? "").toLowerCase();
  if (s === "registrado") return "registrado";
  if (s === "rejeitado") return "rejeitado";
  if (s === "erro") return "erro";
  return "pendente";
}

/** Ano da inutilização: o do ano corrente no fuso de São Paulo, em 4 dígitos. */
export function anoDaInutilizacao(agora: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(
      agora,
    ),
  );
}
