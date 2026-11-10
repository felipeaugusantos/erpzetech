// Restauração assistida de backup por cliente: leitura e conferência do arquivo, e o plano do que seria devolvido.
// Regras puras, sem rede nem banco. A gravação é feita pela função do banco backup_restaurar_tabela (migração
// 20261231000000), que repete a lista de tabelas restauráveis; tests/backup-restauracao.test.ts confere as duas.
import { z } from "zod";

import {
  COLUNAS_FORA_DO_BACKUP,
  TABELAS_BACKUP,
  VERSAO_BACKUP,
  escopoDaTabela,
  type ManifestoBackup,
} from "./backup-tenant.ts";

/**
 * Cadastros que podem voltar, em ordem de dependência (quem é referenciado vem antes). São só cadastros sem efeito
 * colateral: nada de vendas, estoque, financeiro, fiscal, prontuário, acessos, permissões nem integrações.
 */
export const TABELAS_RESTAURAVEIS: readonly string[] = [
  "fornecedores",
  "categorias",
  "tabelas_preco",
  "lr_lavadores",
  "produtos",
  "produto_variacoes",
  "tabela_preco_itens",
  "clientes",
  "pets",
  "lr_veiculos",
  "obras",
  "veiculos",
  "pet_servicos",
  "pet_servico_precos",
  "lr_servicos",
  "lr_servico_precos",
  "lr_planos",
];

export const MOTIVO_NAO_RESTAURAVEL =
  "Esta primeira versão só devolve cadastros (clientes, produtos, serviços e semelhantes). Vendas, estoque, financeiro, fiscal, prontuário, acessos e permissões não voltam por aqui, porque restaurar sem conferir poderia duplicar efeitos ou devolver acesso já revogado.";

export function tabelaRestauravel(tabela: string): boolean {
  return TABELAS_RESTAURAVEIS.includes(tabela);
}

/** linhas por chamada ao servidor (o banco aceita até 1000) */
export const LINHAS_POR_LOTE_RESTAURACAO = 300;

export const conferirIds = z.object({
  tenantId: z.guid("Cliente inválido."),
  tabela: z.string().min(1).max(80),
  ids: z.array(z.guid("Id inválido.")).min(1).max(1000),
});

export const restaurarLote = z.object({
  tenantId: z.guid("Cliente inválido."),
  tabela: z.string().min(1).max(80),
  registros: z.array(z.record(z.string(), z.unknown())).min(1).max(LINHAS_POR_LOTE_RESTAURACAO),
});

export type RegistroArquivo = Record<string, unknown>;

export type ArquivoLido = {
  manifesto: ManifestoBackup | null;
  /** contagens reais gravadas na última linha; ausente = arquivo cortado */
  totalNoFim: number | null;
  registros: Map<string, RegistroArquivo[]>;
  totalLinhas: number;
  /** qualquer item aqui impede a restauração */
  problemas: string[];
};

const LIMITE_PROBLEMAS = 20;

/** lê o NDJSON do backup e confere formato, cliente, tabelas, colunas proibidas e integridade (linha final) */
export function lerArquivoBackup(texto: string, tenantId: string): ArquivoLido {
  const r: ArquivoLido = {
    manifesto: null,
    totalNoFim: null,
    registros: new Map(),
    totalLinhas: 0,
    problemas: [],
  };
  const problema = (m: string) => {
    if (r.problemas.length < LIMITE_PROBLEMAS) r.problemas.push(m);
  };
  const linhas = texto.split("\n");
  let n = 0;
  for (const bruta of linhas) {
    n += 1;
    const linha = bruta.trim();
    if (!linha) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(linha);
    } catch {
      problema(`Linha ${n} não é um JSON válido.`);
      continue;
    }
    if (typeof obj !== "object" || obj === null) {
      problema(`Linha ${n} não é um objeto.`);
      continue;
    }
    const o = obj as Record<string, unknown>;
    if ("manifesto" in o) {
      if (r.manifesto) problema("O arquivo tem mais de um manifesto.");
      r.manifesto = o["manifesto"] as ManifestoBackup;
      continue;
    }
    if ("fim" in o) {
      const fim = o["fim"] as { total_linhas?: unknown } | null;
      r.totalNoFim = typeof fim?.total_linhas === "number" ? fim.total_linhas : null;
      continue;
    }
    const tabela = o["t"];
    const dado = o["d"];
    if (typeof tabela !== "string" || typeof dado !== "object" || dado === null) {
      problema(`Linha ${n} não é um registro do backup.`);
      continue;
    }
    if (!TABELAS_BACKUP.includes(tabela)) {
      problema(`Linha ${n}: tabela "${tabela}" não faz parte do backup.`);
      continue;
    }
    const reg = dado as RegistroArquivo;
    if (escopoDaTabela(tabela) === "tenant" && reg["tenant_id"] !== tenantId) {
      problema(`Linha ${n}: registro de ${tabela} pertence a outro cliente.`);
      continue;
    }
    const proibidas = (COLUNAS_FORA_DO_BACKUP[tabela] ?? []).filter((c) => c in reg);
    if (proibidas.length > 0) {
      problema(
        `Linha ${n}: ${tabela} traz coluna que nunca deveria sair (${proibidas.join(", ")}).`,
      );
      continue;
    }
    const lista = r.registros.get(tabela) ?? [];
    lista.push(reg);
    r.registros.set(tabela, lista);
    r.totalLinhas += 1;
  }

  if (!r.manifesto) problema("O arquivo não tem manifesto: não é um backup da Ze Tech.");
  else {
    if (r.manifesto.formato !== "ezra-backup-cliente") problema("Formato de arquivo desconhecido.");
    if (typeof r.manifesto.versao !== "number" || r.manifesto.versao > VERSAO_BACKUP)
      problema("Versão do backup mais nova do que este sistema entende.");
    if (r.manifesto.cliente?.tenantId !== tenantId)
      problema("Este backup é de outro cliente: a restauração foi bloqueada.");
  }
  if (r.totalNoFim === null)
    problema("O arquivo não tem a linha final de conferência: pode estar cortado ou incompleto.");
  else if (r.totalNoFim !== r.totalLinhas)
    problema(`O arquivo diz ter ${r.totalNoFim} linhas, mas foram lidas ${r.totalLinhas}.`);
  return r;
}

export type PlanoTabela = {
  tabela: string;
  noArquivo: number;
  /** linhas do arquivo que não existem mais no banco: são as que a restauração devolve */
  ausentes: RegistroArquivo[];
  jaExistem: number;
};

export type PlanoRestauracao = {
  tabelas: PlanoTabela[];
  /** tabelas do arquivo que esta versão não restaura, com a quantidade de linhas */
  ignoradas: { tabela: string; linhas: number }[];
  totalAusentes: number;
};

/** monta o plano a partir do arquivo e dos ids que ainda existem hoje em cada tabela restaurável */
export function montarPlano(
  arquivo: Pick<ArquivoLido, "registros">,
  existentes: ReadonlyMap<string, ReadonlySet<string>>,
): PlanoRestauracao {
  const tabelas: PlanoTabela[] = [];
  for (const tabela of TABELAS_RESTAURAVEIS) {
    const linhas = arquivo.registros.get(tabela);
    if (!linhas || linhas.length === 0) continue;
    const vivos = existentes.get(tabela) ?? new Set<string>();
    const ausentes = linhas.filter((l) => typeof l["id"] === "string" && !vivos.has(l["id"]));
    tabelas.push({
      tabela,
      noArquivo: linhas.length,
      ausentes,
      jaExistem: linhas.length - ausentes.length,
    });
  }
  const ignoradas = [...arquivo.registros]
    .filter(([t]) => !tabelaRestauravel(t))
    .map(([tabela, l]) => ({ tabela, linhas: l.length }));
  return { tabelas, ignoradas, totalAusentes: tabelas.reduce((s, t) => s + t.ausentes.length, 0) };
}

export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** a restauração só começa se o nome do cliente for digitado igual: evita restaurar no cliente errado */
export function confirmacaoConfere(nomeDigitado: string, nomeCliente: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(nomeCliente).length > 0 && norm(nomeDigitado) === norm(nomeCliente);
}

/** o ponto de segurança (backup do estado atual) precisa ser de no máximo 24 horas antes */
export const VALIDADE_PONTO_DE_SEGURANCA_MS = 24 * 60 * 60 * 1000;

export function pontoDeSegurancaValido(concluidoEm: string | null, agora: Date): boolean {
  if (!concluidoEm) return false;
  const t = new Date(concluidoEm).getTime();
  return (
    Number.isFinite(t) &&
    t <= agora.getTime() &&
    agora.getTime() - t <= VALIDADE_PONTO_DE_SEGURANCA_MS
  );
}
