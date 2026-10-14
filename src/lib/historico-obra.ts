// Histórico da obra: junta pedidos, entregas, retiradas, ocorrências e agendamentos numa linha do tempo,
// para acompanhar o que foi vendido e o que já saiu, do início ao fim.
import { dateBR, num } from "./format.ts";
import { labelSituacao } from "./pedido.ts";

export type TipoEvento =
  "pedido" | "agendamento" | "reagendamento" | "rota" | "saida" | "insucesso" | "ocorrencia";

export const ROTULO_EVENTO: Record<TipoEvento, string> = {
  pedido: "Pedido",
  agendamento: "Agendamento",
  reagendamento: "Reagendamento",
  rota: "Saída para rota",
  saida: "Retirada / entrega",
  insucesso: "Sem sucesso",
  ocorrencia: "Ocorrência",
};

export type EventoObra = {
  id: string;
  quando: string;
  tipo: TipoEvento;
  pedidoNumero: number | null;
  titulo: string;
  detalhe: string | null;
  usuarioId: string | null;
  itens: { descricao: string; quantidade: number; unidade: string }[];
};

export type PedidoObra = {
  id: string;
  numero: number | null;
  situacao: string;
  created_at: string;
  total?: number | null;
  pedido_itens?: { quantidade: number; quantidade_entregue: number }[] | null;
};
export type HistoricoPedido = {
  id: string;
  pedido_id: string;
  situacao_anterior: string | null;
  situacao_nova: string;
  observacao: string | null;
  usuario_id: string | null;
  created_at: string;
};
export type EntregaObra = {
  id: string;
  pedido_id: string;
  numero: number | null;
  tipo?: string | null;
  situacao: string;
  created_at: string;
  data_entrega: string;
  data_saida?: string | null;
  previsao_data: string | null;
  motivo_insucesso?: string | null;
  recebedor?: string | null;
  responsavel?: string | null;
  observacao?: string | null;
  usuario_id?: string | null;
  entrega_itens?:
    | {
        quantidade: number;
        produtos?: { descricao?: string | null; unidade?: string | null } | null;
      }[]
    | null;
};
export type ReagendamentoObra = {
  id: string;
  entrega_id: string;
  data_anterior: string | null;
  data_nova: string | null;
  motivo: string;
  usuario_id: string | null;
  created_at: string;
};
export type OcorrenciaObra = {
  id: string;
  pedido_id: string;
  etapa: string;
  tipo: string;
  quantidade: number;
  observacao: string | null;
  usuario_id: string | null;
  created_at: string;
  pedido_itens?: {
    produtos?: { descricao?: string | null; unidade?: string | null } | null;
  } | null;
  substituto?: { descricao?: string | null } | null;
};

const TIPO_OCORRENCIA: Record<string, string> = {
  falta: "Falta",
  sobra: "Sobra",
  avaria: "Avaria",
  substituicao: "Substituição",
};
const ETAPA: Record<string, string> = {
  separacao: "separação",
  conferencia: "conferência",
  entrega: "entrega",
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const nomeEntrega = (e: Pick<EntregaObra, "tipo" | "numero">) =>
  `${e.tipo === "retirada" ? "Retirada" : "Entrega"} ${String(e.numero ?? "").padStart(4, "0")}`;
const itensDe = (e: EntregaObra) =>
  (e.entrega_itens ?? [])
    .filter((i) => n(i.quantidade) > 0)
    .map((i) => ({
      descricao: i.produtos?.descricao ?? "—",
      quantidade: n(i.quantidade),
      unidade: i.produtos?.unidade ?? "",
    }));

/** Todos os acontecimentos da obra, do mais antigo ao mais novo. */
export function montarHistoricoObra(d: {
  pedidos: PedidoObra[];
  historico: HistoricoPedido[];
  entregas: EntregaObra[];
  reagendamentos: ReagendamentoObra[];
  ocorrencias: OcorrenciaObra[];
}): EventoObra[] {
  const numeroDe = new Map(d.pedidos.map((p) => [p.id, p.numero]));
  const entregaPorId = new Map(d.entregas.map((e) => [e.id, e]));
  const eventos: EventoObra[] = [];

  for (const h of d.historico) {
    const criado = h.situacao_anterior === null;
    eventos.push({
      id: `h-${h.id}`,
      quando: h.created_at,
      tipo: "pedido",
      pedidoNumero: numeroDe.get(h.pedido_id) ?? null,
      titulo: criado
        ? "Pedido criado"
        : h.situacao_anterior === h.situacao_nova
          ? `Pedido segue em ${labelSituacao(h.situacao_nova).toLowerCase()}`
          : `Pedido: ${labelSituacao(h.situacao_anterior!)} → ${labelSituacao(h.situacao_nova)}`,
      detalhe: h.observacao,
      usuarioId: h.usuario_id,
      itens: [],
    });
  }

  for (const e of d.entregas) {
    const numero = numeroDe.get(e.pedido_id) ?? null;
    const base = { pedidoNumero: numero, itens: itensDe(e) };
    // entrega que foi marcada antes de sair: nasce "planejada" ou com data prevista
    const planejada =
      e.previsao_data !== null || ["planejada", "em_rota", "insucesso"].includes(e.situacao);
    if (planejada) {
      eventos.push({
        ...base,
        id: `ea-${e.id}`,
        quando: e.created_at,
        tipo: "agendamento",
        titulo: `${nomeEntrega(e)} agendada para ${e.previsao_data ? dateBR(e.previsao_data) : "data a definir"}`,
        detalhe: e.responsavel ? `Responsável na obra: ${e.responsavel}` : null,
        usuarioId: e.usuario_id ?? null,
      });
    }
    if (e.data_saida) {
      eventos.push({
        ...base,
        id: `er-${e.id}`,
        quando: e.data_saida,
        tipo: "rota",
        titulo: `${nomeEntrega(e)} saiu para rota`,
        detalhe: null,
        usuarioId: null,
      });
    }
    if (e.situacao === "entregue") {
      eventos.push({
        ...base,
        id: `es-${e.id}`,
        quando: e.data_entrega,
        tipo: "saida",
        titulo: `${nomeEntrega(e)} concluída`,
        detalhe:
          [e.recebedor ? `Recebido por ${e.recebedor}` : null, e.observacao]
            .filter(Boolean)
            .join(" · ") || null,
        usuarioId: e.usuario_id ?? null,
      });
    } else if (e.situacao === "insucesso") {
      eventos.push({
        ...base,
        id: `ei-${e.id}`,
        quando: e.data_entrega,
        tipo: "insucesso",
        titulo: `${nomeEntrega(e)} sem sucesso`,
        detalhe: [e.motivo_insucesso, e.observacao].filter(Boolean).join(" · ") || null,
        usuarioId: null,
      });
    }
  }

  for (const r of d.reagendamentos) {
    const e = entregaPorId.get(r.entrega_id);
    eventos.push({
      id: `rg-${r.id}`,
      quando: r.created_at,
      tipo: "reagendamento",
      pedidoNumero: e ? (numeroDe.get(e.pedido_id) ?? null) : null,
      titulo: `${e ? nomeEntrega(e) : "Entrega"} reagendada de ${dateBR(r.data_anterior)} para ${dateBR(r.data_nova)}`,
      detalhe: r.motivo,
      usuarioId: r.usuario_id,
      itens: [],
    });
  }

  for (const o of d.ocorrencias) {
    const prod = o.pedido_itens?.produtos;
    const subst = o.substituto?.descricao;
    eventos.push({
      id: `oc-${o.id}`,
      quando: o.created_at,
      tipo: "ocorrencia",
      pedidoNumero: numeroDe.get(o.pedido_id) ?? null,
      titulo: `${TIPO_OCORRENCIA[o.tipo] ?? o.tipo} na ${ETAPA[o.etapa] ?? o.etapa}: ${num(n(o.quantidade), 3)} × ${prod?.descricao ?? "item"}${subst ? ` → ${subst}` : ""}`,
      detalhe: o.observacao,
      usuarioId: o.usuario_id,
      itens: [],
    });
  }

  return eventos.sort((a, b) => {
    const t = new Date(a.quando).getTime() - new Date(b.quando).getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

export type ResumoPedido = {
  id: string;
  numero: number | null;
  situacao: string;
  pedido: number;
  entregue: number;
  pendente: number;
  /** 0 a 100. */
  percentual: number;
};

/** Quanto de cada pedido da obra já saiu (soma das quantidades dos itens). */
export function resumoPedidos(pedidos: PedidoObra[]): ResumoPedido[] {
  return [...pedidos]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((p) => {
      const pedido = (p.pedido_itens ?? []).reduce((s, i) => s + n(i.quantidade), 0);
      const entregue = Math.min(
        (p.pedido_itens ?? []).reduce((s, i) => s + n(i.quantidade_entregue), 0),
        pedido,
      );
      return {
        id: p.id,
        numero: p.numero,
        situacao: p.situacao,
        pedido,
        entregue,
        pendente: Math.round((pedido - entregue) * 1000) / 1000,
        percentual: pedido > 0 ? Math.round((entregue / pedido) * 100) : 0,
      };
    });
}

export function filtrarEventos(
  eventos: EventoObra[],
  filtro: { tipos?: TipoEvento[]; pedidoNumero?: number | null },
): EventoObra[] {
  return eventos.filter(
    (e) =>
      (!filtro.tipos || filtro.tipos.length === 0 || filtro.tipos.includes(e.tipo)) &&
      (filtro.pedidoNumero == null || e.pedidoNumero === filtro.pedidoNumero),
  );
}
