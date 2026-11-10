// DIFAL (ICMS da UF de destino) e FCP em venda interestadual a consumidor final NÃO contribuinte do ICMS.
// Regras puras, sem rede nem banco. A partilha é 100% do destino desde 2019 (vICMSUFRemet sempre 0).
//
// As alíquotas internas e o FCP de cada UF de destino NÃO ficam no código: são cadastrados pela empresa (tabela
// `icms_uf_destino`), porque mudam por lei estadual, e o método de base de cálculo também é escolha de cada UF.
// Sem cadastro da UF de destino a emissão é recusada com o motivo (nunca se inventa alíquota).

import { UFS } from "./nfe-contingencia.ts";

export const UFS_BR = UFS;
export type MetodoDifal = "dupla" | "unica";

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * O grupo ICMSUFDest vale quando a operação é interestadual (idDest 2), para consumidor final (indFinal 1) não
 * contribuinte (indIEDest 9), em nota de venda normal (finNFe 1), de empresa do regime normal (CRT 3) e com o
 * item tributado pelo ICMS integral (ICMS00). O Simples Nacional não entra: o recolhimento dele segue regras
 * próprias e não é tratado aqui.
 */
export function exigeDifal(c: {
  interestadual: boolean;
  indFinal: number;
  indIEDest: number;
  finalidade: number;
  crt: number;
  grupoIcms: string;
}): boolean {
  return (
    c.interestadual &&
    c.indFinal === 1 &&
    c.indIEDest === 9 &&
    c.finalidade === 1 &&
    c.crt === 3 &&
    c.grupoIcms === "ICMS00"
  );
}

export type RegraUf = { aliquota_interna: number; fcp: number; metodo: MetodoDifal };

export type ResultadoDifal = {
  grupo: {
    vBCUFDest: number;
    vBCFCPUFDest: number;
    pFCPUFDest: number;
    pICMSUFDest: number;
    pICMSInter: number;
    pICMSInterPart: number;
    vFCPUFDest: number;
    vICMSUFDest: number;
    vICMSUFRemet: number;
  };
  vICMSUFDest: number;
  vFCPUFDest: number;
};

/**
 * Cálculo por item.
 * - base única: base do destino = base do ICMS da operação; DIFAL = base × (interna − interestadual);
 * - base dupla: base do destino = (base − ICMS da origem) / (1 − interna); DIFAL = base destino × interna − ICMS
 *   da origem (ICMS da origem = base × interestadual).
 * O FCP incide sobre a base do destino. Nunca negativo.
 */
export function calcularDifal(e: {
  base: number;
  aliqInter: number;
  regra: RegraUf;
}): ResultadoDifal {
  const { base, aliqInter, regra } = e;
  const interna = regra.aliquota_interna;
  if (!(interna > 0 && interna < 100))
    throw new Error("Alíquota interna da UF de destino inválida.");
  let baseDest: number;
  let difal: number;
  if (regra.metodo === "dupla") {
    const icmsOrigem = (base * aliqInter) / 100;
    baseDest = arred((base - icmsOrigem) / (1 - interna / 100));
    difal = (baseDest * interna) / 100 - icmsOrigem;
  } else {
    baseDest = arred(base);
    difal = (baseDest * (interna - aliqInter)) / 100;
  }
  const vICMSUFDest = Math.max(0, arred(difal));
  const vFCPUFDest = arred((baseDest * regra.fcp) / 100);
  return {
    grupo: {
      vBCUFDest: baseDest,
      vBCFCPUFDest: baseDest,
      pFCPUFDest: regra.fcp,
      pICMSUFDest: interna,
      pICMSInter: aliqInter,
      pICMSInterPart: 100,
      vFCPUFDest,
      vICMSUFDest,
      vICMSUFRemet: 0,
    },
    vICMSUFDest,
    vFCPUFDest,
  };
}

/** Valida o que a empresa cadastra para uma UF de destino. */
export function validarRegraUf(e: {
  uf: unknown;
  aliquotaInterna: unknown;
  fcp: unknown;
  metodo: unknown;
}): { uf: string; aliquota_interna: number; fcp: number; metodo: MetodoDifal } {
  const uf = String(e.uf ?? "")
    .trim()
    .toUpperCase();
  if (!(UFS_BR as readonly string[]).includes(uf)) throw new Error("UF inválida.");
  const interna = Number(e.aliquotaInterna);
  if (!Number.isFinite(interna) || interna <= 0 || interna > 40) {
    throw new Error("A alíquota interna deve ficar entre 0 e 40%.");
  }
  const fcp = Number(e.fcp ?? 0);
  if (!Number.isFinite(fcp) || fcp < 0 || fcp > 10) {
    throw new Error("O FCP deve ficar entre 0 e 10%.");
  }
  if (e.metodo !== "dupla" && e.metodo !== "unica") {
    throw new Error("O método deve ser base dupla ou base única.");
  }
  return {
    uf,
    aliquota_interna: arred(interna * 100) / 100,
    fcp: arred(fcp * 100) / 100,
    metodo: e.metodo,
  };
}
