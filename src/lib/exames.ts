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

/** Campos na ordem do modelo, juntos por grupo (o grupo vale a partir da primeira vez em que aparece). */
export function agruparCampos(
  campos: readonly CampoExame[],
): { grupo: string; campos: CampoExame[] }[] {
  const ordenados = [...campos].sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  const grupos: { grupo: string; campos: CampoExame[] }[] = [];
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
