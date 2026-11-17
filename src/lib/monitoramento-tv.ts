// Painel de TV da central: resposta AGREGADA de erro e uso do EZRA ERP (sem nome de cliente, e-mail nem texto de erro).
// A rota /api/public/tv/monitoramento só entrega para quem manda a chave de leitura; aqui fica a parte pura (testável).
import { createHash, timingSafeEqual } from "node:crypto";

// SHA-256 (hex) da chave de leitura da TV. O hash não é segredo; a chave fica só com a central. Para trocar: gerar outra chave e
// publicar o novo hash (a antiga deixa de valer na hora).
export const TV_CHAVE_SHA256 = "950bed4e1ba4beb1226f8aa23644517e247cca3a5c23a8c5ef555608ac40415a";

export function chaveBearer(cabecalho: string | null): string | null {
  return /^Bearer ([^\s,]{20,200})$/.exec(cabecalho ?? "")?.[1] ?? null;
}

export function chaveTvConfere(chave: string | null, hashEsperado: string = TV_CHAVE_SHA256): boolean {
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
  serie: { dia: string; erros_novos: number; acoes: number; usuarios_ativos: number }[];
  top_erros: { rota: string; origem: string; ocorrencias: number }[];
};

/** Copia só os campos conhecidos: se o banco passar a devolver mais coisa (nome de cliente, por exemplo), isso nunca sai na rota. */
export function montarResumoTv(bruto: unknown): ResumoTv {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const serie = Array.isArray(r.serie) ? r.serie.slice(0, 31) : [];
  const top = Array.isArray(r.top_erros) ? r.top_erros.slice(0, 3) : [];
  const erros1h = inteiro(r.erros_novos_1h);
  return {
    agregado: true,
    gerado_em: texto(r.gerado_em, 40) || new Date().toISOString(),
    saude: saudeDeErros(erros1h),
    erros_abertos: inteiro(r.erros_abertos),
    erros_novos_1h: erros1h,
    erros_novos_24h: inteiro(r.erros_novos_24h),
    usuarios_ativos_24h: inteiro(r.usuarios_ativos_24h),
    acoes_24h: inteiro(r.acoes_24h),
    clientes_ativos_24h: inteiro(r.clientes_ativos_24h),
    clientes_sem_uso_7d: inteiro(r.clientes_sem_uso_7d),
    serie: serie.map((item) => {
      const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        dia: texto(s.dia, 10),
        erros_novos: inteiro(s.erros_novos),
        acoes: inteiro(s.acoes),
        usuarios_ativos: inteiro(s.usuarios_ativos),
      };
    }),
    top_erros: top.map((item) => {
      const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { rota: texto(t.rota, 80), origem: texto(t.origem, 20), ocorrencias: inteiro(t.ocorrencias) };
    }),
  };
}
