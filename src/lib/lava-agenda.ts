// Agenda do lava rápido, sem tela e sem banco: situações, o fim sugerido, o conflito por lavador e por box (a mesma regra do banco),
// a grade do dia e os avisos de preço. O banco é quem decide (supabase/migrations/20261223000000_lava_agenda.sql): aqui é só para a tela
// mostrar o horário livre, sugerir o fim e avisar antes de enviar. Horários sempre no fuso de Brasília (UTC-3, sem horário de verão).

export type SituacaoAgenda = "agendado" | "confirmado" | "concluido" | "cancelado" | "faltou";

export const SITUACOES_AGENDA: { value: SituacaoAgenda; label: string }[] = [
  { value: "agendado", label: "Agendado" },
  { value: "confirmado", label: "Confirmado" },
  { value: "concluido", label: "Chegou (ordem criada)" },
  { value: "cancelado", label: "Cancelado" },
  { value: "faltou", label: "Faltou" },
];

export const rotuloSituacaoAgenda = (s: string) =>
  SITUACOES_AGENDA.find((x) => x.value === s)?.label ?? s;

/** Cancelado e falta liberam o horário; os demais ocupam. */
export const ocupaHorario = (situacao: string) => situacao !== "cancelado" && situacao !== "faltou";

/** Só dá para remarcar e registrar a chegada de agendamento agendado ou confirmado. */
export const podeRemarcar = (situacao: string) =>
  situacao === "agendado" || situacao === "confirmado";
export const podeRegistrarChegada = podeRemarcar;

export type AcaoAgenda = {
  para: "confirmado" | "cancelado" | "faltou";
  rotulo: string;
  motivo: boolean;
};

/** As mudanças de situação que o banco aceita (concluído só pela chegada). */
export function proximasSituacoes(situacao: string): AcaoAgenda[] {
  if (situacao === "agendado")
    return [
      { para: "confirmado", rotulo: "Confirmar", motivo: false },
      { para: "cancelado", rotulo: "Cancelar", motivo: true },
      { para: "faltou", rotulo: "Marcar falta", motivo: false },
    ];
  if (situacao === "confirmado")
    return [
      { para: "cancelado", rotulo: "Cancelar", motivo: true },
      { para: "faltou", rotulo: "Marcar falta", motivo: false },
    ];
  return [];
}

export const somaDuracoes = (duracoes: readonly number[]) => duracoes.reduce((s, d) => s + d, 0);

/** Início mais a soma das durações cadastradas dos serviços. */
export const fimSugerido = (inicio: Date, duracoes: readonly number[]) =>
  new Date(inicio.getTime() + somaDuracoes(duracoes) * 60_000);

/** Intervalo aberto no fim: terminar às 10h e começar às 10h não cruza. */
export function intervalosSeCruzam(aIni: Date, aFim: Date, bIni: Date, bFim: Date) {
  return aIni.getTime() < bFim.getTime() && aFim.getTime() > bIni.getTime();
}

export type RegraAgenda = {
  conflitoLavador: boolean;
  conflitoBox: boolean;
  exigirRecurso: boolean;
};

/** O padrão do banco quando a empresa não configurou. */
export const REGRA_PADRAO: RegraAgenda = {
  conflitoLavador: true,
  conflitoBox: true,
  exigirRecurso: true,
};

export const chaveDoBox = (box: string | null | undefined) => (box ?? "").trim().toLowerCase();

/** Sem lavador e sem box, a agenda não sabe quem ocupa o horário: com a regra padrão é obrigatório um dos dois. */
export function erroDeRecurso(
  lavadorId: string | null | undefined,
  box: string | null | undefined,
  regra: RegraAgenda,
): string | null {
  if (regra.exigirRecurso && !lavadorId && !chaveDoBox(box))
    return "Informe o lavador ou o box do agendamento";
  return null;
}

export type AgendamentoDaGrade = {
  id: string;
  inicio: Date;
  fim: Date;
  situacao: string;
  lavador_id: string | null;
  box: string | null;
};

/** Já existe agendamento (que não seja cancelado ou falta) cruzando este horário no lavador ou no box? Mesma conta do banco. */
export function temConflito(
  existentes: readonly AgendamentoDaGrade[],
  novo: { inicio: Date; fim: Date; lavadorId: string | null; box: string | null },
  regra: RegraAgenda,
  ignorarId?: string,
): "lavador" | "box" | null {
  const box = chaveDoBox(novo.box);
  const ativos = existentes.filter(
    (a) =>
      a.id !== ignorarId &&
      ocupaHorario(a.situacao) &&
      intervalosSeCruzam(novo.inicio, novo.fim, a.inicio, a.fim),
  );
  if (
    regra.conflitoLavador &&
    novo.lavadorId &&
    ativos.some((a) => a.lavador_id === novo.lavadorId)
  )
    return "lavador";
  if (regra.conflitoBox && box && ativos.some((a) => chaveDoBox(a.box) === box)) return "box";
  return null;
}

// ---------- horário de Brasília ----------

/** Instante de "AAAA-MM-DD" + "HH:MM" no horário de Brasília. */
export const instanteBrasilia = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);

/** Valor para <input type="datetime-local"> (horário de Brasília). */
export function paraCampoLocal(d: Date) {
  const b = new Date(d.getTime() - 3 * 3_600_000);
  return b.toISOString().slice(0, 16);
}

/** Lê o que o <input type="datetime-local"> devolveu, como horário de Brasília. Vazio ou inválido volta nulo. */
export function deCampoLocal(valor: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
  const d = new Date(`${valor}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const horaBrasilia = (d: Date) =>
  new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);

// ---------- grade do dia ----------

export type Faixa = {
  inicio: Date;
  fim: Date;
  /** agendamento que ocupa a faixa (o primeiro, se houver mais de um) */
  agendamentoId: string | null;
};

/**
 * Faixas de um dia para um lavador ou um box: cada faixa diz se está livre ou qual agendamento a ocupa.
 * O expediente (abre e fecha) e o passo em minutos são da tela; agendamento fora dele ainda aparece nas faixas que cruza.
 */
export function faixasDoDia(
  agendamentos: readonly AgendamentoDaGrade[],
  dia: string,
  opcoes: { abre: string; fecha: string; passoMin: number },
): Faixa[] {
  const faixas: Faixa[] = [];
  const fim = instanteBrasilia(dia, opcoes.fecha).getTime();
  for (
    let t = instanteBrasilia(dia, opcoes.abre).getTime();
    t < fim;
    t += opcoes.passoMin * 60_000
  ) {
    const ini = new Date(t);
    const f = new Date(Math.min(t + opcoes.passoMin * 60_000, fim));
    const ocupante = agendamentos.find(
      (a) => ocupaHorario(a.situacao) && intervalosSeCruzam(ini, f, a.inicio, a.fim),
    );
    faixas.push({ inicio: ini, fim: f, agendamentoId: ocupante?.id ?? null });
  }
  return faixas;
}

export const agendamentosDoLavador = (ag: readonly AgendamentoDaGrade[], lavadorId: string) =>
  ag.filter((a) => a.lavador_id === lavadorId);

export const agendamentosDoBox = (ag: readonly AgendamentoDaGrade[], box: string) =>
  ag.filter((a) => chaveDoBox(a.box) === chaveDoBox(box));

/** Boxes que aparecem nos agendamentos, sem repetir (maiúsculas e espaços não diferenciam), na ordem em que aparecem. */
export function boxesDosAgendamentos(ag: readonly { box: string | null }[]) {
  const vistos = new Map<string, string>();
  for (const a of ag) {
    const k = chaveDoBox(a.box);
    if (k && !vistos.has(k)) vistos.set(k, (a.box ?? "").trim());
  }
  return [...vistos.values()].sort((x, y) => x.localeCompare(y, "pt-BR", { numeric: true }));
}

// ---------- preço previsto ----------

/**
 * Preço previsto de um serviço para o tipo do veículo: o do tipo, senão o geral, senão o preço do cadastro do serviço (se for maior que zero).
 * Vazio quando não há preço cadastrado: nada é inventado (mesma regra do banco).
 */
export function precoPrevisto(
  precos: readonly { tipo: string | null; preco: number }[],
  tipoVeiculo: string,
  precoCadastro: number | null | undefined,
): number | null {
  const doTipo = precos.find((p) => p.tipo === tipoVeiculo);
  if (doTipo) return Number(doTipo.preco);
  const geral = precos.find((p) => p.tipo === null);
  if (geral) return Number(geral.preco);
  return precoCadastro && Number(precoCadastro) > 0 ? Number(precoCadastro) : null;
}

/** Serviços previstos sem preço cadastrado: a tela mostra a pendência e a chegada é recusada até o preço existir. */
export const servicosSemPreco = (
  itens: readonly { nome: string; preco_estimado: number | null }[],
) => itens.filter((i) => i.preco_estimado === null).map((i) => i.nome);

export const totalPrevisto = (itens: readonly { preco_estimado: number | null }[]) =>
  itens.reduce((s, i) => s + (i.preco_estimado ?? 0), 0);
