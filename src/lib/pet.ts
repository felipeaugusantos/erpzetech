// Regras do módulo Pet shop sem dependência de tela: rótulos e preço do serviço por porte, raça e pelagem.

export const ESPECIES = [
  { value: "cao", label: "Cão" },
  { value: "gato", label: "Gato" },
  { value: "outro", label: "Outro" },
] as const;

export const PORTES = [
  { value: "mini", label: "Mini" },
  { value: "pequeno", label: "Pequeno" },
  { value: "medio", label: "Médio" },
  { value: "grande", label: "Grande" },
  { value: "gigante", label: "Gigante" },
] as const;

export const PELAGENS = [
  { value: "curta", label: "Curta" },
  { value: "media", label: "Média" },
  { value: "longa", label: "Longa" },
  { value: "dupla", label: "Dupla" },
  { value: "crespa", label: "Crespa" },
  { value: "sem_pelo", label: "Sem pelo" },
] as const;

export const SEXOS = [
  { value: "macho", label: "Macho" },
  { value: "femea", label: "Fêmea" },
] as const;

export const CATEGORIAS_SERVICO = [
  { value: "banho", label: "Banho" },
  { value: "tosa", label: "Tosa" },
  { value: "estetica", label: "Estética" },
  { value: "outro", label: "Outro" },
] as const;

export const FUNCOES_PROFISSIONAL = [
  { value: "banhista", label: "Banhista" },
  { value: "tosador", label: "Tosador" },
  { value: "groomer", label: "Groomer" },
  { value: "veterinario", label: "Veterinário" },
  { value: "auxiliar", label: "Auxiliar" },
  { value: "outro", label: "Outro" },
] as const;

type Opcao = readonly { value: string; label: string }[];

export const rotulo = (lista: Opcao, valor: string | null | undefined) =>
  lista.find((o) => o.value === valor)?.label ?? "";

/** Pontos de cada critério: raça pesa mais que pelagem, que pesa mais que porte (cada combinação tem um total único). */
const PESO_RACA = 4;
const PESO_PELAGEM = 2;
const PESO_PORTE = 1;

export type PetPreco = {
  id?: string;
  porte: string | null;
  raca: string | null;
  pelagem: string | null;
  preco: number;
};

export type PetParaPreco = {
  porte?: string | null;
  raca?: string | null;
  pelagem?: string | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export function pontosDoPreco(p: Pick<PetPreco, "porte" | "raca" | "pelagem">) {
  return (p.raca ? PESO_RACA : 0) + (p.pelagem ? PESO_PELAGEM : 0) + (p.porte ? PESO_PORTE : 0);
}

/** O preço vale para o pet quando cada critério preenchido é igual ao do pet (critério vazio vale para qualquer um). */
export function precoServeAoPet(p: PetPreco, pet: PetParaPreco) {
  if (p.porte && p.porte !== (pet.porte ?? null)) return false;
  if (p.raca && norm(p.raca) !== norm(pet.raca)) return false;
  if (p.pelagem && p.pelagem !== (pet.pelagem ?? null)) return false;
  return true;
}

/** Entre os preços que servem ao pet, vence o mais específico; sem nenhum, o serviço não é oferecido para ele (null). */
export function precoDoServico(precos: readonly PetPreco[], pet: PetParaPreco): PetPreco | null {
  let melhor: PetPreco | null = null;
  for (const p of precos) {
    if (!precoServeAoPet(p, pet)) continue;
    if (!melhor || pontosDoPreco(p) > pontosDoPreco(melhor)) melhor = p;
  }
  return melhor;
}

/** Texto curto dos critérios de um preço: "Poodle · Pelagem longa · Porte pequeno" ou "Qualquer pet". */
export function descricaoDoPreco(p: Pick<PetPreco, "porte" | "raca" | "pelagem">) {
  const partes = [
    p.raca ? p.raca : null,
    p.pelagem ? `Pelagem ${rotulo(PELAGENS, p.pelagem).toLowerCase()}` : null,
    p.porte ? `Porte ${rotulo(PORTES, p.porte).toLowerCase()}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Qualquer pet";
}

/** Idade em texto a partir do nascimento (AAAA-MM-DD). */
export function idadeDoPet(nascimento: string | null | undefined, hoje = new Date()) {
  if (!nascimento) return "";
  const n = new Date(`${nascimento}T00:00:00`);
  if (Number.isNaN(n.getTime())) return "";
  let meses = (hoje.getFullYear() - n.getFullYear()) * 12 + (hoje.getMonth() - n.getMonth());
  if (hoje.getDate() < n.getDate()) meses -= 1;
  if (meses < 0) return "";
  if (meses < 12) return meses === 1 ? "1 mês" : `${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "1 ano" : `${anos} anos`;
}

// ---------- agenda ----------

export type SituacaoAgenda =
  "agendado" | "confirmado" | "em_atendimento" | "pronto" | "retirado" | "cancelado" | "faltou";

export const SITUACOES_AGENDA: readonly { value: SituacaoAgenda; label: string }[] = [
  { value: "agendado", label: "Agendado" },
  { value: "confirmado", label: "Confirmado" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "pronto", label: "Pronto" },
  { value: "retirado", label: "Retirado" },
  { value: "cancelado", label: "Cancelado" },
  { value: "faltou", label: "Faltou" },
];

/** Situações que ocupam o horário do profissional. */
export const ocupaHorario = (s: string) => s !== "cancelado" && s !== "faltou";

/**
 * Próximos passos permitidos (mesma regra de pet_agenda_situacao no banco). "Retirado" não está aqui: sai da cobrança.
 * `motivo` indica os passos que exigem justificativa.
 */
export function proximasSituacoes(
  situacao: string,
): { para: SituacaoAgenda; rotulo: string; motivo: boolean }[] {
  switch (situacao) {
    case "agendado":
      return [
        { para: "confirmado", rotulo: "Confirmar", motivo: false },
        { para: "em_atendimento", rotulo: "Iniciar atendimento", motivo: false },
        { para: "cancelado", rotulo: "Cancelar", motivo: true },
        { para: "faltou", rotulo: "Faltou", motivo: true },
      ];
    case "confirmado":
      return [
        { para: "em_atendimento", rotulo: "Iniciar atendimento", motivo: false },
        { para: "cancelado", rotulo: "Cancelar", motivo: true },
        { para: "faltou", rotulo: "Faltou", motivo: true },
      ];
    case "em_atendimento":
      return [{ para: "pronto", rotulo: "Marcar como pronto", motivo: false }];
    default:
      return [];
  }
}

/** Só dá para remarcar antes de começar. */
export const podeRemarcar = (situacao: string) =>
  situacao === "agendado" || situacao === "confirmado";

export function duracaoTotal(servicos: readonly { duracao_min: number }[]) {
  return servicos.reduce((s, x) => s + x.duracao_min, 0);
}

export function fimDoAtendimento(inicio: Date, minutos: number) {
  return new Date(inicio.getTime() + minutos * 60000);
}

export type Atendimento = {
  id: string;
  profissional_id: string;
  inicio: Date;
  fim: Date;
  situacao: string;
};

/** Dois intervalos se cruzam quando um começa antes de o outro terminar; terminar às 10h e começar às 10h não cruza. */
export function intervalosSeCruzam(aIni: Date, aFim: Date, bIni: Date, bFim: Date) {
  return aIni.getTime() < bFim.getTime() && aFim.getTime() > bIni.getTime();
}

/** O profissional já tem atendimento (que não esteja cancelado/faltou) cruzando este horário? */
export function temConflito(
  atendimentos: readonly Atendimento[],
  profissionalId: string,
  inicio: Date,
  fim: Date,
  ignorarId?: string,
) {
  return atendimentos.some(
    (a) =>
      a.profissional_id === profissionalId &&
      a.id !== ignorarId &&
      ocupaHorario(a.situacao) &&
      intervalosSeCruzam(inicio, fim, a.inicio, a.fim),
  );
}

// ---------- pacotes de banho ----------

export const VALIDADES_PACOTE = [30, 60, 90] as const;

export type PacoteSaldo = {
  id: string;
  pet_id: string;
  servico_id: string;
  situacao: string;
  /** AAAA-MM-DD */
  vence_em: string;
  quantidade: number;
  usados: number;
};

export const restamNoPacote = (p: Pick<PacoteSaldo, "quantidade" | "usados">) =>
  Math.max(p.quantidade - p.usados, 0);

/** Pacote do pet que cobre o serviço: ativo, dentro da validade e com saldo; vence primeiro o que vence antes. */
export function pacoteQueCobre(
  pacotes: readonly PacoteSaldo[],
  petId: string,
  servicoId: string,
  dia: string,
): PacoteSaldo | null {
  return (
    [...pacotes]
      .filter(
        (p) =>
          p.pet_id === petId &&
          p.servico_id === servicoId &&
          p.situacao === "ativo" &&
          p.vence_em >= dia &&
          restamNoPacote(p) > 0,
      )
      .sort((a, b) => a.vence_em.localeCompare(b.vence_em))[0] ?? null
  );
}

/**
 * Aviso da recepção para o banho que vai sair do pacote, dado quantos banhos restam ANTES dele:
 * no penúltimo (restam 2) sobra só 1 depois; no último (restam 1) o pacote acaba.
 */
export function avisoDoPacote(restamAntes: number): string | null {
  if (restamAntes === 2)
    return "Penúltimo banho do pacote: depois deste resta só 1. Avise o tutor.";
  if (restamAntes === 1) return "Último banho do pacote: depois deste ele acaba. Avise o tutor.";
  return null;
}

/** Aviso depois do uso (resposta de pet_agenda_retirar): quantos banhos sobraram. */
export function avisoDepoisDoUso(pet: string, restam: number): string | null {
  if (restam === 1) return `${pet}: o pacote tem só mais 1 banho. Avise o tutor.`;
  if (restam <= 0) return `${pet}: o pacote acabou. Avise o tutor.`;
  return null;
}

/** Dias até o pacote vencer (negativo se já venceu). */
export function diasParaVencer(venceEm: string, hoje: Date = new Date()) {
  const a = new Date(`${venceEm}T12:00:00`).getTime();
  const b = new Date(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}T12:00:00`,
  ).getTime();
  return Math.round((a - b) / 86400000);
}
