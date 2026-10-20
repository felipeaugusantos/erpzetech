// Indicadores do dashboard de clínica veterinária e pet shop, calculados sobre a agenda. Sem dependência de tela nem de banco.
// "Concluído" é o atendimento que chegou a pronto ou retirado; faltas e cancelamentos não entram no faturamento.
import { isoBrasilia } from "./fuso.ts";

export type ItemAgenda = { preco_aplicado: number; servico: string };
export type AgendamentoDash = {
  id: string;
  inicio: string;
  situacao: string;
  cliente_id: string;
  itens: ItemAgenda[];
};

const CONCLUIDAS = ["pronto", "retirado"];
const ABERTAS = ["agendado", "confirmado"];

const dia = (inicio: string) => isoBrasilia(new Date(inicio));

/** Soma (ou subtrai) dias de uma data AAAA-MM-DD. */
export function somaDiasISO(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const noPeriodo = (ags: readonly AgendamentoDash[], de: string, ate: string) =>
  ags.filter((a) => {
    const d = dia(a.inicio);
    return d >= de && d <= ate;
  });

const receita = (a: AgendamentoDash) => a.itens.reduce((s, i) => s + Number(i.preco_aplicado), 0);

/** A agenda do dia: o que está marcado, em andamento e concluído (faltas e cancelamentos à parte). */
export function agendaDoDia(ags: readonly AgendamentoDash[], hoje: string) {
  const doDia = ags.filter((a) => dia(a.inicio) === hoje);
  const validos = doDia.filter((a) => a.situacao !== "cancelado" && a.situacao !== "faltou");
  return {
    total: validos.length,
    emAtendimento: validos.filter((a) => a.situacao === "em_atendimento").length,
    concluidos: validos.filter((a) => CONCLUIDAS.includes(a.situacao)).length,
    aguardando: validos.filter((a) => ABERTAS.includes(a.situacao)).length,
  };
}

/** Faturamento dos atendimentos concluídos no período e o ticket médio por atendimento. */
export function faturamento(ags: readonly AgendamentoDash[], de: string, ate: string) {
  const feitos = noPeriodo(ags, de, ate).filter((a) => CONCLUIDAS.includes(a.situacao));
  const total = feitos.reduce((s, a) => s + receita(a), 0);
  return { total, atendimentos: feitos.length, ticket: feitos.length ? total / feitos.length : 0 };
}

/** Faltas e cancelamentos do período sobre tudo o que estava marcado. */
export function faltas(ags: readonly AgendamentoDash[], de: string, ate: string) {
  const todos = noPeriodo(ags, de, ate);
  const f = todos.filter((a) => a.situacao === "faltou").length;
  const c = todos.filter((a) => a.situacao === "cancelado").length;
  return {
    total: todos.length,
    faltas: f,
    cancelados: c,
    taxa: todos.length ? ((f + c) / todos.length) * 100 : 0,
  };
}

/** Marcados daqui para frente (ainda por vir) e os dos próximos dias. */
export function aFrente(ags: readonly AgendamentoDash[], agora: Date, dias = 7) {
  const limite = agora.getTime() + dias * 86_400_000;
  const futuros = ags.filter(
    (a) => ABERTAS.includes(a.situacao) && new Date(a.inicio).getTime() >= agora.getTime(),
  );
  return {
    total: futuros.length,
    proximosDias: futuros.filter((a) => new Date(a.inicio).getTime() <= limite).length,
  };
}

/**
 * Retorno dos clientes: ativos são os que tiveram atendimento concluído nos últimos 12 meses; sem retorno são os ativos que não voltaram
 * nos últimos `dias` dias.
 */
export function clientesSemRetorno(ags: readonly AgendamentoDash[], hoje: string, dias = 90) {
  const inicioAno = somaDiasISO(hoje, -365);
  const corte = somaDiasISO(hoje, -dias);
  const ultima = new Map<string, string>();
  for (const a of ags) {
    if (!CONCLUIDAS.includes(a.situacao)) continue;
    const d = dia(a.inicio);
    if (d < inicioAno || d > hoje) continue;
    if ((ultima.get(a.cliente_id) ?? "") < d) ultima.set(a.cliente_id, d);
  }
  const semRetorno = [...ultima.values()].filter((d) => d < corte).length;
  return { ativos: ultima.size, semRetorno };
}

/** Serviços que mais faturaram no período, só dos atendimentos concluídos. */
export function servicosMaisVendidos(
  ags: readonly AgendamentoDash[],
  de: string,
  ate: string,
  n = 5,
) {
  const mapa = new Map<string, { servico: string; quantidade: number; total: number }>();
  for (const a of noPeriodo(ags, de, ate).filter((x) => CONCLUIDAS.includes(x.situacao))) {
    for (const i of a.itens) {
      const linha = mapa.get(i.servico) ?? { servico: i.servico, quantidade: 0, total: 0 };
      linha.quantidade += 1;
      linha.total += Number(i.preco_aplicado);
      mapa.set(i.servico, linha);
    }
  }
  return [...mapa.values()].sort((x, y) => y.total - x.total).slice(0, n);
}

/** Atendimentos concluídos por dia do período (dias sem atendimento aparecem com zero). */
export function atendimentosPorDia(ags: readonly AgendamentoDash[], de: string, ate: string) {
  const contagem = new Map<string, number>();
  for (const a of noPeriodo(ags, de, ate).filter((x) => CONCLUIDAS.includes(x.situacao)))
    contagem.set(dia(a.inicio), (contagem.get(dia(a.inicio)) ?? 0) + 1);
  const lista: { dia: string; atendimentos: number }[] = [];
  for (let d = de; d <= ate && lista.length < 62; d = somaDiasISO(d, 1))
    lista.push({ dia: d, atendimentos: contagem.get(d) ?? 0 });
  return lista;
}
