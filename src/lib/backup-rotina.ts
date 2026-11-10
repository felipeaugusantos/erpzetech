// Rotina noturna de backup por cliente: calendário, política de retenção por segmento e escolha do que apagar. Regras puras.
// Cada dia gera UM arquivo por cliente; ele conta como diário e, no domingo e no dia 1º, também como semanal e mensal.

export type TipoBackup = "diario" | "semanal" | "mensal";

export type PoliticaRetencao = { diarios: number; semanais: number; mensais: number };

export const POLITICA_PADRAO: PoliticaRetencao = { diarios: 7, semanais: 4, mensais: 12 };

/** segmentos com prontuário e receita guardam por mais tempo; os demais usam o padrão */
export const POLITICA_POR_RAMO: Record<string, PoliticaRetencao> = {
  clinica: { diarios: 14, semanais: 8, mensais: 24 },
  petshop: { diarios: 14, semanais: 8, mensais: 24 },
};

/** o cliente pode ter empresas de ramos diferentes: vale o maior prazo de cada campo */
export function politicaDoCliente(ramos: readonly string[]): PoliticaRetencao {
  return ramos.reduce<PoliticaRetencao>(
    (p, r) => {
      const x = POLITICA_POR_RAMO[r];
      if (!x) return p;
      return {
        diarios: Math.max(p.diarios, x.diarios),
        semanais: Math.max(p.semanais, x.semanais),
        mensais: Math.max(p.mensais, x.mensais),
      };
    },
    { ...POLITICA_PADRAO },
  );
}

/** o dia do backup é o dia no fuso de Brasília (a rotina roda de madrugada) */
export function diaDeBrasilia(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  return partes; // AAAA-MM-DD
}

export function tiposDoDia(dia: string): TipoBackup[] {
  const d = new Date(`${dia}T12:00:00Z`);
  const tipos: TipoBackup[] = ["diario"];
  if (d.getUTCDay() === 0) tipos.push("semanal");
  if (d.getUTCDate() === 1) tipos.push("mensal");
  return tipos;
}

export type ExecucaoBackup = {
  id: string;
  dia: string;
  tipos: readonly string[];
  situacao: string;
};

/** ids dos backups concluídos que já não são cobertos por nenhuma regra de retenção */
export function selecionarParaApagar(
  execucoes: readonly ExecucaoBackup[],
  politica: PoliticaRetencao,
): string[] {
  const concluidas = execucoes
    .filter((e) => e.situacao === "concluido")
    .sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));
  const manter = new Set<string>();
  const limites: [string, number][] = [
    ["diario", politica.diarios],
    ["semanal", politica.semanais],
    ["mensal", politica.mensais],
  ];
  for (const [tipo, n] of limites)
    concluidas
      .filter((e) => e.tipos.includes(tipo))
      .slice(0, n)
      .forEach((e) => manter.add(e.id));
  return concluidas.filter((e) => !manter.has(e.id)).map((e) => e.id);
}

/** pasta por segmento e por cliente: dá para ver e gerenciar por clínica, lava rápido, comércio */
export function caminhoDoBackup(tenantId: string, ramos: readonly string[], dia: string): string {
  const segmento = [...ramos].sort()[0]?.replace(/[^a-z0-9_]/g, "") || "geral";
  return `${segmento}/${tenantId}/${dia}.ndjson.gz`;
}

/** quantos clientes uma chamada da rotina processa: cada um lê o banco inteiro dele, então o lote é pequeno */
export const LOTE_PADRAO_BACKUP = 3;
export const LOTE_MAXIMO_BACKUP = 10;

export function loteDaRodada(valor: string | null): number {
  const n = Number.parseInt(valor ?? "", 10);
  if (!Number.isInteger(n) || n < 1) return LOTE_PADRAO_BACKUP;
  return Math.min(n, LOTE_MAXIMO_BACKUP);
}

/** execução "em andamento" há mais que isto é considerada interrompida e libera nova tentativa */
export const LIMITE_EM_ANDAMENTO_MS = 2 * 60 * 60 * 1000;
