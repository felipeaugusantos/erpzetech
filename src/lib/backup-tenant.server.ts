// Backup por cliente, lado do servidor: leitura filtrada pelo cliente (serviço, sem RLS) e a rotina noturna.
// Nada aqui é chamado pelo navegador direto: as funções de servidor (backup-tenant.functions.ts) conferem a equipe Ze Tech
// e a rota do agendador (api.public.hooks.backup-clientes.ts) confere o segredo do cron.
import {
  COLUNAS_FORA_DO_BACKUP,
  TABELAS_BACKUP,
  TAMANHO_PAGINA_BACKUP,
  escopoDaTabela,
  grupoDaTabela,
  leCursorPorId,
  linhaFim,
  linhaManifesto,
  linhasDaTabela,
  montarManifesto,
  ordemDaTabela,
  type PaginaBackup,
  type RegistroBackup,
  type TabelaContada,
} from "./backup-tenant.ts";
import {
  LIMITE_EM_ANDAMENTO_MS,
  caminhoDoBackup,
  diaDeBrasilia,
  loteDaRodada,
  ordenarFila,
  politicaDoCliente,
  selecionarParaApagar,
  tiposDoDia,
} from "./backup-rotina.ts";

export const BUCKET_BACKUPS = "backups-clientes";

type Resposta = {
  data: Record<string, unknown>[] | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};
type Consulta = PromiseLike<Resposta> & {
  eq(coluna: string, valor: unknown): Consulta;
  in(coluna: string, valores: unknown[]): Consulta;
  gt(coluna: string, valor: unknown): Consulta;
  lt(coluna: string, valor: unknown): Consulta;
  order(coluna: string, opcoes?: { ascending: boolean }): Consulta;
  range(de: number, ate: number): Consulta;
  limit(n: number): Consulta;
};
type Banco = {
  from(tabela: string): {
    select(colunas: string, opcoes?: { count: "exact"; head: true }): Consulta;
    insert(linha: Record<string, unknown>): Consulta;
    update(valores: Record<string, unknown>): Consulta;
  };
};

export async function bancoDoBackup(): Promise<Banco> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Banco;
}

export async function dadosDoCliente(db: Banco, tenantId: string) {
  const t = await db.from("tenants").select("id, nome").eq("id", tenantId);
  if (t.error) throw new Error("Não foi possível consultar o cliente.");
  const cliente = t.data?.[0];
  if (!cliente) throw new Error("Cliente não encontrado.");
  const e = await db.from("empresas").select("id, ramo_atividade").eq("tenant_id", tenantId);
  if (e.error) throw new Error("Não foi possível consultar as empresas do cliente.");
  return {
    nome: String(cliente["nome"] ?? "Cliente"),
    empresaIds: (e.data ?? []).map((x) => String(x["id"])),
    ramos: [...new Set((e.data ?? []).map((x) => String(x["ramo_atividade"] ?? "")))].filter(
      Boolean,
    ),
  };
}

function filtrarPorCliente(
  q: Consulta,
  tabela: string,
  tenantId: string,
  empresaIds: string[],
): Consulta {
  const escopo = escopoDaTabela(tabela);
  if (escopo === "tenants") return q.eq("id", tenantId);
  // sem empresas, nenhuma linha pode casar: o filtro "in" vazio é trocado por um id que não existe
  if (escopo === "empresa")
    return q.in("empresa_id", empresaIds.length > 0 ? empresaIds : [tenantId]);
  return q.eq("tenant_id", tenantId);
}

export async function contarCliente(
  db: Banco,
  tenantId: string,
  empresaIds: string[],
): Promise<TabelaContada[]> {
  const tabelas: TabelaContada[] = [];
  // em lotes, para não abrir centenas de consultas ao mesmo tempo
  for (let i = 0; i < TABELAS_BACKUP.length; i += 20) {
    const contagens = await Promise.all(
      TABELAS_BACKUP.slice(i, i + 20).map(async (tabela) => {
        const r = await filtrarPorCliente(
          db.from(tabela).select("*", { count: "exact", head: true }),
          tabela,
          tenantId,
          empresaIds,
        );
        if (r.error) throw new Error(`Não foi possível contar ${tabela}.`);
        return { tabela, grupo: grupoDaTabela(tabela), linhas: r.count ?? 0 };
      }),
    );
    tabelas.push(...contagens);
  }
  return tabelas;
}

export async function lerPaginaDoCliente(
  db: Banco,
  p: { tenantId: string; empresaIds: string[]; tabela: string; cursor: string | null },
): Promise<PaginaBackup> {
  const porId = leCursorPorId(p.tabela);
  let q = filtrarPorCliente(db.from(p.tabela).select("*"), p.tabela, p.tenantId, p.empresaIds);
  for (const c of ordemDaTabela(p.tabela)) q = q.order(c);
  let inicio = 0;
  if (porId) {
    if (p.cursor !== null) q = q.gt("id", p.cursor);
    q = q.limit(TAMANHO_PAGINA_BACKUP);
  } else {
    inicio = p.cursor === null ? 0 : Number.parseInt(p.cursor, 10);
    if (!Number.isInteger(inicio) || inicio < 0) throw new Error("Posição inválida.");
    q = q.range(inicio, inicio + TAMANHO_PAGINA_BACKUP - 1);
  }
  const r = await q;
  if (r.error) throw new Error(`Não foi possível ler ${p.tabela}.`);
  const fora = new Set(COLUNAS_FORA_DO_BACKUP[p.tabela] ?? []);
  const linhas = r.data ?? [];
  const registros = linhas.map(
    (linha) =>
      Object.fromEntries(
        Object.entries(linha).filter(([coluna]) => !fora.has(coluna)),
      ) as RegistroBackup,
  );
  const cheia = linhas.length === TAMANHO_PAGINA_BACKUP;
  const ultimo = linhas[linhas.length - 1];
  const proximo = !cheia
    ? null
    : porId
      ? String(ultimo?.["id"] ?? "")
      : String(inicio + TAMANHO_PAGINA_BACKUP);
  return { registros, proximo: proximo === "" ? null : proximo };
}

/** o arquivo é produzido sob demanda (uma página por vez): o servidor nunca guarda o cliente inteiro na memória */
function fluxoDoBackup(p: {
  db: Banco;
  tenantId: string;
  nome: string;
  empresaIds: string[];
  contagens: TabelaContada[];
  resultado: { tabelas: { tabela: string; linhas: number }[] };
}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const comDados = p.contagens.filter((t) => t.linhas > 0);
  let abriu = false;
  let i = 0;
  let cursor: string | null = null;
  let linhasDaTabelaAtual = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (!abriu) {
        abriu = true;
        const abertura = montarManifesto({
          tenantId: p.tenantId,
          nome: p.nome,
          geradoEm: new Date(),
          geradoPor: "rotina_noturna",
          tabelas: comDados.map((t) => ({ tabela: t.tabela, linhas: t.linhas })),
        });
        ctrl.enqueue(enc.encode(linhaManifesto(abertura)));
        return;
      }
      const atual = comDados[i];
      if (!atual) {
        ctrl.enqueue(enc.encode(linhaFim(p.resultado.tabelas)));
        ctrl.close();
        return;
      }
      const pagina = await lerPaginaDoCliente(p.db, {
        tenantId: p.tenantId,
        empresaIds: p.empresaIds,
        tabela: atual.tabela,
        cursor,
      });
      if (pagina.registros.length > 0) {
        linhasDaTabelaAtual += pagina.registros.length;
        ctrl.enqueue(enc.encode(linhasDaTabela(atual.tabela, pagina.registros)));
      }
      if (pagina.proximo === null || pagina.proximo === cursor) {
        if (pagina.proximo === cursor && pagina.proximo !== null)
          throw new Error(`Leitura de ${atual.tabela} não avançou.`);
        if (linhasDaTabelaAtual > 0)
          p.resultado.tabelas.push({ tabela: atual.tabela, linhas: linhasDaTabelaAtual });
        i += 1;
        cursor = null;
        linhasDaTabelaAtual = 0;
      } else {
        cursor = pagina.proximo;
      }
    },
  });
}

export type ResultadoBackup = {
  tenantId: string;
  situacao: "concluido" | "erro" | "ja_feito";
  linhas?: number;
  tamanho?: number;
  erro?: string;
};

/** gera, compacta e grava o backup de UM cliente no bucket privado; registra o resultado em backup_execucoes */
export async function gerarBackupDoCliente(
  tenantId: string,
  dia: string,
): Promise<ResultadoBackup> {
  const db = await bancoDoBackup();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const reserva = await db
    .from("backup_execucoes")
    .insert({ tenant_id: tenantId, dia, tipos: tiposDoDia(dia) });
  if (reserva.error) {
    // índice único: já há um concluído ou em andamento hoje
    if (reserva.error.code === "23505") return { tenantId, situacao: "ja_feito" };
    return { tenantId, situacao: "erro", erro: "Não foi possível reservar a execução." };
  }
  const marcar = (valores: Record<string, unknown>) =>
    db
      .from("backup_execucoes")
      .update(valores)
      .eq("tenant_id", tenantId)
      .eq("dia", dia)
      .eq("situacao", "em_andamento");
  let caminho: string | null = null;
  try {
    const cliente = await dadosDoCliente(db, tenantId);
    const contagens = await contarCliente(db, tenantId, cliente.empresaIds);
    caminho = caminhoDoBackup(tenantId, cliente.ramos, dia);
    const resultado = { tabelas: [] as { tabela: string; linhas: number }[] };
    let bytes = 0;
    const contador = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytes += chunk.byteLength;
        ctrl.enqueue(chunk);
      },
    });
    const fluxo = fluxoDoBackup({
      db,
      tenantId,
      nome: cliente.nome,
      empresaIds: cliente.empresaIds,
      contagens,
      resultado,
    })
      .pipeThrough(
        new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
      )
      .pipeThrough(contador);
    const envio = await supabaseAdmin.storage.from(BUCKET_BACKUPS).upload(caminho, fluxo, {
      contentType: "application/gzip",
      upsert: true,
      duplex: "half",
    } as { contentType: string; upsert: boolean; duplex: string });
    if (envio.error) throw new Error(`Falha ao gravar o arquivo: ${envio.error.message}`);
    const linhas = resultado.tabelas.reduce((s, t) => s + t.linhas, 0);
    const feito = await marcar({
      situacao: "concluido",
      concluido_em: new Date().toISOString(),
      caminho,
      tamanho: bytes,
      tabelas: resultado.tabelas.length,
      linhas,
      erro: null,
    });
    if (feito.error) throw new Error("Não foi possível registrar a conclusão.");
    return { tenantId, situacao: "concluido", linhas, tamanho: bytes };
  } catch (e) {
    const erro = (e as Error).message.slice(0, 500);
    if (caminho) await supabaseAdmin.storage.from(BUCKET_BACKUPS).remove([caminho]);
    await marcar({ situacao: "erro", erro });
    return { tenantId, situacao: "erro", erro };
  }
}

/** apaga os arquivos que a política de retenção do cliente já não cobre e marca a execução como expirada */
export async function aplicarRetencao(tenantId: string, ramos: readonly string[]): Promise<number> {
  const db = await bancoDoBackup();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const lista = await db
    .from("backup_execucoes")
    .select("id, dia, tipos, situacao, caminho")
    .eq("tenant_id", tenantId)
    .eq("situacao", "concluido");
  if (lista.error) throw new Error("Não foi possível consultar os backups do cliente.");
  const linhas = (lista.data ?? []).map((l) => ({
    id: String(l["id"]),
    dia: String(l["dia"]),
    tipos: (l["tipos"] as string[] | null) ?? ["diario"],
    situacao: String(l["situacao"]),
    caminho: l["caminho"] ? String(l["caminho"]) : null,
  }));
  const apagar = selecionarParaApagar(linhas, politicaDoCliente(ramos));
  if (apagar.length === 0) return 0;
  const caminhos = linhas
    .filter((l) => apagar.includes(l.id) && l.caminho)
    .map((l) => l.caminho as string);
  if (caminhos.length > 0) {
    const r = await supabaseAdmin.storage.from(BUCKET_BACKUPS).remove(caminhos);
    if (r.error) throw new Error("Não foi possível apagar os backups antigos.");
  }
  const r = await db
    .from("backup_execucoes")
    // a constraint de backup_execucoes só aceita concluido_em preenchido em "concluido": ao expirar, some junto com o caminho
    .update({
      situacao: "expirado",
      expirado_em: new Date().toISOString(),
      concluido_em: null,
      caminho: null,
    })
    .in("id", apagar);
  if (r.error) throw new Error("Não foi possível registrar a expiração.");
  return apagar.length;
}

export type RelatorioRodada = {
  dia: string;
  processados: ResultadoBackup[];
  expirados: number;
  pendentes: number;
};

/**
 * Uma chamada do agendador: faz o backup de até `lote` clientes ativos que ainda não têm o do dia.
 * Pode ser chamada várias vezes de madrugada; cliente já feito (ou em andamento) é pulado, então rodar duas vezes é seguro.
 */
export async function rodadaDeBackup(
  opcoes: { agora?: Date; lote?: string | null } = {},
): Promise<RelatorioRodada> {
  const agora = opcoes.agora ?? new Date();
  const db = await bancoDoBackup();
  const dia = diaDeBrasilia(agora);
  const lote = loteDaRodada(opcoes.lote ?? null);

  // execução travada em "em andamento" (a chamada caiu no meio) é dada como interrompida e libera nova tentativa
  const limite = new Date(agora.getTime() - LIMITE_EM_ANDAMENTO_MS).toISOString();
  await db
    .from("backup_execucoes")
    .update({ situacao: "erro", erro: "Interrompida: sem conclusão no prazo." })
    .eq("situacao", "em_andamento")
    .lt("iniciado_em", limite);

  const [tenants, feitos, empresas] = await Promise.all([
    db.from("tenants").select("id").eq("ativo", true).order("id").limit(10000),
    db.from("backup_execucoes").select("tenant_id, situacao").eq("dia", dia).limit(20000),
    db.from("empresas").select("tenant_id, ramo_atividade").limit(50000),
  ]);
  if (tenants.error || feitos.error || empresas.error)
    throw new Error("Não foi possível montar a fila de backups.");
  const cobertos = new Set(
    (feitos.data ?? [])
      .filter((f) => f["situacao"] === "concluido" || f["situacao"] === "em_andamento")
      .map((f) => String(f["tenant_id"])),
  );
  const falhas = new Map<string, number>();
  for (const f of feitos.data ?? [])
    if (f["situacao"] === "erro")
      falhas.set(String(f["tenant_id"]), (falhas.get(String(f["tenant_id"])) ?? 0) + 1);
  const fila = ordenarFila(
    (tenants.data ?? []).map((t) => String(t["id"])).filter((id) => !cobertos.has(id)),
    falhas,
  );

  const processados: ResultadoBackup[] = [];
  let expirados = 0;
  for (const tenantId of fila.slice(0, lote)) {
    const r = await gerarBackupDoCliente(tenantId, dia);
    processados.push(r);
    if (r.situacao === "ja_feito") continue;
    const ramos = (empresas.data ?? [])
      .filter((e) => String(e["tenant_id"]) === tenantId)
      .map((e) => String(e["ramo_atividade"] ?? ""))
      .filter(Boolean);
    try {
      expirados += await aplicarRetencao(tenantId, ramos);
    } catch (e) {
      console.error("[backup] falha na retenção", tenantId, (e as Error).message);
    }
  }
  return { dia, processados, expirados, pendentes: Math.max(0, fila.length - lote) };
}
