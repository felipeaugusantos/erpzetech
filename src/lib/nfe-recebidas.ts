// Notas fiscais emitidas contra o CNPJ da empresa: regras da manifestação do destinatário.
// Fica à parte das funções de servidor para ser testado.

export const EVENTOS_MANIFESTACAO = {
  "210200": "Confirmação da operação",
  "210210": "Ciência da operação",
  "210220": "Desconhecimento da operação",
  "210240": "Operação não realizada",
} as const;

export type TipoEvento = keyof typeof EVENTOS_MANIFESTACAO;

/** Quem pode manifestar: confirmar e recusar são atos fiscais com efeito legal. */
export const PAPEIS_MANIFESTACAO = ["administrador", "gestor", "financeiro"] as const;
/** Quem liga ou desliga a busca e a ciência automáticas. */
export const PAPEIS_CONFIG_RECEBIDAS = ["administrador", "gestor"] as const;

/** Eventos que não podem ser desfeitos e por isso exigem justificativa (15 a 255 caracteres). */
export const EVENTOS_COM_JUSTIFICATIVA: readonly TipoEvento[] = ["210220", "210240"];

export const ehTipoEvento = (v: unknown): v is TipoEvento =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(EVENTOS_MANIFESTACAO, v);

export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export type PedidoManifestacao = {
  chave: string;
  tipo: TipoEvento;
  justificativa: string | null;
};

/** Confere o pedido de manifestação; devolve o pedido limpo ou lança o motivo em português. */
export function validarManifestacao(entrada: {
  chave?: unknown;
  tipo?: unknown;
  justificativa?: unknown;
}): PedidoManifestacao {
  const chave = soDigitos(entrada.chave);
  if (chave.length !== 44) throw new Error("A chave de acesso precisa ter 44 dígitos.");
  if (!ehTipoEvento(entrada.tipo)) throw new Error("Tipo de manifestação inválido.");
  const tipo = entrada.tipo;
  const justificativa = String(entrada.justificativa ?? "").trim();
  if (EVENTOS_COM_JUSTIFICATIVA.includes(tipo)) {
    if (justificativa.length < 15 || justificativa.length > 255) {
      throw new Error("A justificativa precisa ter de 15 a 255 caracteres.");
    }
    return { chave, tipo, justificativa };
  }
  return { chave, tipo, justificativa: null };
}

/** A distribuição só existe para CNPJ: CPF não recebe NF-e por este serviço. */
export function cnpjParaDistribuicao(valor: unknown): string {
  const cnpj = String(valor ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  if (cnpj.length !== 14) {
    throw new Error("A empresa precisa ter um CNPJ de 14 caracteres para receber notas.");
  }
  return cnpj;
}

/** O CNPJ pedido tem que ser de uma empresa do próprio usuário. */
export function exigirCnpjPermitido(cnpj: unknown, permitidos: string[]): string {
  const limpo = cnpjParaDistribuicao(cnpj);
  if (!permitidos.some((p) => p.toUpperCase().replace(/[^0-9A-Z]/g, "") === limpo)) {
    throw new Error("CNPJ não encontrado entre as empresas do seu cadastro.");
  }
  return limpo;
}

export type ConfigRecebidas = {
  distribuicao_automatica: boolean;
  distribuicao_intervalo_horas: number;
  ciencia_automatica: boolean;
};

/** Intervalo da busca automática: de 1 a 24 horas (a Sefaz limita a frequência das consultas). */
export function configRecebidasValida(c: Partial<ConfigRecebidas>): ConfigRecebidas {
  const horas = Math.trunc(Number(c.distribuicao_intervalo_horas ?? 24));
  if (!Number.isFinite(horas) || horas < 1 || horas > 24) {
    throw new Error("O intervalo da busca automática vai de 1 a 24 horas.");
  }
  return {
    distribuicao_automatica: c.distribuicao_automatica === true,
    distribuicao_intervalo_horas: horas,
    ciencia_automatica: c.ciencia_automatica === true,
  };
}
