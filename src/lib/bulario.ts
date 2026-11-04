// Bulário veterinário: catálogo de consulta com os produtos veterinários registrados no MAPA (dados abertos do
// SIPEAGRO, licença CC-BY). É uma base global, só de leitura para as empresas; quem carrega é a equipe EZRA.
// Este arquivo lê o CSV do MAPA sem depender de uma ordem fixa de colunas: reconhece cada coluna pelo nome
// (sem acento nem maiúsculas) e guarda o que sobra em "extras". Se nenhuma coluna de nome de produto for achada,
// recusa o arquivo e diz quais colunas encontrou, em vez de importar lixo.

import { lerCsvNumerado, normalizar } from "./importacao.ts";

export const LIMITE_LOTE = 500;
export const FONTE_MAPA = "MAPA/SIPEAGRO — Produto Veterinário (dados abertos, CC-BY)";
export const URL_MAPA =
  "https://dados.agricultura.gov.br/dataset/52a01565-72d6-410e-b21b-64035831a7be/resource/7ce5fac0-9c8f-4e14-82d9-6deab9b5e2e9/download/sipeagroprodutoveterinario.csv";

export type ItemBulario = {
  registro: string | null;
  nome: string;
  fabricante: string | null;
  principio_ativo: string | null;
  especies: string | null;
  classificacao: string | null;
  situacao: string | null;
  extras: Record<string, string>;
};

export type MedicamentoBulario = ItemBulario & { id: string };

const ALIAS: Record<keyof Omit<ItemBulario, "extras">, string[]> = {
  nome: [
    "nome_comercial",
    "nome_do_produto",
    "nome_produto",
    "produto",
    "nome_fantasia",
    "marca_comercial",
    "marca",
    "nome",
    "denominacao",
  ],
  fabricante: [
    "fabricante",
    "empresa",
    "razao_social",
    "razao_social_empresa",
    "titular",
    "titular_do_registro",
    "estabelecimento",
    "nome_empresa",
  ],
  registro: [
    "numero_registro",
    "numero_do_registro",
    "n_registro",
    "nr_registro",
    "num_registro",
    "registro",
    "numero_registro_produto",
  ],
  principio_ativo: [
    "principio_ativo",
    "principios_ativos",
    "substancia_ativa",
    "substancias_ativas",
    "substancia",
    "composicao",
  ],
  especies: [
    "especie",
    "especies",
    "especie_destino",
    "especies_destino",
    "especies_de_destino",
    "especie_animal",
  ],
  classificacao: [
    "classificacao",
    "classe",
    "classe_terapeutica",
    "categoria",
    "tipo_produto",
    "tipo_de_produto",
    "tipo",
    "natureza",
  ],
  situacao: ["situacao", "status", "situacao_registro", "situacao_do_registro", "situacao_produto"],
};

export type LeituraBulario = {
  itens: ItemBulario[];
  /** Colunas do arquivo, como vieram no cabeçalho. */
  colunas: string[];
  /** Linhas ignoradas por falta de nome do produto. */
  ignoradas: number;
  erro?: string;
};

function limpa(v: string | undefined, max: number): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, max);
}

/** Acha o índice da primeira coluna do cabeçalho que bate com algum apelido, na ordem de preferência dos apelidos. */
function achaColuna(norm: string[], apelidos: string[], usadas: Set<number>): number {
  for (const a of apelidos) {
    const i = norm.findIndex((n, k) => n === a && !usadas.has(k));
    if (i >= 0) return i;
  }
  return -1;
}

export function lerBulario(texto: string): LeituraBulario {
  const registros = lerCsvNumerado(texto);
  if (registros.length === 0) {
    return { itens: [], colunas: [], ignoradas: 0, erro: "O arquivo está vazio." };
  }
  const [cab, ...resto] = registros;
  if (!cab) return { itens: [], colunas: [], ignoradas: 0, erro: "O arquivo está vazio." };
  const colunas = cab.celulas;
  const norm = colunas.map(normalizar);
  const usadas = new Set<number>();
  const idx = {} as Record<keyof typeof ALIAS, number>;
  for (const campo of Object.keys(ALIAS) as (keyof typeof ALIAS)[]) {
    idx[campo] = achaColuna(norm, ALIAS[campo], usadas);
    if (idx[campo] >= 0) usadas.add(idx[campo]);
  }
  if (idx.nome < 0) {
    return {
      itens: [],
      colunas,
      ignoradas: 0,
      erro: `Não achei a coluna com o nome do produto. Colunas do arquivo: ${colunas.join(" | ")}`,
    };
  }

  const itens: ItemBulario[] = [];
  let ignoradas = 0;
  for (const r of resto) {
    const c = r.celulas;
    const nome = limpa(c[idx.nome], 200);
    if (!nome) {
      ignoradas += 1;
      continue;
    }
    const extras: Record<string, string> = {};
    colunas.forEach((nomeCol, k) => {
      if (usadas.has(k)) return;
      const v = limpa(c[k], 500);
      if (v && nomeCol.trim()) extras[nomeCol.trim().slice(0, 60)] = v;
    });
    itens.push({
      nome,
      registro: idx.registro >= 0 ? limpa(c[idx.registro], 60) : null,
      fabricante: idx.fabricante >= 0 ? limpa(c[idx.fabricante], 200) : null,
      principio_ativo: idx.principio_ativo >= 0 ? limpa(c[idx.principio_ativo], 600) : null,
      especies: idx.especies >= 0 ? limpa(c[idx.especies], 300) : null,
      classificacao: idx.classificacao >= 0 ? limpa(c[idx.classificacao], 120) : null,
      situacao: idx.situacao >= 0 ? limpa(c[idx.situacao], 60) : null,
      extras,
    });
  }
  return { itens, colunas, ignoradas };
}

/** Divide em lotes para o envio (o banco recebe um lote por chamada). */
export function emLotes<T>(itens: T[], tamanho: number = LIMITE_LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** Primeira letra para o índice A–Z; o que não começa com letra vai em "#". */
export function letraInicial(nome: string): string {
  const l = normalizar(nome).charAt(0).toUpperCase();
  return /[A-Z]/.test(l) ? l : "#";
}

/** Registro suspenso ou cancelado não deve parecer disponível na consulta. */
export function registroInativo(situacao: string | null): boolean {
  if (!situacao) return false;
  return /suspens|cancel|inativ|vencid/.test(normalizar(situacao));
}
