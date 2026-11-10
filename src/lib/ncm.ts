// Consulta à Tabela NCM oficial vigente (src/lib/ncm-tabela.ts, gerado por scripts/gerar-tabela-ncm.py). Lógica pura, sem tela nem banco.
// Serve para recusar NCM que não existe (erro de digitação, dígito trocado, código inventado). Existir na tabela NÃO diz nada sobre a
// tributação do produto: isso continua sendo a regra fiscal e o contador.
import {
  NCM_POR_CAPITULO,
  NCM_TABELA_ATO,
  NCM_TABELA_TOTAL,
  NCM_TABELA_VIGENCIA,
} from "./ncm-tabela.ts";

type Indice = { oito: Set<string>; seis: Set<string>; quatro: Set<string>; dois: Set<string> };
let indice: Indice | null = null;

/** Monta os conjuntos na primeira consulta (as posições de 2, 4 e 6 dígitos saem dos códigos de 8). */
function montar(): Indice {
  if (indice) return indice;
  const i: Indice = { oito: new Set(), seis: new Set(), quatro: new Set(), dois: new Set() };
  for (const [cap, juntos] of Object.entries(NCM_POR_CAPITULO)) {
    for (let p = 0; p + 6 <= juntos.length; p += 6) {
      const codigo = cap + juntos.slice(p, p + 6);
      i.oito.add(codigo);
      i.seis.add(codigo.slice(0, 6));
      i.quatro.add(codigo.slice(0, 4));
      i.dois.add(cap);
    }
  }
  indice = i;
  return i;
}

/**
 * O NCM (de 2, 4, 6 ou 8 dígitos; pontuação é ignorada) existe na tabela vigente? Um prefixo existe se há ao menos um NCM de 8 dígitos
 * que começa por ele. Quantidade de dígitos diferente dessas, ou vazio, nunca existe.
 */
export function ncmNaTabela(ncm: string): boolean {
  const d = ncm.replace(/\D/g, "");
  const i = montar();
  if (d.length === 8) return i.oito.has(d);
  if (d.length === 6) return i.seis.has(d);
  if (d.length === 4) return i.quatro.has(d);
  if (d.length === 2) return i.dois.has(d);
  return false;
}

/** Quantos NCMs de 8 dígitos a tabela carregada tem (confere com o total gravado pelo script). */
export const totalNcm8 = (): number => montar().oito.size;

/** Data da tabela em DD/MM/AAAA. */
export const vigenciaTabelaNcm = (): string => NCM_TABELA_VIGENCIA.split("-").reverse().join("/");

export const atoTabelaNcm = (): string => NCM_TABELA_ATO;
export const totalDeclaradoNcm = (): number => NCM_TABELA_TOTAL;

/** Mensagem padrão para NCM que não consta na tabela. */
export const mensagemNcmInexistente = (ncm: string): string =>
  `NCM ${ncm} não consta na Tabela NCM vigente em ${vigenciaTabelaNcm()}. Confira os dígitos`;
