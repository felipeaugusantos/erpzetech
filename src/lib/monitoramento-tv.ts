// Painel de TV da central: resposta de erro e uso do EZRA ERP. Agregado, com UMA exceção aprovada pelo dono em
// 17/11/2026: a lista de clientes sem uso em 7 dias leva nome e dias sem uso (sem e-mail, documento nem telefone).
// A rota /api/public/tv/monitoramento só entrega para quem manda a chave de leitura; aqui fica a parte pura (testável).
import { createHash, timingSafeEqual } from "node:crypto";

// SHA-256 (hex) da chave de leitura da TV. O hash não é segredo; a chave fica só com a central. Para trocar: gerar outra chave e
// publicar o novo hash (a antiga deixa de valer na hora).
export const TV_CHAVE_SHA256 = "950bed4e1ba4beb1226f8aa23644517e247cca3a5c23a8c5ef555608ac40415a";

export function chaveBearer(cabecalho: string | null): string | null {
  return /^Bearer ([^\s,]{20,200})$/.exec(cabecalho ?? "")?.[1] ?? null;
}

export function chaveTvConfere(
  chave: string | null,
  hashEsperado: string = TV_CHAVE_SHA256,
): boolean {
  if (!chave || !/^[0-9a-f]{64}$/.test(hashEsperado)) return false;
  const recebido = createHash("sha256").update(chave, "utf8").digest();
  return timingSafeEqual(recebido, Buffer.from(hashEsperado, "hex"));
}

export type SaudeTv = "verde" | "amarelo" | "vermelho";

/** Erros novos na última hora: 0 = verde, 1 a 9 = amarelo, 10 ou mais = vermelho. */
export function saudeDeErros(errosNovos1h: number): SaudeTv {
  if (errosNovos1h >= 10) return "vermelho";
  if (errosNovos1h >= 1) return "amarelo";
  return "verde";
}

function inteiro(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function inteiroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function texto(valor: unknown, limite: number): string {
  return typeof valor === "string" ? valor.slice(0, limite) : "";
}

export type ResumoTv = {
  agregado: true;
  gerado_em: string;
  saude: SaudeTv;
  erros_abertos: number;
  erros_novos_1h: number;
  erros_novos_24h: number;
  usuarios_ativos_24h: number;
  acoes_24h: number;
  clientes_ativos_24h: number;
  clientes_sem_uso_7d: number;
  clientes_sem_uso: ClienteSemUsoTv[];
  serie: { dia: string; erros_novos: number; acoes: number; usuarios_ativos: number }[];
  top_erros: { rota: string; origem: string; ocorrencias: number }[];
  backup: ResumoBackupTv;
};

/** Cliente parado há 7 dias ou mais: só o nome e há quantos dias (null = nunca usou). Lista vinda do banco já limitada a 20. */
export type ClienteSemUsoTv = { nome: string; dias_sem_uso: number | null };

export function montarClientesSemUsoTv(bruto: unknown): ClienteSemUsoTv[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  const saida: ClienteSemUsoTv[] = [];
  for (const item of lista.slice(0, 20)) {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const nome = texto(c["nome"], 60).trim();
    if (!nome) continue;
    saida.push({ nome, dias_sem_uso: inteiroOuNulo(c["dias_sem_uso"]) });
  }
  return saida;
}

/** Backup noturno por cliente, só contagens e datas (nada de nome de cliente nem caminho de arquivo). */
export type ResumoBackupTv = {
  clientes_ativos: number;
  em_dia: number;
  atrasados: number;
  sem_backup: number;
  com_erro: number;
  ultimo_em: string | null;
  mais_antigo_em: string | null;
};

function dataOuNula(valor: unknown): string | null {
  const s = texto(valor, 40);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
}

export function montarBackupTv(bruto: unknown): ResumoBackupTv {
  const b = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  return {
    clientes_ativos: inteiro(b["clientes_ativos"]),
    em_dia: inteiro(b["em_dia"]),
    atrasados: inteiro(b["atrasados"]),
    sem_backup: inteiro(b["sem_backup"]),
    com_erro: inteiro(b["com_erro"]),
    ultimo_em: dataOuNula(b["ultimo_em"]),
    mais_antigo_em: dataOuNula(b["mais_antigo_em"]),
  };
}

/** Copia só os campos conhecidos: se o banco passar a devolver mais coisa (e-mail, documento, texto de erro), isso nunca sai na rota. */
export function montarResumoTv(bruto: unknown): ResumoTv {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const serie = Array.isArray(r["serie"]) ? r["serie"].slice(0, 31) : [];
  const top = Array.isArray(r["top_erros"]) ? r["top_erros"].slice(0, 3) : [];
  const erros1h = inteiro(r["erros_novos_1h"]);
  return {
    agregado: true,
    gerado_em: texto(r["gerado_em"], 40) || new Date().toISOString(),
    saude: saudeDeErros(erros1h),
    erros_abertos: inteiro(r["erros_abertos"]),
    erros_novos_1h: erros1h,
    erros_novos_24h: inteiro(r["erros_novos_24h"]),
    usuarios_ativos_24h: inteiro(r["usuarios_ativos_24h"]),
    acoes_24h: inteiro(r["acoes_24h"]),
    clientes_ativos_24h: inteiro(r["clientes_ativos_24h"]),
    clientes_sem_uso_7d: inteiro(r["clientes_sem_uso_7d"]),
    clientes_sem_uso: montarClientesSemUsoTv(r["clientes_sem_uso"]),
    serie: serie.map((item) => {
      const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        dia: texto(s["dia"], 10),
        erros_novos: inteiro(s["erros_novos"]),
        acoes: inteiro(s["acoes"]),
        usuarios_ativos: inteiro(s["usuarios_ativos"]),
      };
    }),
    top_erros: top.map((item) => {
      const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        rota: texto(t["rota"], 80),
        origem: texto(t["origem"], 20),
        ocorrencias: inteiro(t["ocorrencias"]),
      };
    }),
    backup: montarBackupTv(r["backup"]),
  };
}
