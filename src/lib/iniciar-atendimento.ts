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
