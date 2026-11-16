import { chaveLaudo, type ItemLaudo, type LaudoPdf } from "./laudo-exame-pdf.ts";

export type ModeloImportacao = {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  campos: { nome: string; unidade: string | null; forma: string; ativo: boolean }[];
};
export type GrupoImportacao = {
  nome: string;
  tipo: string;
  modelo_id: string | null;
  itens: ItemLaudo[];
  candidatos?: { id: string; nome: string; tipo: string }[];
};

/** Keep every recognized value in the review; ambiguous mappings require an explicit model choice. */
export function agruparLaudoImportacao(
  laudo: LaudoPdf,
  modelos: ModeloImportacao[],
): GrupoImportacao[] {
  const grupos = new Map<string, GrupoImportacao>();
  for (const item of laudo.itens) {
    const hemograma =
      /^(hemacias|hemoglobina|hematocrito|vcm|hcm|chcm|rdw|leucocitos|metamielocitos|bastonetes|segmentados|eosinofilos|linfocitos|monocitos|basofilos)/.test(
        chaveLaudo(item.nome),
      );
    const bioquimica = /^(alt|creatinina|ureia|fosfatase|albumina)/.test(chaveLaudo(item.nome));
    const nome = hemograma ? "Hemograma" : bioquimica ? "Bioquímica" : item.nome;
    const tipo = hemograma ? "hemograma" : bioquimica ? "bioquimica" : "outro";
    const exatos = modelos.filter((m) => chaveLaudo(m.nome) === chaveLaudo(nome));
    const compativeis = modelos.filter(
      (m) =>
        m.ativo && m.campos.some((c) => c.ativo && chaveLaudo(c.nome) === chaveLaudo(item.nome)),
    );
    // The PDF section (e.g. BIOQUÍMICA) disambiguates fields shared by several models.
    const daSecao = item.secao ? compativeis.filter((m) => m.tipo === item.secao) : [];
    const modelo =
      exatos.length === 1
        ? exatos[0]
        : compativeis.length === 1
          ? compativeis[0]
          : !exatos.length && daSecao.length === 1
            ? daSecao[0]
            : undefined;
    if (exatos.length > 1 || (!exatos.length && compativeis.length > 1 && !modelo)) {
      const candidatos = (exatos.length ? exatos : compativeis).filter((m) => m.ativo);
      if (!candidatos.length)
        throw new Error(
          `Os modelos para ${item.nome} estão inativos. Reative um antes de importar.`,
        );
      grupos.set(`escolha:${chaveLaudo(item.nome)}`, {
        nome: item.nome,
        tipo,
        modelo_id: null,
        itens: [item],
        candidatos: candidatos.map(({ id, nome, tipo }) => ({ id, nome, tipo })),
      });
      continue;
    }
    if (modelo && !modelo.ativo)
      throw new Error(`O modelo ${modelo.nome} está inativo. Reative-o antes de importar.`);
    const k = modelo?.id ?? nome;
    const grupo = grupos.get(k) ?? {
      nome: modelo?.nome ?? nome,
      tipo: modelo?.tipo ?? tipo,
      modelo_id: modelo?.id ?? null,
      itens: [],
    };
    const campo = modelo?.campos.find(
      (c) => c.ativo && chaveLaudo(c.nome) === chaveLaudo(item.nome),
    );
    grupo.itens.push(
      campo && unidadesEquivalentes(item.nome, item.unidade, campo.unidade)
        ? { ...item, unidade: campo.unidade }
        : item,
    );
    grupos.set(k, grupo);
  }
  return [...grupos.values()];
}

export function modelosPendentes(grupos: readonly GrupoImportacao[]): boolean {
  return grupos.some(
    (g) => Boolean(g.candidatos?.length) && !g.candidatos?.some((m) => m.id === g.modelo_id),
  );
}

const un = (u: string | null) =>
  chaveLaudo(u ?? "")
    .replace(/\s+/g, "")
    .replace("³", "3");
/** Only numerically identical notations: CHCM in g/dL equals %; spelling variants of the same unit. */
export function unidadesEquivalentes(nome: string, a: string | null, b: string | null): boolean {
  const x = un(a),
    y = un(b);
  if (x === y) return true;
  if (chaveLaudo(nome) === "chcm") return ["g/dl", "%"].includes(x) && ["g/dl", "%"].includes(y);
  const grupos = [
    ["milhoes/mm3", "milh/mm3", "milh/mm", "x106/ul", "10^6/ul"],
    ["fl", "fl."],
    ["u/l", "ui/l", "u.i./l"],
  ];
  return grupos.some((g) => g.includes(x) && g.includes(y));
}

/** Fields whose PDF unit differs from the saved model; import is blocked until the user reviews them. */
export function unidadesDivergentes(
  grupos: readonly GrupoImportacao[],
  modelos: readonly ModeloImportacao[],
): string[] {
  const out: string[] = [];
  for (const g of grupos) {
    const m = modelos.find((x) => x.id === g.modelo_id);
    for (const it of g.itens) {
      const c = m?.campos.find((x) => x.ativo && chaveLaudo(x.nome) === chaveLaudo(it.nome));
      if (c && !unidadesEquivalentes(it.nome, it.unidade, c.unidade))
        out.push(
          `${it.nome}: PDF ${it.unidade ?? "sem unidade"} · modelo ${c.unidade ?? "sem unidade"}`,
        );
    }
  }
  return out;
}
