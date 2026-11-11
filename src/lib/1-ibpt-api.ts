// Consulta da API "De Olho no Imposto" (IBPT) para o valor aproximado dos tributos por NCM (Lei 12.741/2012).
// Documentação: https://deolhonoimposto.ibpt.org.br/Site/API  (GET https://apidoni.ibpt.org.br/api/v1/produtos).
// Regras puras, sem rede: montar a consulta e ler a resposta. A chamada HTTP e o token ficam só no servidor.
// É informação aproximada para a nota; não é cálculo de imposto devido nem regra de IBS/CBS.

import type { LinhaIbpt } from "./tributos-aprox.ts";

export const URL_IBPT_PRODUTOS = "https://apidoni.ibpt.org.br/api/v1/produtos";

const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "),
);

export type ConsultaIbpt = {
  ncm: string;
  uf: string;
  /** Exceção tarifária (EX); 0 quando não há. */
  ex?: number;
  codigoInterno?: string;
  descricao: string;
  unidadeMedida: string;
  valor: number;
  gtin?: string;
};

/** Valida a consulta e devolve os parâmetros normalizados (sem token e CNPJ, que o servidor acrescenta). */
export function validarConsulta(
  c: ConsultaIbpt,
): Required<Omit<ConsultaIbpt, "ncm">> & { codigo: string } {
  const codigo = String(c.ncm ?? "").replace(/\D/g, "");
  if (codigo.length !== 8) throw new Error("NCM deve ter 8 dígitos.");
  const uf = String(c.uf ?? "")
    .trim()
    .toUpperCase();
  if (!UFS.has(uf)) throw new Error("UF inválida.");
  const ex = Number(c.ex ?? 0);
  if (!Number.isInteger(ex) || ex < 0) throw new Error("Código de exceção (EX) inválido.");
  const descricao = String(c.descricao ?? "").trim();
  if (!descricao) throw new Error("Informe a descrição do produto.");
  const unidadeMedida = String(c.unidadeMedida ?? "").trim();
  if (!unidadeMedida) throw new Error("Informe a unidade de medida.");
  const valor = Number(c.valor);
  if (!Number.isFinite(valor) || valor < 0) throw new Error("Valor unitário inválido.");
  return {
    codigo,
    uf,
    ex,
    codigoInterno: String(c.codigoInterno ?? "").trim(),
    descricao,
    unidadeMedida,
    valor,
    gtin: String(c.gtin ?? "").replace(/\D/g, ""),
  };
}

/**
 * Monta a URL da consulta. Nomes dos parâmetros conforme a página oficial da API:
 * token, cnpj, codigo, uf, ex, codigoInterno, descricao, unidadeMedida, valor, gtin.
 * O token vai na URL (é o que a API define): nunca registre essa URL em log.
 */
export function montarUrl(c: ConsultaIbpt, token: string, cnpj: string): string {
  const v = validarConsulta(c);
  const cnpjDigitos = String(cnpj ?? "").replace(/\D/g, "");
  if (cnpjDigitos.length !== 14) throw new Error("CNPJ da conta IBPT inválido.");
  if (!token) throw new Error("Token da IBPT ausente.");
  const p = new URLSearchParams({
    token,
    cnpj: cnpjDigitos,
    codigo: v.codigo,
    uf: v.uf,
    ex: String(v.ex),
    codigoInterno: v.codigoInterno,
    descricao: v.descricao,
    unidadeMedida: v.unidadeMedida,
    valor: v.valor.toFixed(2),
    gtin: v.gtin,
  });
  return `${URL_IBPT_PRODUTOS}?${p.toString()}`;
}

/** dd/mm/aaaa ou aaaa-mm-dd (com ou sem hora) → aaaa-mm-dd; vazio ou inválido → null. */
export function dataIbpt(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

const pct = (v: unknown) => {
  const n =
    typeof v === "number"
      ? v
      : Number(
          String(v ?? "")
            .trim()
            .replace(",", "."),
        );
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

/** Data de hoje (aaaa-mm-dd) no fuso de Brasília, para conferir a vigência. */
export const hojeBrasilia = (agora: Date = new Date()) =>
  new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Lê a resposta (objeto ou lista de ProdutoDTO) para a mesma linha que o CSV da IBPT gera, conferindo tudo
 * contra a consulta: NCM (Codigo), UF, EX, tipo produto, quatro alíquotas entre 0 e 100 e vigência.
 * Qualquer divergência vira erro, nunca um valor presumido. Vigência vencida também é erro (a lei manda usar a vigente).
 */
export function lerRespostaIbpt(
  corpo: unknown,
  consulta: Pick<ConsultaIbpt, "ncm" | "uf" | "ex">,
  hoje: string = hojeBrasilia(),
): LinhaIbpt {
  const lista = Array.isArray(corpo) ? corpo : corpo && typeof corpo === "object" ? [corpo] : [];
  const alvo = String(consulta.ncm).replace(/\D/g, "");
  const uf = String(consulta.uf).trim().toUpperCase();
  const ex = Number(consulta.ex ?? 0);
  const item = lista.find(
    (i) =>
      i &&
      typeof i === "object" &&
      String(i.Codigo ?? "").replace(/\D/g, "") === alvo &&
      String(i.UF ?? "")
        .trim()
        .toUpperCase() === uf &&
      Number(i.EX ?? 0) === ex &&
      (i.Tipo === undefined ||
        i.Tipo === null ||
        String(i.Tipo) === "0" ||
        /^produto/i.test(String(i.Tipo))),
  );
  if (!item) throw new Error("A IBPT não devolveu alíquotas para essa NCM, UF e exceção.");
  const n = pct(item.Nacional);
  const imp = pct(item.Importado);
  const est = pct(item.Estadual);
  const mun = pct(item.Municipal);
  if (n === null || imp === null || est === null || mun === null) {
    throw new Error("Resposta da IBPT com alíquotas inválidas.");
  }
  const fimBruto = String(item.VigenciaFim ?? "").trim();
  const fim = dataIbpt(fimBruto);
  if (fimBruto && !fim) throw new Error("Resposta da IBPT com vigência inválida.");
  if (fim && fim < hoje) throw new Error("A IBPT devolveu alíquotas com vigência vencida.");
  const ini = dataIbpt(item.VigenciaInicio);
  if (ini && ini > hoje) throw new Error("A IBPT devolveu alíquotas ainda sem vigência.");
  return {
    ncm: alvo,
    aliq_nacional_federal: n,
    aliq_importado_federal: imp,
    aliq_estadual: est,
    aliq_municipal: mun,
    vigencia_fim: fim,
    versao: item.Versao ? String(item.Versao).slice(0, 40) : null,
    fonte: item.Fonte ? String(item.Fonte).slice(0, 120) : null,
  };
}

/**
 * Empresas (tenant_id) habilitadas a consultar com a credencial IBPT do servidor. Falha fechado: lista vazia ou
 * ausente não habilita ninguém. A licença do token (único ou por empresa) ainda não foi verificada.
 */
export function empresaHabilitada(
  lista: string | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (!lista || !tenantId) return false;
  return lista
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(tenantId).toLowerCase());
}
