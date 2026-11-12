// Remédios favoritos do bulário: a dose de costume e a validade anotadas pela clínica. Sem tela nem banco.
export type FavoritoBulario = {
  medicamento_id: string;
  nome: string;
  principio_ativo: string | null;
  fabricante: string | null;
  dose: string | null;
  validade: string | null;
  updated_at: string;
};

export type SituacaoValidade = "vencido" | "vence_logo" | "valido" | "sem_validade";

/** Dias de antecedência para avisar que a validade está chegando. */
export const AVISO_VALIDADE_DIAS = 30;

/** Vencido no dia seguinte à validade; "vence logo" quando faltam até 30 dias. Datas AAAA-MM-DD. */
export function situacaoValidade(validade: string | null, hoje: string): SituacaoValidade {
  if (!validade) return "sem_validade";
  if (validade < hoje) return "vencido";
  const dias = Math.round(
    (Date.parse(`${validade}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000,
  );
  return dias <= AVISO_VALIDADE_DIAS ? "vence_logo" : "valido";
}
