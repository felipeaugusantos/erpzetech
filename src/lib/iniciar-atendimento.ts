// Iniciar atendimento pelo Prontuário, sem consulta marcada: a mesma visita avulsa do trabalho sem internet (clinica_visita_registrar),
// com identificadores nascidos aqui para que repetir o pedido (conexão que caiu) não crie um segundo atendimento.

export type ServicoConsulta = { id: string; nome: string; duracao_min: number };

export type DadosVisitaAvulsa = {
  atendimento_id: string;
  pet_id: string;
  servico_id: string;
  aberto_em: string;
};

/** O atendimento ainda aberto do paciente, se houver: continuar é melhor do que abrir outro. */
export function atendimentoAbertoDoPaciente<T extends { situacao: string }>(
  atendimentos: readonly T[],
): T | null {
  return atendimentos.find((a) => a.situacao === "aberto") ?? null;
}

/** Se só há um serviço de consulta, ele já vem escolhido. */
export function servicoInicial(servicos: readonly ServicoConsulta[]): string {
  return servicos.length === 1 ? (servicos[0] as ServicoConsulta).id : "";
}

export function dadosDaVisitaAvulsa(
  petId: string,
  servicoId: string,
  atendimentoId: string = crypto.randomUUID(),
  agora: Date = new Date(),
): DadosVisitaAvulsa {
  return {
    atendimento_id: atendimentoId,
    pet_id: petId,
    servico_id: servicoId,
    aberto_em: agora.toISOString(),
  };
}

/** Confere a lista que o banco devolveu (formato inesperado vira lista vazia, nunca erro de tela). */
export function servicosDaResposta(bruto: unknown): ServicoConsulta[] {
  if (!Array.isArray(bruto)) return [];
  const lista: ServicoConsulta[] = [];
  for (const s of bruto as { id?: unknown; nome?: unknown; duracao_min?: unknown }[]) {
    if (s && typeof s.id === "string" && typeof s.nome === "string")
      lista.push({ id: s.id, nome: s.nome, duracao_min: Number(s.duracao_min) || 0 });
  }
  return lista;
}

/** O pedido em andamento: o mesmo paciente e serviço reaproveitam a chave até o resultado ser conhecido. */
export type TentativaVisita = { chave: string; dados: DadosVisitaAvulsa };

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const CHAVE_TENTATIVA = "zt-iniciar-atendimento";

/**
 * Guarda a tentativa fora da janela (na aba): se a resposta do banco se perder e a janela for fechada ou a página recarregada, o novo
 * pedido leva a mesma chave e o banco devolve a visita já aberta em vez de abrir outra. Só ids, nenhum dado clínico.
 */
export function tentativaDaVisita(
  petId: string,
  servicoId: string,
  armazem: Armazenamento | null,
  nova: () => TentativaVisita = () => ({
    chave: crypto.randomUUID(),
    dados: dadosDaVisitaAvulsa(petId, servicoId),
  }),
): TentativaVisita {
  try {
    const bruto = armazem?.getItem(CHAVE_TENTATIVA);
    if (bruto) {
      const t = JSON.parse(bruto) as TentativaVisita;
      if (t.dados.pet_id === petId && t.dados.servico_id === servicoId) return t;
    }
  } catch {
    /* sem a tentativa guardada: segue com uma nova */
  }
  const t = nova();
  try {
    armazem?.setItem(CHAVE_TENTATIVA, JSON.stringify(t));
  } catch {
    /* sem espaço ou bloqueado: vale só enquanto a janela estiver aberta */
  }
  return t;
}

/** Resultado conhecido (aberto ou recusado pelo banco): a próxima vez é um atendimento novo. */
export function encerrarTentativaDaVisita(armazem: Armazenamento | null) {
  try {
    armazem?.removeItem(CHAVE_TENTATIVA);
  } catch {
    /* nada a limpar */
  }
}
