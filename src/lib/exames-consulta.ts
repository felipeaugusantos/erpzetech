type ExameConsulta = {
  atendimento_id?: string | null;
  data_coleta: string;
  aberto_em: string;
  situacao: string;
};

/** O vínculo explícito vence; laudos antigos só aparecem por data quando há uma única consulta naquele dia. */
export function examesDaConsulta<T extends ExameConsulta>(
  exames: readonly T[],
  atendimentoId: string,
  dia: string,
  consultasNoDia: number,
): T[] {
  return exames.filter(
    (e) =>
      e.situacao !== "cancelado" &&
      (e.atendimento_id
        ? e.atendimento_id === atendimentoId
        : consultasNoDia === 1 && e.data_coleta === dia),
  );
}
