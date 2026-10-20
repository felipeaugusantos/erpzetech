// Vacina sem internet: o que a cópia da visita oferece (catálogo, lotes, serviços), as conferências do formulário e as operações da fila.
// O banco confere tudo de novo ao receber. Se o lote acabou antes do envio, a operação é recusada e fica guardada com o motivo: o
// veterinário escolhe outro lote (a operação mantém a mesma chave, porque a recusa não grava nada) e reenvia.
import { novaOperacao, type OperacaoFila } from "./fila-clinica.ts";

export const TIPO_VACINA_APLICAR = "vacina_aplicar";
export const TIPO_VACINA_EXTERNA = "vacina_externa";

export type LoteDaCopia = {
  id: string;
  lote: string;
  validade: string;
  quantidade: number;
  deposito: string;
};

export type ItemDaCopia = {
  id: string;
  nome: string;
  tipo: string;
  especie: string;
  ativo: boolean;
  lotes: LoteDaCopia[];
};

export type ConsultaDeVacina = {
  agendamentoId: string;
  inicio: string;
  petId: string;
  petNome: string;
  especie: string;
  tutorNome: string;
};

export type PacienteDaVisita = {
  petId: string;
  petNome: string;
  tutorNome: string;
  especie: string;
  /** Cadastro rápido que ainda vai criar o pet (a operação espera por ele). */
  cadastroOpId?: string;
};

const SITUACOES_ATENDIVEIS = ["agendado", "confirmado", "em_atendimento"];

/** Itens do catálogo baixado que servem para a espécie, com os lotes que a cópia trouxe. */
export function itensDaCopia(
  copia: { dados: { catalogo_vacinas: unknown[] } },
  especie: string,
): ItemDaCopia[] {
  const lista: ItemDaCopia[] = [];
  for (const bruto of copia.dados.catalogo_vacinas) {
    const i = bruto as Partial<ItemDaCopia> | null;
    if (!i || typeof i.id !== "string" || typeof i.nome !== "string" || i.ativo === false) continue;
    if (i.especie !== "todas" && i.especie !== especie) continue;
    lista.push({
      id: i.id,
      nome: i.nome,
      tipo: String(i.tipo ?? "vacina"),
      especie: String(i.especie ?? "todas"),
      ativo: true,
      lotes: Array.isArray(i.lotes) ? (i.lotes as LoteDaCopia[]) : [],
    });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function servicosDeVacina(copia: {
  dados: object;
}): { id: string; nome: string; duracaoMin: number }[] {
  const bruto = (copia.dados as { servicos_vacina?: unknown }).servicos_vacina;
  if (!Array.isArray(bruto)) return [];
  const lista: { id: string; nome: string; duracaoMin: number }[] = [];
  for (const s of bruto as { id?: unknown; nome?: unknown; duracao_min?: unknown }[]) {
    if (typeof s?.id !== "string" || typeof s.nome !== "string") continue;
    lista.push({ id: s.id, nome: s.nome, duracaoMin: Number(s.duracao_min) || 0 });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

type ItemAgenda = {
  id?: unknown;
  inicio?: unknown;
  situacao?: unknown;
  pet?: { id?: unknown; nome?: unknown; especie?: unknown } | null;
  tutor?: { nome?: unknown } | null;
  servicos?: { categoria?: unknown }[] | null;
};

/** Consultas de vacina da agenda baixada que ainda podem receber aplicação. */
export function consultasDeVacina(copia: { dados: { agenda: unknown[] } }): ConsultaDeVacina[] {
  const lista: ConsultaDeVacina[] = [];
  for (const bruto of copia.dados.agenda) {
    const a = bruto as ItemAgenda | null;
    if (!a || typeof a.id !== "string" || typeof a.inicio !== "string") continue;
    if (typeof a.situacao !== "string" || !SITUACOES_ATENDIVEIS.includes(a.situacao)) continue;
    if (!(a.servicos ?? []).some((s) => s?.categoria === "vacina")) continue;
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

type PayloadAplicar = { estoque_lote_id?: unknown };

/** Doses já reservadas por aplicações ainda na fila (não recusadas) para este lote. */
export function dosesReservadas(fila: readonly OperacaoFila[], loteId: string): number {
  return fila.filter(
    (op) =>
      op.tipo === TIPO_VACINA_APLICAR &&
      op.estado === "pendente" &&
      (op.payload as PayloadAplicar | null)?.estoque_lote_id === loteId,
  ).length;
}

/** Lotes que ainda servem: na validade e com saldo depois de descontar o que este notebook já aplicou e não enviou. */
export function lotesDisponiveis(
  item: Pick<ItemDaCopia, "lotes">,
  fila: readonly OperacaoFila[],
  hoje: string,
): (LoteDaCopia & { saldo: number })[] {
  return item.lotes
    .map((l) => ({ ...l, saldo: l.quantidade - dosesReservadas(fila, l.id) }))
    .filter((l) => l.validade >= hoje && l.saldo >= 1);
}

export type FormAplicacao = {
  catalogoId: string;
  loteId: string;
  aplicadaEm: string;
  localAplicacao: string;
  observacoes: string;
};

export const aplicacaoVazia = (hoje: string): FormAplicacao => ({
  catalogoId: "",
  loteId: "",
  aplicadaEm: hoje,
  localAplicacao: "",
  observacoes: "",
});

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export function erroDaAplicacao(f: FormAplicacao, hoje: string): string | null {
  if (!f.catalogoId) return "Escolha a vacina ou o vermífugo";
  if (!f.loteId) return "Escolha o lote";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.aplicadaEm)) return "Informe a data da aplicação";
  if (f.aplicadaEm > hoje) return "A aplicação não pode ser no futuro";
  if (diasEntre(f.aplicadaEm, hoje) > 7)
    return "Para aplicação de mais de 7 dias use “aplicada em outro local”";
  if (f.localAplicacao.length > 80) return "O local da aplicação passa de 80 letras";
  return null;
}

export type DestinoDaAplicacao =
  { tipo: "agenda"; agendamentoId: string } | { tipo: "avulsa"; servicoId: string };

export function operacaoDeAplicar(
  paciente: PacienteDaVisita,
  destino: DestinoDaAplicacao,
  item: Pick<ItemDaCopia, "nome">,
  form: FormAplicacao,
  agora: Date = new Date(),
  id?: string,
): OperacaoFila {
  const payload: Record<string, string> = {
    catalogo_id: form.catalogoId,
    estoque_lote_id: form.loteId,
    aplicada_em: form.aplicadaEm,
  };
  if (form.localAplicacao.trim()) payload["local_aplicacao"] = form.localAplicacao.trim();
  if (form.observacoes.trim()) payload["observacoes"] = form.observacoes.trim();
  if (destino.tipo === "agenda") payload["agendamento_id"] = destino.agendamentoId;
  else {
    payload["pet_id"] = paciente.petId;
    payload["servico_id"] = destino.servicoId;
  }
  return novaOperacao(
    {
      tipo: TIPO_VACINA_APLICAR,
      descricao: `Vacina: ${item.nome} em ${paciente.petNome} (tutor ${paciente.tutorNome})`,
      payload,
      dependeDe: paciente.cadastroOpId ? [paciente.cadastroOpId] : [],
    },
    id,
    agora,
  );
}

export type FormExterna = {
  catalogoId: string;
  aplicadaEm: string;
  informadoPor: string;
  lote: string;
  observacoes: string;
};

export const externaVazia = (hoje: string): FormExterna => ({
  catalogoId: "",
  aplicadaEm: hoje,
  informadoPor: "",
  lote: "",
  observacoes: "",
});

export function erroDaExterna(f: FormExterna, hoje: string): string | null {
  if (!f.catalogoId) return "Escolha a vacina ou o vermífugo";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.aplicadaEm)) return "Informe a data da aplicação";
  if (f.aplicadaEm > hoje) return "A aplicação não pode ser no futuro";
  if (!f.informadoPor.trim())
    return "Informe quem passou a informação (tutor, carteira, outra clínica)";
  return null;
}

export function operacaoDeExterna(
  paciente: PacienteDaVisita,
  item: Pick<ItemDaCopia, "nome">,
  form: FormExterna,
  agora: Date = new Date(),
  id?: string,
): OperacaoFila {
  const payload: Record<string, string> = {
    pet_id: paciente.petId,
    catalogo_id: form.catalogoId,
    aplicada_em: form.aplicadaEm,
    informado_por: form.informadoPor.trim(),
  };
  if (form.lote.trim()) payload["lote"] = form.lote.trim();
  if (form.observacoes.trim()) payload["observacoes"] = form.observacoes.trim();
  return novaOperacao(
    {
      tipo: TIPO_VACINA_EXTERNA,
      descricao: `Vacina de outro local: ${item.nome} em ${paciente.petNome} (tutor ${paciente.tutorNome})`,
      payload,
      dependeDe: paciente.cadastroOpId ? [paciente.cadastroOpId] : [],
    },
    id,
    agora,
  );
}

/**
 * A pessoa escolheu outro lote para uma aplicação recusada. A operação segue com a mesma chave (a recusa do banco não grava nada)
 * e volta a pendente; a ordem e as dependências não mudam.
 */
export function trocarLote(op: OperacaoFila, loteId: string): OperacaoFila {
  if (op.tipo !== TIPO_VACINA_APLICAR || op.estado !== "recusada") return op;
  return {
    ...op,
    payload: { ...(op.payload as Record<string, unknown>), estoque_lote_id: loteId },
    estado: "pendente",
    erro: null,
  };
}

/** O item do catálogo da cópia pelo id (para a troca de lote de uma aplicação recusada). */
export function itemPorId(
  copia: { dados: { catalogo_vacinas: unknown[] } },
  id: string,
): ItemDaCopia | null {
  for (const especie of ["cao", "gato"]) {
    const achado = itensDaCopia(copia, especie).find((i) => i.id === id);
    if (achado) return achado;
  }
  return null;
}
