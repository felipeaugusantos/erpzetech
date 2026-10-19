// Fila de gravações da clínica feitas sem internet. Cada operação carrega uma chave de repetição (o próprio id), então reenviar não duplica
// no banco. Regras do sistema: operação recusada pelo banco fica guardada com o erro e nunca é descartada sozinha; erro de conexão não é
// recusa (a operação segue pendente); uma operação que depende de outra só sai depois dela. Sem dependência de tela nem de navegador.

export type EstadoOperacao = "pendente" | "recusada";

export type OperacaoFila = {
  /** Chave de repetição: o mesmo id enviado duas vezes vale uma vez. */
  id: string;
  tipo: string;
  /** Texto para a pessoa reconhecer a operação na lista de pendências. */
  descricao: string;
  payload: unknown;
  /** Ids de operações que precisam sair antes (por exemplo, o cadastro do pet antes do atendimento dele). */
  dependeDe: string[];
  criadaEm: string;
  tentativas: number;
  estado: EstadoOperacao;
  erro: string | null;
  ultimaTentativaEm: string | null;
};

export type SituacaoNaFila = "pronta" | "aguardando" | "bloqueada" | "recusada";

export function novaOperacao(
  dados: { tipo: string; descricao: string; payload: unknown; dependeDe?: string[] },
  id: string = crypto.randomUUID(),
  agora: Date = new Date(),
): OperacaoFila {
  return {
    id,
    tipo: dados.tipo,
    descricao: dados.descricao,
    payload: dados.payload,
    dependeDe: dados.dependeDe ?? [],
    criadaEm: agora.toISOString(),
    tentativas: 0,
    estado: "pendente",
    erro: null,
    ultimaTentativaEm: null,
  };
}

/** Na ordem em que foram feitas. */
export function ordenar(fila: readonly OperacaoFila[]): OperacaoFila[] {
  return [...fila].sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id));
}

/**
 * pronta: pode ser enviada agora; aguardando: espera uma operação anterior que ainda não saiu;
 * bloqueada: espera uma operação anterior que o banco recusou; recusada: o banco recusou esta.
 */
export function situacaoNaFila(op: OperacaoFila, fila: readonly OperacaoFila[]): SituacaoNaFila {
  if (op.estado === "recusada") return "recusada";
  const pendentes = op.dependeDe
    .map((id) => fila.find((x) => x.id === id))
    .filter((x): x is OperacaoFila => !!x);
  if (pendentes.length === 0) return "pronta";
  return pendentes.some((d) => d.estado === "recusada" || situacaoNaFila(d, fila) === "bloqueada")
    ? "bloqueada"
    : "aguardando";
}

export function resumoDaFila(fila: readonly OperacaoFila[]) {
  const r = { total: fila.length, prontas: 0, aguardando: 0, bloqueadas: 0, recusadas: 0 };
  for (const op of fila) {
    const s = situacaoNaFila(op, fila);
    if (s === "pronta") r.prontas++;
    else if (s === "aguardando") r.aguardando++;
    else if (s === "bloqueada") r.bloqueadas++;
    else r.recusadas++;
  }
  return r;
}

/** A pessoa pede para tentar de novo uma operação recusada (depois de resolver o motivo). */
export function reabrir(fila: readonly OperacaoFila[], id: string): OperacaoFila[] {
  return fila.map((op) =>
    op.id === id && op.estado === "recusada"
      ? { ...op, estado: "pendente" as const, erro: null }
      : op,
  );
}

export type MudancaFila = { tipo: "remover"; id: string } | { tipo: "atualizar"; op: OperacaoFila };

export type ResultadoEnvio = {
  fila: OperacaoFila[];
  enviadas: number;
  recusadas: number;
  /** Parou por erro de conexão: o resto continua pendente para a próxima vez. */
  interrompida: boolean;
};

/**
 * Envia, em ordem, o que está pronto. Sucesso tira da fila; recusa do banco guarda o erro e segue com o que não depende dela;
 * erro de conexão para tudo sem marcar ninguém como recusado. `aoMudar` grava cada mudança antes de seguir (não se perde nada se a aba fechar).
 */
export async function sincronizar(
  fila: readonly OperacaoFila[],
  enviar: (op: OperacaoFila) => Promise<void>,
  opcoes: {
    ehErroDeRede: (mensagem: string) => boolean;
    aoMudar?: (m: MudancaFila) => Promise<void> | void;
    agora?: () => Date;
  },
): Promise<ResultadoEnvio> {
  const agora = opcoes.agora ?? (() => new Date());
  let atual = ordenar(fila);
  let enviadas = 0;
  let recusadas = 0;
  let interrompida = false;
  const tentadas = new Set<string>();
  for (;;) {
    const proxima = atual.find(
      (op) => !tentadas.has(op.id) && situacaoNaFila(op, atual) === "pronta",
    );
    if (!proxima) break;
    tentadas.add(proxima.id);
    try {
      await enviar(proxima);
      atual = atual.filter((op) => op.id !== proxima.id);
      enviadas++;
      await opcoes.aoMudar?.({ tipo: "remover", id: proxima.id });
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      if (opcoes.ehErroDeRede(mensagem)) {
        interrompida = true;
        break;
      }
      const recusada: OperacaoFila = {
        ...proxima,
        estado: "recusada",
        erro: mensagem,
        tentativas: proxima.tentativas + 1,
        ultimaTentativaEm: agora().toISOString(),
      };
      atual = atual.map((op) => (op.id === proxima.id ? recusada : op));
      recusadas++;
      await opcoes.aoMudar?.({ tipo: "atualizar", op: recusada });
    }
  }
  return { fila: atual, enviadas, recusadas, interrompida };
}
