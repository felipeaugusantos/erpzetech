// Valor aproximado dos tributos (Lei 12.741/2012, Decreto 8.264/2014): na venda a consumidor final a nota informa
// uma estimativa do total de tributos por item (vTotTrib), no total e em texto nas informações complementares.
// As alíquotas por NCM vêm da tabela da IBPT, que a EMPRESA importa (o sistema não traz valores prontos). Regras
// puras, sem rede nem banco.

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export type RegraTributos = {
  ncm: string;
  aliq_nacional_federal: number;
  aliq_importado_federal: number;
  aliq_estadual: number;
  aliq_municipal: number;
  /** AAAA-MM-DD; sem data = não vence. */
  vigencia_fim?: string | null;
  versao?: string | null;
  fonte?: string | null;
};

/** Origem da mercadoria importada (1, 2, 3, 6, 7, 8): usa a alíquota federal de importados. */
export const origemImportada = (origem: unknown) => [1, 2, 3, 6, 7, 8].includes(Number(origem));

/** A regra só vale dentro da vigência (a IBPT atualiza a tabela e a lei manda usar a vigente). */
export function regraVigente(r: RegraTributos, hoje: string): boolean {
  return !r.vigencia_fim || r.vigencia_fim >= hoje;
}

export type TributosItem = { federal: number; estadual: number; municipal: number; total: number };

/** Tributos aproximados de um item: valor × alíquotas da NCM (federal pela origem), em 2 casas. */
export function tributosDoItem(valor: number, origem: unknown, r: RegraTributos): TributosItem {
  const base = Math.max(0, Number(valor) || 0);
  const pFederal = origemImportada(origem) ? r.aliq_importado_federal : r.aliq_nacional_federal;
  const federal = arred((base * pFederal) / 100);
  const estadual = arred((base * r.aliq_estadual) / 100);
  const municipal = arred((base * r.aliq_municipal) / 100);
  return { federal, estadual, municipal, total: arred(federal + estadual + municipal) };
}

export type TotaisTributos = TributosItem & { baseTotal: number };

export function somarTributos(itens: { valor: number; t: TributosItem }[]): TotaisTributos {
  const soma = (f: (t: TributosItem) => number) => arred(itens.reduce((s, i) => s + f(i.t), 0));
  return {
    federal: soma((t) => t.federal),
    estadual: soma((t) => t.estadual),
    municipal: soma((t) => t.municipal),
    total: soma((t) => t.total),
    baseTotal: arred(itens.reduce((s, i) => s + (Number(i.valor) || 0), 0)),
  };
}

const reais = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Texto das informações complementares: valor e percentual por esfera e a fonte (Decreto 8.264/2014). */
export function textoTributos(t: TotaisTributos, fonte: string, versao?: string | null): string {
  const pct = t.baseTotal > 0 ? (t.total / t.baseTotal) * 100 : 0;
  const origem = `Fonte: ${fonte}${versao ? ` (versão ${versao})` : ""}`;
  return (
    `Valor aproximado dos tributos: R$ ${reais(t.total)} (${reais(pct)}%) — ` +
    `Federal R$ ${reais(t.federal)}, Estadual R$ ${reais(t.estadual)}, Municipal R$ ${reais(t.municipal)}. ${origem}.`
  );
}

// ---------------------------------------------------------------------------------------------
// Leitura do CSV da IBPT (tabela por UF, separador ";", decimal com vírgula)

export type LinhaIbpt = {
  ncm: string;
  aliq_nacional_federal: number;
  aliq_importado_federal: number;
  aliq_estadual: number;
  aliq_municipal: number;
  vigencia_fim: string | null;
  versao: string | null;
  fonte: string | null;
};

const numero = (v: string) => {
  const n = Number(
    String(v ?? "")
      .trim()
      .replace(/\./g, "")
      .replace(",", "."),
  );
  // "1.65" (ponto decimal) vira 165 acima: tenta de novo sem remover o ponto quando não há vírgula
  if (!String(v).includes(",")) return Number(String(v ?? "").trim());
  return n;
};

/** dd/mm/aaaa → aaaa-mm-dd; vazio ou inválido → null. */
function dataIso(v: string): string | null {
  const m = String(v ?? "")
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Lê o texto do CSV pelos NOMES das colunas (codigo, tipo, ex, nacionalfederal, importadosfederal, estadual,
 * municipal, vigenciafim, versao, fonte), então uma mudança de ordem não quebra. Só entram linhas de produto
 * (tipo 0), sem exceção tarifária (ex vazio) e com NCM de 8 dígitos. Linhas inválidas são contadas, não importadas.
 */
export function lerCsvIbpt(texto: string): { linhas: LinhaIbpt[]; ignoradas: number } {
  const linhasTexto = String(texto ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (linhasTexto.length < 2) throw new Error("O arquivo está vazio ou sem linhas de dados.");
  const cab = linhasTexto[0]!.split(";").map((c) => c.trim().toLowerCase().replace(/"/g, ""));
  const idx = (nome: string) => cab.indexOf(nome);
  const obrig = ["codigo", "nacionalfederal", "importadosfederal", "estadual", "municipal"];
  const falta = obrig.filter((c) => idx(c) < 0);
  if (falta.length) {
    throw new Error(`Não parece o CSV da IBPT: faltam as colunas ${falta.join(", ")}.`);
  }
  const pega = (cols: string[], nome: string) =>
    idx(nome) >= 0 ? (cols[idx(nome)] ?? "").trim().replace(/^"|"$/g, "") : "";
  const linhas: LinhaIbpt[] = [];
  let ignoradas = 0;
  for (const l of linhasTexto.slice(1)) {
    const cols = l.split(";");
    const ncm = pega(cols, "codigo").replace(/\D/g, "");
    const tipo = pega(cols, "tipo");
    const ex = pega(cols, "ex");
    const nums = [
      numero(pega(cols, "nacionalfederal")),
      numero(pega(cols, "importadosfederal")),
      numero(pega(cols, "estadual")),
      numero(pega(cols, "municipal")),
    ];
    const ok =
      ncm.length === 8 &&
      (tipo === "" || tipo === "0") &&
      ex === "" &&
      nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 100);
    if (!ok) {
      ignoradas++;
      continue;
    }
    linhas.push({
      ncm,
      aliq_nacional_federal: nums[0]!,
      aliq_importado_federal: nums[1]!,
      aliq_estadual: nums[2]!,
      aliq_municipal: nums[3]!,
      vigencia_fim: dataIso(pega(cols, "vigenciafim")),
      versao: pega(cols, "versao") || null,
      fonte: pega(cols, "fonte") || null,
    });
  }
  return { linhas, ignoradas };
}
