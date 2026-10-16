// Tela de pendências fiscais: quais notas pedem atenção e como mostrá-las.

/** Sem retorno da Sefaz depois disso, a nota enviada passa a ser pendência. */
export const MINUTOS_SEM_RETORNO = 15;

export type TipoPendencia = "rejeitada" | "contingencia" | "sem_retorno" | "rascunho";

export const ROTULO_PENDENCIA: Record<TipoPendencia, string> = {
  rejeitada: "Rejeitada",
  contingencia: "Em contingência",
  sem_retorno: "Sem retorno da Sefaz",
  rascunho: "Rascunho com pendência",
};

export const ORDEM_PENDENCIA: TipoPendencia[] = [
  "rejeitada",
  "contingencia",
  "sem_retorno",
  "rascunho",
];

export const ROTULO_MODELO: Record<string, string> = {
  nfe: "NF-e",
  nfce: "NFC-e",
  nfse: "NFS-e",
};

export type NotaPendente = {
  situacao: string;
  modelo: string | null;
  updated_at: string;
  transmitida_em: string | null;
};

/** Devolve o tipo de pendência da nota, ou nulo quando ela não precisa de atenção agora. */
export function classificarNota(nota: NotaPendente, agora: Date): TipoPendencia | null {
  if (nota.situacao === "rejeitada") return "rejeitada";
  if (nota.situacao === "contingencia") return "contingencia";
  if (nota.situacao === "rascunho" && nota.modelo === "nfce") return "rascunho";
  if (nota.situacao === "transmitida") {
    const desde = Date.parse(nota.transmitida_em ?? nota.updated_at);
    if (Number.isNaN(desde)) return "sem_retorno";
    return agora.getTime() - desde > MINUTOS_SEM_RETORNO * 60_000 ? "sem_retorno" : null;
  }
  return null;
}

export function contarPorTipo(notas: NotaPendente[], agora: Date): Record<TipoPendencia, number> {
  const total: Record<TipoPendencia, number> = {
    rejeitada: 0,
    contingencia: 0,
    sem_retorno: 0,
    rascunho: 0,
  };
  for (const n of notas) {
    const tipo = classificarNota(n, agora);
    if (tipo) total[tipo]++;
  }
  return total;
}

export const ROTULO_EVENTO: Record<string, string> = {
  erro: "Falhou",
  ignorado: "Ignorado",
  recebido: "Sem resposta",
};

export const ROTULO_PROVEDOR: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  tef: "Maquininha",
};

export function rotuloProvedor(provedor: string): string {
  return ROTULO_PROVEDOR[provedor] ?? provedor;
}

/**
 * Filtro das notas pendentes para a consulta (PostgREST `or`). A espera da nota enviada entra no filtro, e não só na
 * tela, para o limite de linhas não esconder as notas travadas atrás de centenas de envios recentes.
 */
export function filtroNotasPendentes(agora: Date): string {
  const limite = new Date(agora.getTime() - MINUTOS_SEM_RETORNO * 60_000).toISOString();
  return [
    "situacao.in.(rejeitada,contingencia)",
    "and(modelo.eq.nfce,situacao.eq.rascunho)",
    `and(situacao.eq.transmitida,transmitida_em.lt.${limite})`,
    `and(situacao.eq.transmitida,transmitida_em.is.null,updated_at.lt.${limite})`,
  ].join(",");
}
