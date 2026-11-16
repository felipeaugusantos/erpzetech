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
      exatos.length === 1 ? exatos[0]
        : compativeis.length === 1 ? compativeis[0]
        : !exatos.length && daSecao.length === 1 ? daSecao[0] : undefined;
    if (exatos.length > 1 || (!exatos.length && compativeis.length > 1 && !modelo)) {
      const candidatos = (exatos.length ? exatos : compativeis).filter((m) => m.ativo);
      if (!candidatos.length) throw new Error(`Os modelos para ${item.nome} estão inativos. Reative um antes de importar.`);
      grupos.set(`escolha:${chaveLaudo(item.nome)}`, {
        nome: item.nome, tipo, modelo_id: null, itens: [item],
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
    grupo.itens.push(item);
    grupos.set(k, grupo);
  }
  return [...grupos.values()];
}

export function modelosPendentes(grupos: readonly GrupoImportacao[]): boolean {
  return grupos.some((g) => Boolean(g.candidatos?.length) && !g.candidatos?.some((m) => m.id === g.modelo_id));
}
