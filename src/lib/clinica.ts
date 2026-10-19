// Regras da clínica sem dependência de tela: tipos do prontuário, formulário e conferências (as regras de verdade ficam no banco).

export type AdendoClinico = {
  id: string;
  texto: string;
  created_at: string;
  veterinario: string;
  crmv: string;
  crmv_uf: string;
};

export type PetClinico = {
  nome: string;
  especie: string;
  raca: string | null;
  porte: string | null;
  sexo: string | null;
  pelagem: string | null;
  peso_kg: number | null;
  nascimento: string | null;
  castrado: boolean | null;
  alergias: string | null;
};

export type AtendimentoClinico = {
  id: string;
  pet_id: string;
  agendamento_id: string;
  situacao: "aberto" | "fechado";
  aberto_em: string;
  fechado_em: string | null;
  veterinario: { id: string; nome: string; crmv: string; crmv_uf: string };
  queixa: string | null;
  anamnese: string | null;
  peso_kg: number | null;
  temperatura_c: number | null;
  freq_cardiaca: number | null;
  freq_respiratoria: number | null;
  exame_fisico: string | null;
  diagnostico: string | null;
  conduta: string | null;
  retorno_em: string | null;
  observacoes: string | null;
  pet: PetClinico;
  tutor: string;
  adendos: AdendoClinico[];
};

export type FormAtendimento = {
  queixa: string;
  anamnese: string;
  peso_kg: string;
  temperatura_c: string;
  freq_cardiaca: string;
  freq_respiratoria: string;
  exame_fisico: string;
  diagnostico: string;
  conduta: string;
  retorno_em: string;
  observacoes: string;
};

const texto = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : String(v).replace(".", ",");

/** Valores do atendimento como a tela edita (números com vírgula). */
export function formDoAtendimento(a: AtendimentoClinico): FormAtendimento {
  return {
    queixa: a.queixa ?? "",
    anamnese: a.anamnese ?? "",
    peso_kg: texto(a.peso_kg),
    temperatura_c: texto(a.temperatura_c),
    freq_cardiaca: texto(a.freq_cardiaca),
    freq_respiratoria: texto(a.freq_respiratoria),
    exame_fisico: a.exame_fisico ?? "",
    diagnostico: a.diagnostico ?? "",
    conduta: a.conduta ?? "",
    retorno_em: a.retorno_em ?? "",
    observacoes: a.observacoes ?? "",
  };
}

/** O que falta para poder fechar o atendimento (o banco exige o mesmo). */
export function faltaParaFechar(f: Pick<FormAtendimento, "queixa" | "conduta">): string[] {
  const falta: string[] = [];
  if (!f.queixa.trim()) falta.push("queixa");
  if (!f.conduta.trim()) falta.push("conduta");
  return falta;
}

/** Confere os sinais vitais com os mesmos limites do banco; devolve a mensagem do primeiro erro. */
export function erroDosSinais(
  f: Pick<FormAtendimento, "peso_kg" | "temperatura_c" | "freq_cardiaca" | "freq_respiratoria">,
) {
  const num = (s: string) => (s.trim() === "" ? null : Number(s.trim().replace(",", ".")));
  const checa = (valor: number | null, min: number, max: number, nome: string) => {
    if (valor === null) return null;
    if (!Number.isFinite(valor)) return `${nome}: digite um número`;
    if (valor < min || valor > max) return `${nome} fora do esperado (${min} a ${max})`;
    return null;
  };
  return (
    checa(num(f.peso_kg), 0.01, 200, "Peso (kg)") ??
    checa(num(f.temperatura_c), 30, 45, "Temperatura (°C)") ??
    checa(num(f.freq_cardiaca), 10, 400, "Frequência cardíaca") ??
    checa(num(f.freq_respiratoria), 2, 200, "Frequência respiratória")
  );
}

/** Peso de cada atendimento fechado, do mais antigo para o mais novo (para acompanhar a evolução). */
export function evolucaoDoPeso(
  atendimentos: readonly Pick<AtendimentoClinico, "aberto_em" | "peso_kg">[],
) {
  return atendimentos
    .filter((a) => a.peso_kg !== null && a.peso_kg !== undefined)
    .map((a) => ({ em: a.aberto_em, peso: Number(a.peso_kg) }))
    .sort((x, y) => x.em.localeCompare(y.em));
}
