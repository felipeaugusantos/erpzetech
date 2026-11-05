// Sinais vitais da internação: lógica pura da tela (sem rede). O sistema não conhece faixas, valores normais nem
// alertas: só mostra o que foi registrado, com unidade, horário da medição e autor. Três coisas diferentes:
//   valor 0                  -> medida feita, resultado zero;
//   "não foi possível medir" -> registro sem valor, com o motivo;
//   nenhum registro          -> ninguém mediu (nada é mostrado como zero).

export type ParametroSinal = { id: string; nome: string; unidade: string; ativo: boolean };

export type RegistroSinal = {
  id: string;
  parametro_id: string;
  parametro: string;
  unidade: string;
  valor: number | null;
  observacao: string | null;
  medido_em: string;
  registrado_em: string;
  profissional_id: string;
  profissional: string;
  funcao: string;
  corrige_id: string | null;
  motivo_correcao: string | null;
  anulado: boolean;
  substituido_por: string | null;
  /** vale hoje: não foi substituído por uma correção e não é uma anulação */
  corrente: boolean;
};

export type HistoricoSinais = {
  sou_veterinario: boolean;
  meu_profissional_id: string;
  registros: RegistroSinal[];
};

export const LIMITE_OBSERVACAO = 300;
const PADRAO_VALOR = /^-?\d{1,6}([.,]\d{1,4})?$/;
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export type LeituraValor = { ok: true; valor: number | null } | { ok: false; erro: string };

/** "38,5" ou "38.5" viram 38.5; vazio vira null (sem valor); o resto é recusado (nada de 1e5, NaN ou texto). */
export function lerValor(texto: string): LeituraValor {
  const t = texto.trim();
  if (t === "") return { ok: true, valor: null };
  if (!PADRAO_VALOR.test(t)) return { ok: false, erro: "Use só números (ex.: 38,5)." };
  return { ok: true, valor: Number(t.replace(",", ".")) };
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

/** "38,5 °C". Sem valor devolve "—" (nunca "0"). */
export function formatarValor(valor: number | null, unidade: string): string {
  if (valor === null || valor === undefined) return "—";
  return `${numero.format(valor)} ${unidade}`.trim();
}

/** Texto do registro para a lista: valor, "não medido" com o motivo, ou anulado. */
export function descreverRegistro(r: RegistroSinal): string {
  if (r.anulado) return "Anulado";
  if (r.valor === null || r.valor === undefined) {
    return r.observacao ? `Não medido: ${r.observacao}` : "Não medido";
  }
  return formatarValor(r.valor, r.unidade);
}

export type Serie = {
  /** parâmetro + unidade: medidas em unidades diferentes nunca se misturam na mesma série */
  chave: string;
  parametroId: string;
  nome: string;
  unidade: string;
  /** o que vale hoje, do mais antigo ao mais novo pelo horário da medição (inclui os "não medido") */
  correntes: RegistroSinal[];
  /** todos os registros do parâmetro, inclusive corrigidos e anulações */
  historico: RegistroSinal[];
  /** a medida mais recente que vale e tem valor (null se nunca houve valor) */
  ultimo: RegistroSinal | null;
};

const porHorario = (a: RegistroSinal, b: RegistroSinal) =>
  a.medido_em.localeCompare(b.medido_em) ||
  a.registrado_em.localeCompare(b.registrado_em) ||
  a.id.localeCompare(b.id);

/**
 * Uma série por parâmetro E unidade registrada, em ordem alfabética. Se a clínica trocou a unidade de um parâmetro, as
 * medidas antigas e as novas ficam em séries separadas (cada registro guarda a unidade do momento): 38 °C e 100,4 °F
 * nunca viram uma linha só. Parâmetro sem registro não aparece.
 */
export function agruparSeries(registros: RegistroSinal[]): Serie[] {
  const mapa = new Map<string, RegistroSinal[]>();
  for (const r of registros) {
    const chave = `${r.parametro_id}|${r.unidade}`;
    const lista = mapa.get(chave);
    if (lista) lista.push(r);
    else mapa.set(chave, [r]);
  }
  const series: Serie[] = [];
  for (const [chave, lista] of mapa) {
    const historico = [...lista].sort(porHorario);
    const correntes = historico.filter((r) => r.corrente);
    const comValor = correntes.filter((r) => r.valor !== null);
    const ref = historico[historico.length - 1] as RegistroSinal;
    series.push({
      chave,
      parametroId: ref.parametro_id,
      nome: ref.parametro,
      unidade: ref.unidade,
      correntes,
      historico,
      ultimo: comValor.length ? (comValor[comValor.length - 1] as RegistroSinal) : null,
    });
  }
  return series.sort(
    (a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.unidade.localeCompare(b.unidade, "pt-BR"),
  );
}

/** Do registro original até a correção mais recente, passando por todas as versões (para "ver correções"). */
export function cadeiaDoRegistro(registros: RegistroSinal[], id: string): RegistroSinal[] {
  const porId = new Map(registros.map((r) => [r.id, r]));
  let atual = porId.get(id);
  if (!atual) return [];
  // sobe até o original
  const visitados = new Set<string>();
  while (atual.corrige_id && porId.has(atual.corrige_id) && !visitados.has(atual.id)) {
    visitados.add(atual.id);
    atual = porId.get(atual.corrige_id) as RegistroSinal;
  }
  // desce pelas correções
  const cadeia: RegistroSinal[] = [atual];
  const vistos = new Set<string>([atual.id]);
  while (
    atual.substituido_por &&
    porId.has(atual.substituido_por) &&
    !vistos.has(atual.substituido_por)
  ) {
    atual = porId.get(atual.substituido_por) as RegistroSinal;
    vistos.add(atual.id);
    cadeia.push(atual);
  }
  return cadeia;
}

export type PontoGrafico = { id: string; x: number; y: number; valor: number };
export type Grafico = { pontos: PontoGrafico[]; linha: string; min: number; max: number };

/**
 * Pontos do gráfico de uma série (só os que valem e têm valor). X é proporcional ao horário da medição; Y vai do
 * menor ao maior valor da própria série. Não há faixa normal nem limite desenhado: o gráfico só mostra a evolução.
 */
export function pontosGrafico(
  correntes: RegistroSinal[],
  largura: number,
  altura: number,
  margem = 8,
): Grafico {
  const validos = correntes.filter((r) => r.valor !== null && !r.anulado) as (RegistroSinal & {
    valor: number;
  })[];
  if (validos.length === 0) return { pontos: [], linha: "", min: 0, max: 0 };
  const tempos = validos.map((r) => new Date(r.medido_em).getTime());
  const t0 = Math.min(...tempos);
  const t1 = Math.max(...tempos);
  const valores = validos.map((r) => r.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const larguraUtil = Math.max(largura - 2 * margem, 0);
  const alturaUtil = Math.max(altura - 2 * margem, 0);
  const pontos = validos.map((r, i) => {
    const t = tempos[i] as number;
    const x = t1 === t0 ? largura / 2 : margem + ((t - t0) / (t1 - t0)) * larguraUtil;
    const y = max === min ? altura / 2 : margem + (1 - (r.valor - min) / (max - min)) * alturaUtil;
    return { id: r.id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, valor: r.valor };
  });
  return { pontos, linha: pontos.map((p) => `${p.x},${p.y}`).join(" "), min, max };
}

/** "2026-11-05T14:30" (campo datetime-local, horário do aparelho) -> ISO com fuso; vazio ou inválido -> null. */
export function isoDeDatetimeLocal(texto: string): string | null {
  if (!texto) return null;
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Valor inicial do campo datetime-local ("agora", no horário do aparelho). */
export function datetimeLocalAgora(agora: Date = new Date()): string {
  const d = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export type EntradaFormulario = {
  parametroId: string;
  valorTexto: string;
  observacao: string;
  medidoEmLocal: string;
  admitidoEm: string;
  agora?: Date;
};

/** Mesmas regras do banco, para avisar antes de enviar. O banco continua sendo quem decide. */
export function validarFormulario(e: EntradaFormulario): string | null {
  if (!e.parametroId) return "Escolha o parâmetro.";
  const v = lerValor(e.valorTexto);
  if (!v.ok) return v.erro;
  const obs = e.observacao.trim();
  if (v.valor === null && !obs)
    return "Informe o valor ou explique por que não foi possível medir.";
  if (obs.length > LIMITE_OBSERVACAO)
    return `A observação aceita até ${LIMITE_OBSERVACAO} caracteres.`;
  const agora = (e.agora ?? new Date()).getTime();
  const iso = isoDeDatetimeLocal(e.medidoEmLocal);
  if (e.medidoEmLocal && !iso) return "Horário da medição inválido.";
  if (iso) {
    const t = new Date(iso).getTime();
    if (t < new Date(e.admitidoEm).getTime()) return "A medição não pode ser anterior à admissão.";
    if (t > agora + TOLERANCIA_FUTURO_MS) return "A medição não pode estar no futuro.";
  }
  return null;
}

/** Chave de repetição do envio: o mesmo clique enviado duas vezes não duplica o registro. */
export function novaChaveEnvio(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Quem a tela deixa tentar corrigir (o banco confere de novo): veterinário, ou o autor do registro. */
export function podeCorrigir(
  r: RegistroSinal,
  souVeterinario: boolean,
  meuId: string,
  aberta: boolean,
): boolean {
  return aberta && r.corrente && !r.anulado && (souVeterinario || r.profissional_id === meuId);
}
