/**
 * Planilha de cotação: o comprador exporta o pedido, manda para o fornecedor
 * e importa de volta a resposta com preços, prazo e condição de pagamento.
 */

export type ItemCotacao = {
  compra_item_id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  custo_atual: number;
};

export type LinhaImportada = {
  compra_item_id: string;
  codigo: string;
  custo_unitario: number;
  observacao: string;
};

export type RespostaImportada = {
  itens: LinhaImportada[];
  prazo_entrega_dias: number | null;
  condicao_pagamento: string;
  ignoradas: number;
};

const SEP = ";";

/** Número no formato brasileiro, como o fornecedor vai digitar no Excel. */
const numeroBR = (v: number) => v.toFixed(2).replace(".", ",");

const escapar = (v: string) => {
  const texto = String(v ?? "");
  return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

export const colunasCotacao = [
  "item_id",
  "codigo",
  "descricao",
  "unidade",
  "quantidade",
  "preco_unitario",
  "prazo_entrega_dias",
  "condicao_pagamento",
  "observacao",
];

/** Monta o CSV (abre direto no Excel) do pedido de cotação. */
export function csvCotacao(itens: ItemCotacao[]) {
  const linhas = [colunasCotacao.join(SEP)];
  for (const i of itens) {
    linhas.push(
      [
        i.compra_item_id,
        escapar(i.codigo),
        escapar(i.descricao),
        escapar(i.unidade),
        numeroBR(i.quantidade),
        "",
        "",
        "",
        "",
      ].join(SEP),
    );
  }
  return `\uFEFF${linhas.join("\r\n")}\r\n`;
}

export function baixarArquivo(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8") {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Aceita vírgula ou ponto como decimal e ignora "R$". */
export function paraNumero(texto: string): number {
  const limpo = String(texto ?? "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!limpo) return 0;
  const usaVirgula = limpo.lastIndexOf(",") > limpo.lastIndexOf(".");
  const normal = usaVirgula ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/,/g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
}

function separarLinha(linha: string, sep: string) {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else dentroDeAspas = !dentroDeAspas;
    } else if (c === sep && !dentroDeAspas) {
      campos.push(atual);
      atual = "";
    } else atual += c;
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Lê a resposta do fornecedor. Casa cada linha pelo item_id da planilha ou,
 * se o fornecedor apagou essa coluna, pelo código do produto.
 */
export function lerRespostaCotacao(texto: string, itens: ItemCotacao[]): RespostaImportada {
  const conteudo = texto.replace(/^\uFEFF/, "");
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length < 2) return { itens: [], prazo_entrega_dias: null, condicao_pagamento: "", ignoradas: 0 };

  const primeira = linhas[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const cabecalho = separarLinha(primeira, sep).map(semAcento);
  const indice = (...nomes: string[]) =>
    cabecalho.findIndex((c) => nomes.some((n) => c === semAcento(n) || c.includes(semAcento(n))));

  const iId = indice("item_id");
  const iCodigo = indice("codigo");
  const iPreco = indice("preco_unitario", "preco", "valor unitario", "custo");
  const iPrazo = indice("prazo_entrega_dias", "prazo");
  const iCondicao = indice("condicao_pagamento", "pagamento");
  const iObs = indice("observacao", "obs");

  const porId = new Map(itens.map((i) => [i.compra_item_id, i]));
  const porCodigo = new Map(itens.map((i) => [semAcento(i.codigo), i]));

  const resultado: LinhaImportada[] = [];
  let prazo: number | null = null;
  let condicao = "";
  let ignoradas = 0;

  for (const linha of linhas.slice(1)) {
    const campos = separarLinha(linha, sep);
    const id = iId >= 0 ? (campos[iId] ?? "").trim() : "";
    const codigo = iCodigo >= 0 ? semAcento(campos[iCodigo] ?? "") : "";
    const item = porId.get(id) ?? porCodigo.get(codigo);
    if (!item) {
      ignoradas += 1;
      continue;
    }
    const preco = iPreco >= 0 ? paraNumero(campos[iPreco] ?? "") : 0;
    if (!(preco > 0)) {
      ignoradas += 1;
      continue;
    }
    resultado.push({
      compra_item_id: item.compra_item_id,
      codigo: item.codigo,
      custo_unitario: preco,
      observacao: iObs >= 0 ? (campos[iObs] ?? "").trim() : "",
    });
    if (prazo === null && iPrazo >= 0) {
      const p = paraNumero(campos[iPrazo] ?? "");
      if (p > 0) prazo = Math.round(p);
    }
    if (!condicao && iCondicao >= 0) condicao = (campos[iCondicao] ?? "").trim();
  }

  return { itens: resultado, prazo_entrega_dias: prazo, condicao_pagamento: condicao, ignoradas };
}

/** Dias de folga que a condição de pagamento dá no caixa (ex.: "30/60" = 45). */
export function diasDePrazo(condicao: string | null | undefined): number {
  const numeros = String(condicao ?? "")
    .match(/\d+/g)
    ?.map(Number)
    .filter((n) => n > 0 && n <= 365);
  if (!numeros || numeros.length === 0) return 0;
  return Math.round(numeros.reduce((s, n) => s + n, 0) / numeros.length);
}

export type PropostaResumo = {
  id: string;
  fornecedor: string;
  valor_total: number;
  prazo_entrega_dias: number | null;
  condicao_pagamento: string | null;
  itens_respondidos: number;
};

export type PropostaAvaliada = PropostaResumo & {
  diferenca: number;
  pontos: number;
  melhorPreco: boolean;
  melhorPrazoEntrega: boolean;
  melhorPagamento: boolean;
  recomendada: boolean;
};

/**
 * Melhor proposta = preço (peso 70), prazo de entrega mais curto (15) e
 * maior prazo de pagamento (15). Nota de 0 a 100.
 */
export function avaliarPropostas(propostas: PropostaResumo[]): PropostaAvaliada[] {
  if (propostas.length === 0) return [];
  const valores = propostas.map((p) => p.valor_total).filter((v) => v > 0);
  const menorValor = Math.min(...(valores.length ? valores : [0]));
  const maiorValor = Math.max(...(valores.length ? valores : [0]));
  const entregas = propostas.map((p) => p.prazo_entrega_dias ?? 0);
  const menorEntrega = Math.min(...entregas);
  const maiorEntrega = Math.max(...entregas);
  const pagamentos = propostas.map((p) => diasDePrazo(p.condicao_pagamento));
  const maiorPagamento = Math.max(...pagamentos);

  const avaliadas = propostas.map((p, idx) => {
    const notaPreco =
      maiorValor === menorValor || p.valor_total <= 0
        ? 1
        : (maiorValor - p.valor_total) / (maiorValor - menorValor);
    const notaEntrega =
      maiorEntrega === menorEntrega
        ? 1
        : (maiorEntrega - (p.prazo_entrega_dias ?? maiorEntrega)) / (maiorEntrega - menorEntrega);
    const notaPagamento = maiorPagamento > 0 ? (pagamentos[idx] ?? 0) / maiorPagamento : 1;
    return {
      ...p,
      diferenca: menorValor > 0 ? p.valor_total - menorValor : 0,
      pontos: Math.round(notaPreco * 70 + notaEntrega * 15 + notaPagamento * 15),
      melhorPreco: p.valor_total > 0 && p.valor_total === menorValor,
      melhorPrazoEntrega: (p.prazo_entrega_dias ?? 0) === menorEntrega && menorEntrega > 0,
      melhorPagamento: maiorPagamento > 0 && (pagamentos[idx] ?? 0) === maiorPagamento,
      recomendada: false,
    };
  });

  const topo = Math.max(...avaliadas.map((a) => a.pontos));
  const vencedora = avaliadas.find((a) => a.pontos === topo);
  return avaliadas
    .map((a) => ({ ...a, recomendada: a.id === vencedora?.id }))
    .sort((a, b) => b.pontos - a.pontos);
}
