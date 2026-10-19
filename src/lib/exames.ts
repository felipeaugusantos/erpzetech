// Regras dos modelos de exame sem dependência de tela: tipos, rótulos e conferências (as regras de verdade ficam no banco).

export const TIPOS_EXAME = [
  { value: "hemograma", label: "Hemograma" },
  { value: "bioquimica", label: "Bioquímica" },
  { value: "urina", label: "Urina" },
  { value: "outro", label: "Outro" },
] as const;

export const FORMAS_CAMPO = [
  { value: "numero", label: "Número" },
  { value: "texto", label: "Texto" },
  { value: "escolha", label: "Escolha em lista" },
  { value: "calculado", label: "Calculado (total × percentual)" },
] as const;

export const ESPECIES_FAIXA = [
  { value: "cao", label: "Cão" },
  { value: "gato", label: "Gato" },
  { value: "outro", label: "Outro" },
] as const;

export type FormaCampo = (typeof FORMAS_CAMPO)[number]["value"];
export type EspecieFaixa = (typeof ESPECIES_FAIXA)[number]["value"];

export type FaixaExame = { especie: EspecieFaixa; minimo: number | null; maximo: number | null };

export type CampoExame = {
  id: string;
  ordem: number;
  grupo: string | null;
  nome: string;
  unidade: string | null;
  forma: FormaCampo;
  casas: number | null;
  opcoes: string[] | null;
  observacao: string | null;
  ativo: boolean;
  total_campo_id: string | null;
  pct_campo_id: string | null;
  referencias: FaixaExame[];
};

export type ModeloExame = {
  id: string;
  nome: string;
  tipo: string;
  material: string | null;
  ativo: boolean;
  campos: CampoExame[];
};

/** Número digitado com vírgula ou ponto; vazio vira nulo e texto que não é número vira NaN (para a tela avisar). */
export function numeroOuNulo(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Faixa como aparece na tela: "12 a 18", "até 9000" ou "a partir de 5"; sem faixa, traço. */
export function rotuloFaixa(
  f: Pick<FaixaExame, "minimo" | "maximo"> | undefined,
  unidade?: string | null,
) {
  if (!f || (f.minimo === null && f.maximo === null)) return "—";
  const u = unidade ? ` ${unidade}` : "";
  const fmt = (n: number) => String(n).replace(".", ",");
  if (f.minimo !== null && f.maximo !== null) return `${fmt(f.minimo)} a ${fmt(f.maximo)}${u}`;
  if (f.maximo !== null) return `até ${fmt(f.maximo)}${u}`;
  return `a partir de ${fmt(f.minimo as number)}${u}`;
}

/** Itens na ordem do exame, juntos por grupo (o grupo vale a partir da primeira vez em que aparece). */
export function agruparCampos<T extends { id: string; ordem: number; grupo: string | null }>(
  campos: readonly T[],
): { grupo: string; campos: T[] }[] {
  const ordenados = [...campos].sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  const grupos: { grupo: string; campos: T[] }[] = [];
  for (const c of ordenados) {
    const nome = c.grupo ?? "";
    let g = grupos.find((x) => x.grupo === nome);
    if (!g) {
      g = { grupo: nome, campos: [] };
      grupos.push(g);
    }
    g.campos.push(c);
  }
  return grupos;
}

/** Opções de um campo de escolha, uma por linha, sem linhas vazias nem repetidas. */
export function opcoesDoTexto(texto: string): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const linha of texto.split("\n")) {
    const o = linha.trim();
    if (o && !vistas.has(o)) {
      vistas.add(o);
      saida.push(o);
    }
  }
  return saida;
}

export type FormCampo = {
  nome: string;
  grupo: string;
  unidade: string;
  forma: FormaCampo;
  casas: string;
  opcoes: string;
  total_campo_id: string;
  pct_campo_id: string;
};

/** Confere o formulário do campo com os mesmos limites do banco; devolve a mensagem do primeiro erro. */
export function erroDoCampo(f: FormCampo): string | null {
  if (!f.nome.trim()) return "Informe o nome do campo";
  if (f.nome.trim().length > 80 || f.grupo.trim().length > 80)
    return "Nome ou grupo grande demais (até 80 letras)";
  if (f.unidade.trim().length > 30) return "Unidade grande demais (até 30 letras)";
  if (f.forma === "numero" || f.forma === "calculado") {
    const c = numeroOuNulo(f.casas);
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > 6)) return "Casas decimais de 0 a 6";
  }
  if (f.forma === "escolha") {
    const n = opcoesDoTexto(f.opcoes);
    if (n.length === 0 || n.length > 30) return "Informe de 1 a 30 opções, uma por linha";
    if (n.some((o) => o.length > 60)) return "Cada opção tem até 60 letras";
  }
  if (f.forma === "calculado") {
    if (!f.total_campo_id || !f.pct_campo_id || f.total_campo_id === f.pct_campo_id)
      return "Escolha o campo do total e o campo do percentual (dois campos diferentes)";
  }
  return null;
}

/** Faixa digitada (mínimo e máximo): erro do primeiro problema ou null; os dois em branco tiram a faixa. */
export function erroDaFaixa(minimo: string, maximo: string): string | null {
  const a = numeroOuNulo(minimo);
  const b = numeroOuNulo(maximo);
  if ((a !== null && Number.isNaN(a)) || (b !== null && Number.isNaN(b)))
    return "Digite só números na faixa";
  if (a !== null && b !== null && a > b) return "O mínimo não pode passar do máximo";
  return null;
}

// ============ resultado do exame ============

export type ResultadoExame = {
  id: string;
  ordem: number;
  grupo: string | null;
  nome: string;
  unidade: string | null;
  forma: FormaCampo;
  casas: number | null;
  opcoes: string[] | null;
  total_id: string | null;
  pct_id: string | null;
  faixa_min: number | null;
  faixa_max: number | null;
  valor_num: number | null;
  valor_texto: string | null;
  nota: string | null;
};

export type AdendoExame = {
  id: string;
  texto: string;
  created_at: string;
  veterinario: string;
  crmv: string;
  crmv_uf: string;
};

export type ExameClinico = {
  id: string;
  pet_id: string;
  atendimento_id: string | null;
  nome: string;
  tipo: string;
  material: string | null;
  laboratorio: string | null;
  data_coleta: string;
  observacoes: string | null;
  situacao: "aberto" | "fechado" | "cancelado";
  aberto_em: string;
  fechado_em: string | null;
  cancelado_em: string | null;
  cancelado_motivo: string | null;
  veterinario: { id: string; nome: string; crmv: string; crmv_uf: string };
  pet: {
    nome: string;
    especie: string;
    raca: string | null;
    sexo: string | null;
    nascimento: string | null;
  };
  tutor: string;
  resultados: ResultadoExame[];
  adendos: AdendoExame[];
};

export type ResumoExame = {
  id: string;
  nome: string;
  tipo: string;
  situacao: "aberto" | "fechado" | "cancelado";
  data_coleta: string;
  laboratorio: string | null;
  atendimento_id: string | null;
  aberto_em: string;
  veterinario: string;
  preenchidos: number;
  total: number;
};

export type PontoEvolucao = {
  exame_id: string;
  exame: string;
  data_coleta: string;
  valor: number;
  faixa_min: number | null;
  faixa_max: number | null;
  casas: number | null;
};

export const SITUACOES_EXAME = [
  { value: "aberto", label: "Em preenchimento" },
  { value: "fechado", label: "Fechado" },
  { value: "cancelado", label: "Cancelado" },
] as const;

/** Número com as casas do campo e vírgula (sem casas definidas, como veio). */
export function formatarNumero(n: number, casas: number | null | undefined): string {
  const t = casas === null || casas === undefined ? String(n) : n.toFixed(casas);
  return t.replace(".", ",");
}

/** Valor do resultado como aparece no laudo: número com as casas do campo, texto ou traço (não feito). */
export function valorDoResultado(
  r: Pick<ResultadoExame, "forma" | "casas" | "valor_num" | "valor_texto">,
): string {
  if (r.forma === "texto" || r.forma === "escolha") return r.valor_texto ?? "—";
  return r.valor_num === null ? "—" : formatarNumero(r.valor_num, r.casas);
}

/** Onde o valor está em relação à faixa de referência; sem valor ou sem faixa, não destaca nada. */
export function situacaoNaFaixa(
  valor: number | null,
  min: number | null,
  max: number | null,
): "abaixo" | "acima" | "dentro" | null {
  if (valor === null || Number.isNaN(valor)) return null;
  if (min === null && max === null) return null;
  if (min !== null && valor < min) return "abaixo";
  if (max !== null && valor > max) return "acima";
  return "dentro";
}

/** Mesma conta do banco para o campo calculado: total × percentual ÷ 100, com as casas do campo. */
export function calcularAbsoluto(
  total: number | null,
  pct: number | null,
  casas: number | null,
): number | null {
  if (total === null || pct === null || Number.isNaN(total) || Number.isNaN(pct)) return null;
  const f = 10 ** (casas ?? 2);
  return Math.round((total * pct * f) / 100) / f;
}

/** Valores numéricos como a tela está editando (texto digitado) e, para os calculados, o valor refeito na hora. */
export function valoresNumericos(
  resultados: readonly ResultadoExame[],
  digitado: Readonly<Record<string, string>>,
): Record<string, number | null> {
  const v: Record<string, number | null> = {};
  for (const r of resultados) {
    if (r.forma === "numero") {
      const n = numeroOuNulo(digitado[r.id] ?? "");
      v[r.id] = n === null || Number.isNaN(n) ? null : n;
    }
  }
  for (const r of resultados) {
    if (r.forma === "calculado") {
      v[r.id] = calcularAbsoluto(v[r.total_id ?? ""] ?? null, v[r.pct_id ?? ""] ?? null, r.casas);
    }
  }
  return v;
}

/** Aviso quando o diferencial do leucograma (os percentuais que alimentam os absolutos) está todo preenchido e não soma 100%. */
export function avisoDiferencial(
  resultados: readonly ResultadoExame[],
  valores: Readonly<Record<string, number | null>>,
): string | null {
  const porTotal = new Map<string, Set<string>>();
  for (const r of resultados) {
    if (r.forma === "calculado" && r.total_id && r.pct_id) {
      const set = porTotal.get(r.total_id) ?? new Set<string>();
      set.add(r.pct_id);
      porTotal.set(r.total_id, set);
    }
  }
  for (const [total, pcts] of porTotal) {
    if ((valores[total] ?? null) === null) continue;
    const lista = [...pcts].map((id) => valores[id] ?? null);
    if (lista.some((x) => x === null)) continue;
    const soma = lista.reduce<number>((a, b) => a + (b ?? 0), 0);
    if (Math.abs(soma - 100) > 0.5) {
      return `O diferencial soma ${formatarNumero(Math.round(soma * 10) / 10, null)}% (deveria somar 100%). Confira os percentuais.`;
    }
  }
  return null;
}

/** Variação entre dois valores seguidos da evolução. */
export function variacao(
  anterior: number | null,
  atual: number,
): "subiu" | "desceu" | "igual" | null {
  if (anterior === null) return null;
  if (atual > anterior) return "subiu";
  if (atual < anterior) return "desceu";
  return "igual";
}
