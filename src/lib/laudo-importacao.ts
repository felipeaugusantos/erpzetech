import { chaveLaudo, type ItemLaudo, type LaudoPdf } from "./laudo-exame-pdf.ts";

export type ModeloImportacao = { id: string; nome: string; tipo: string; ativo: boolean; campos: { nome: string; unidade: string | null; forma: string; ativo: boolean }[] };
export type GrupoImportacao = { nome: string; tipo: string; modelo_id: string | null; itens: ItemLaudo[] };

/** Keep every recognized value in the review; ambiguous mappings require an explicit model choice. */
export function agruparLaudoImportacao(laudo: LaudoPdf, modelos: ModeloImportacao[]): GrupoImportacao[] {
  const grupos = new Map<string, GrupoImportacao>();
  for (const item of laudo.itens) {
    const hemograma = /^(hemacias|hemoglobina|hematocrito|vcm|hcm|chcm|rdw|leucocitos|metamielocitos|bastonetes|segmentados|eosinofilos|linfocitos|monocitos|basofilos)/.test(chaveLaudo(item.nome));
    const bioquimica = /^(alt|creatinina|ureia|fosfatase|albumina)/.test(chaveLaudo(item.nome));
    const nome = hemograma ? "Hemograma" : bioquimica ? "Bioquímica" : item.nome;
    const tipo = hemograma ? "hemograma" : bioquimica ? "bioquimica" : "outro";
    const exatos = modelos.filter(m => chaveLaudo(m.nome) === chaveLaudo(nome));
    const compativeis = modelos.filter(m => m.ativo && m.campos.some(c => c.ativo && chaveLaudo(c.nome) === chaveLaudo(item.nome)));
    const modelo = exatos.length === 1 ? exatos[0] : compativeis.length === 1 ? compativeis[0] : undefined;
    if (exatos.length > 1 || (!exatos.length && compativeis.length > 1)) throw new Error(`Há mais de um modelo para ${item.nome}. Confira os modelos antes de importar.`);
    if (modelo && !modelo.ativo) throw new Error(`O modelo ${modelo.nome} está inativo. Reative-o antes de importar.`);
    const k = modelo?.id ?? nome;
    const grupo = grupos.get(k) ?? { nome: modelo?.nome ?? nome, tipo: modelo?.tipo ?? tipo, modelo_id: modelo?.id ?? null, itens: [] };
    grupo.itens.push(item);
    grupos.set(k, grupo);
  }
  return [...grupos.values()];
}