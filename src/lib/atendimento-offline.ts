// Atendimento feito sem internet: o que a cópia da visita oferece para atender, o rascunho guardado no cofre e as operações que vão para a fila
// (abrir, salvar, fechar). O atendimento nasce no notebook com id e hora próprios; o banco aceita cada operação uma vez só, pela chave dela.
import { novaOperacao, type OperacaoFila } from "./fila-clinica.ts";
import type { FormAtendimento } from "./clinica.ts";

export const TIPO_VISITA_REGISTRAR = "visita_registrar";
export const TIPO_ATENDIMENTO_SALVAR = "atendimento_salvar";
export const TIPO_ATENDIMENTO_FECHAR = "atendimento_fechar";

/** Prefixo da chave do rascunho na loja "copia" do cofre. */
export const PREFIXO_RASCUNHO = "atendimento:";

const SITUACOES_ATENDIVEIS = ["agendado", "confirmado", "em_atendimento"];

export type RascunhoAtendimento = {
  atendimentoId: string;
  petId: string;
  petNome: string;
  tutorNome: string;
  /** Hora do aparelho em que o atendimento foi aberto. */
  abertoEm: string;
  modo: "consulta_marcada" | "visita_avulsa";
  agendamentoId: string | null;
  servicoId: string | null;
  /** Cadastro rápido que ainda vai criar o pet (o registro do atendimento espera por ele). */
  cadastroOpId: string | null;
  /** Operação que abre o atendimento no banco. */
  registrarOpId: string;
  form: FormAtendimento;
  /** Já foi fechado neste notebook: só leitura, esperando o envio. */
  fechado: boolean;
};

export type ConsultaDaCopia = {
  agendamentoId: string;
  inicio: string;
  petId: string;
  petNome: string;
  especie: string;
  tutorNome: string;
};

export type ServicoConsulta = { id: string; nome: string; duracaoMin: number };

type ItemAgenda = {
  id?: unknown;
  inicio?: unknown;
  situacao?: unknown;
  pet?: { id?: unknown; nome?: unknown; especie?: unknown } | null;
  tutor?: { nome?: unknown } | null;
  servicos?: { categoria?: unknown }[] | null;
};

/** Consultas da agenda baixada que ainda podem ser atendidas. */
export function consultasDaCopia(copia: { dados: { agenda: unknown[] } }): ConsultaDaCopia[] {
  const lista: ConsultaDaCopia[] = [];
  for (const bruto of copia.dados.agenda) {
    const a = bruto as ItemAgenda | null;
    if (!a || typeof a.id !== "string" || typeof a.inicio !== "string") continue;
    if (typeof a.situacao !== "string" || !SITUACOES_ATENDIVEIS.includes(a.situacao)) continue;
    if (!(a.servicos ?? []).some((s) => s?.categoria === "consulta")) continue;
    if (!a.pet || typeof a.pet.id !== "string" || typeof a.pet.nome !== "string") continue;
    lista.push({
      agendamentoId: a.id,
      inicio: a.inicio,
      petId: a.pet.id,
      petNome: a.pet.nome,
      especie: typeof a.pet.especie === "string" ? a.pet.especie : "cao",
      tutorNome: typeof a.tutor?.nome === "string" ? a.tutor.nome : "",
    });
  }
  return lista.sort((x, y) => x.inicio.localeCompare(y.inicio));
}

/** Serviços de consulta da cópia (para a visita sem consulta marcada). Cópias antigas não os trazem. */
export function servicosDeConsulta(copia: { dados: object }): ServicoConsulta[] {
  const bruto = (copia.dados as { servicos_consulta?: unknown }).servicos_consulta;
  if (!Array.isArray(bruto)) return [];
  const lista: ServicoConsulta[] = [];
  for (const s of bruto as { id?: unknown; nome?: unknown; duracao_min?: unknown }[]) {
    if (typeof s?.id !== "string" || typeof s.nome !== "string") continue;
    lista.push({ id: s.id, nome: s.nome, duracaoMin: Number(s.duracao_min) || 0 });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export const formAtendimentoVazio: FormAtendimento = {
  queixa: "",
  anamnese: "",
  peso_kg: "",
  temperatura_c: "",
  freq_cardiaca: "",
  freq_respiratoria: "",
  exame_fisico: "",
  diagnostico: "",
  conduta: "",
  retorno_em: "",
  observacoes: "",
};

export type OrigemDoAtendimento =
  | { tipo: "consulta_marcada"; consulta: ConsultaDaCopia }
  | {
      tipo: "visita_avulsa";
      paciente: { petId: string; petNome: string; tutorNome: string; cadastroOpId?: string };
      servicoId: string;
    };

/** Abre o atendimento no notebook: o rascunho (com o id definitivo) e a operação que o registra no banco. */
export function abrirAtendimento(
  origem: OrigemDoAtendimento,
  agora: Date = new Date(),
  ids: { atendimento?: string; operacao?: string } = {},
): { rascunho: RascunhoAtendimento; operacao: OperacaoFila } {
  const atendimentoId = ids.atendimento ?? crypto.randomUUID();
  const abertoEm = agora.toISOString();
  const marcada = origem.tipo === "consulta_marcada";
  const petId = marcada ? origem.consulta.petId : origem.paciente.petId;
  const petNome = marcada ? origem.consulta.petNome : origem.paciente.petNome;
  const tutorNome = marcada ? origem.consulta.tutorNome : origem.paciente.tutorNome;
  const cadastroOpId = marcada ? null : (origem.paciente.cadastroOpId ?? null);
  const payload: Record<string, string> = {
    atendimento_id: atendimentoId,
    pet_id: petId,
    aberto_em: abertoEm,
  };
  if (marcada) payload["agendamento_id"] = origem.consulta.agendamentoId;
  else payload["servico_id"] = origem.servicoId;
  const operacao = novaOperacao(
    {
      tipo: TIPO_VISITA_REGISTRAR,
      descricao: `Abrir atendimento: ${petNome} (tutor ${tutorNome})`,
      payload,
      dependeDe: cadastroOpId ? [cadastroOpId] : [],
    },
    ids.operacao,
    agora,
  );
  return {
    rascunho: {
      atendimentoId,
      petId,
      petNome,
      tutorNome,
      abertoEm,
      modo: origem.tipo,
      agendamentoId: marcada ? origem.consulta.agendamentoId : null,
      servicoId: marcada ? null : origem.servicoId,
      cadastroOpId,
      registrarOpId: operacao.id,
      form: { ...formAtendimentoVazio },
      fechado: false,
    },
    operacao,
  };
}

type PayloadAtendimento = { atendimento_id?: unknown };

function doAtendimento(op: OperacaoFila, tipo: string, atendimentoId: string): boolean {
  return (
    op.tipo === tipo && (op.payload as PayloadAtendimento | null)?.atendimento_id === atendimentoId
  );
}

/** Operações de salvar ainda na fila (não recusadas) deste atendimento: a mais nova leva o texto todo, então as anteriores saem. */
export function salvamentosSubstituidos(
  fila: readonly OperacaoFila[],
  atendimentoId: string,
): string[] {
  return fila
    .filter(
      (op) => doAtendimento(op, TIPO_ATENDIMENTO_SALVAR, atendimentoId) && op.estado === "pendente",
    )
    .map((op) => op.id);
}

/** O texto do atendimento como o banco espera (sem os campos vazios cortados: o banco limpa). */
export function dadosParaSalvar(form: FormAtendimento): Record<string, string> {
  return { ...form };
}

export function operacaoDeSalvar(
  r: RascunhoAtendimento,
  form: FormAtendimento,
  agora: Date = new Date(),
  id?: string,
): OperacaoFila {
  return novaOperacao(
    {
      tipo: TIPO_ATENDIMENTO_SALVAR,
      descricao: `Salvar atendimento: ${r.petNome}`,
      payload: { atendimento_id: r.atendimentoId, dados: dadosParaSalvar(form) },
      dependeDe: [r.registrarOpId],
    },
    id,
    agora,
  );
}

/** Fechar espera o registro do atendimento e o último salvar (que leva o texto final). */
export function operacaoDeFechar(
  r: RascunhoAtendimento,
  salvarOpId: string,
  agora: Date = new Date(),
  id?: string,
): OperacaoFila {
  return novaOperacao(
    {
      tipo: TIPO_ATENDIMENTO_FECHAR,
      descricao: `Fechar atendimento: ${r.petNome}`,
      payload: { atendimento_id: r.atendimentoId },
      dependeDe: [r.registrarOpId, salvarOpId],
    },
    id,
    agora,
  );
}

/** O rascunho some do cofre quando está fechado e nada dele está mais na fila (tudo foi enviado). */
export function rascunhoJaEnviado(r: RascunhoAtendimento, fila: readonly OperacaoFila[]): boolean {
  if (!r.fechado) return false;
  return !fila.some(
    (op) =>
      op.id === r.registrarOpId ||
      doAtendimento(op, TIPO_ATENDIMENTO_SALVAR, r.atendimentoId) ||
      doAtendimento(op, TIPO_ATENDIMENTO_FECHAR, r.atendimentoId),
  );
}

export type PacienteParaAtender = {
  petId: string;
  petNome: string;
  tutorNome: string;
  cadastroOpId?: string;
};

/** Pets da agenda baixada, sem repetir (para atender sem consulta marcada). */
export function petsDaAgenda(copia: { dados: { agenda: unknown[] } }): PacienteParaAtender[] {
  const vistos = new Map<string, PacienteParaAtender>();
  for (const bruto of copia.dados.agenda) {
    const a = bruto as ItemAgenda | null;
    if (!a?.pet || typeof a.pet.id !== "string" || typeof a.pet.nome !== "string") continue;
    if (vistos.has(a.pet.id)) continue;
    vistos.set(a.pet.id, {
      petId: a.pet.id,
      petNome: a.pet.nome,
      tutorNome: typeof a.tutor?.nome === "string" ? a.tutor.nome : "",
    });
  }
  return [...vistos.values()].sort((x, y) => x.petNome.localeCompare(y.petNome, "pt-BR"));
}

/** Prefixo da chave de um paciente cadastrado sem internet, guardado no cofre mesmo depois que o cadastro sai da fila. */
export const PREFIXO_PACIENTE = "paciente:";
/** Chave do cofre com os agendamentos já atendidos e enviados (a cópia da visita continua listando-os como pendentes). */
export const CHAVE_CONSUMIDOS = "consumidos";

export type PacienteGuardado = PacienteParaAtender & { operacaoId: string; guardadoEm: string };

/** Pacientes guardados que ainda valem (a cópia da visita vence em 7 dias), com a dependência só enquanto o cadastro está na fila. */
export function pacientesGuardados(
  guardados: readonly PacienteGuardado[],
  fila: readonly OperacaoFila[],
  agora: Date = new Date(),
  validadeDias = 7,
): PacienteParaAtender[] {
  const limite = agora.getTime() - validadeDias * 86_400_000;
  return guardados
    .filter((p) => new Date(p.guardadoEm).getTime() > limite)
    .map((p) => {
      const base = { petId: p.petId, petNome: p.petNome, tutorNome: p.tutorNome };
      return fila.some((op) => op.id === p.operacaoId)
        ? { ...base, cadastroOpId: p.operacaoId }
        : base;
    });
}
