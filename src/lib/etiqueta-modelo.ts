import {
  CAMPOS_PADRAO,
  TIPOS_CAMPO_ETIQUETA,
  type CampoEtiqueta,
  type ModeloEtiqueta,
  type TamanhoCampo,
} from "./etiqueta.ts";

/** Modelo de etiqueta da empresa, como fica guardado (o nome fica fora, na coluna própria). */
export type ConfigModeloEtiqueta = {
  versao: 1;
  tipo: "termica" | "folha";
  larguraMm: number;
  alturaMm: number;
  campos: CampoEtiqueta[];
  colunas?: number;
  linhas?: number;
  margemSuperiorMm?: number;
  margemEsquerdaMm?: number;
  espacoHMm?: number;
  espacoVMm?: number;
};

export const LIMITE_MODELOS_ETIQUETA = 30;
export const PREFIXO_MODELO_PROPRIO = "proprio:";
export const idModeloProprio = (id: string) => `${PREFIXO_MODELO_PROPRIO}${id}`;
export const ehModeloProprio = (id: string) => id.startsWith(PREFIXO_MODELO_PROPRIO);

const A4 = { larguraMm: 210, alturaMm: 297 };
const TIPOS = new Set<string>(TIPOS_CAMPO_ETIQUETA.map((t) => t.id));
const TAMANHOS = new Set<string>(["p", "m", "g"]);

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const arred = (n: number) => Math.round(n * 10) / 10;

export type ResultadoModelo =
  { ok: true; nome: string; config: ConfigModeloEtiqueta } | { ok: false; erro: string };

/** Confere o que a pessoa digitou no editor (ou o que veio do banco) e devolve a configuração limpa. */
export function validarModeloProprio(entrada: {
  nome: unknown;
  tipo: unknown;
  larguraMm: unknown;
  alturaMm: unknown;
  campos: unknown;
  colunas?: unknown;
  linhas?: unknown;
  margemSuperiorMm?: unknown;
  margemEsquerdaMm?: unknown;
  espacoHMm?: unknown;
  espacoVMm?: unknown;
}): ResultadoModelo {
  const nome = typeof entrada.nome === "string" ? entrada.nome.trim() : "";
  if (nome.length < 2 || nome.length > 60)
    return { ok: false, erro: "O nome precisa ter de 2 a 60 letras." };
  if (entrada.tipo !== "termica" && entrada.tipo !== "folha")
    return { ok: false, erro: "Escolha o tipo da etiqueta." };
  const tipo = entrada.tipo;
  const larguraMm = num(entrada.larguraMm);
  const alturaMm = num(entrada.alturaMm);
  const [lmin, lmax, amin, amax] = tipo === "termica" ? [15, 170, 10, 300] : [10, 200, 8, 280];
  if (larguraMm == null || larguraMm < lmin || larguraMm > lmax)
    return { ok: false, erro: `A largura precisa ficar entre ${lmin} e ${lmax} mm.` };
  if (alturaMm == null || alturaMm < amin || alturaMm > amax)
    return { ok: false, erro: `A altura precisa ficar entre ${amin} e ${amax} mm.` };

  if (!Array.isArray(entrada.campos) || entrada.campos.length === 0 || entrada.campos.length > 5)
    return { ok: false, erro: "Escolha de 1 a 5 campos para a etiqueta." };
  const campos: CampoEtiqueta[] = [];
  for (const c of entrada.campos) {
    const campo = (c as { campo?: unknown })?.campo;
    const tamanho = (c as { tamanho?: unknown })?.tamanho;
    if (typeof campo !== "string" || !TIPOS.has(campo))
      return { ok: false, erro: "Campo de etiqueta desconhecido." };
    if (campos.some((x) => x.campo === campo))
      return { ok: false, erro: "Cada campo só pode aparecer uma vez." };
    if (tamanho !== undefined && (typeof tamanho !== "string" || !TAMANHOS.has(tamanho)))
      return { ok: false, erro: "Tamanho de letra inválido." };
    campos.push(
      campo === "codigo" || tamanho === undefined || tamanho === "m"
        ? { campo: campo as CampoEtiqueta["campo"] }
        : { campo: campo as CampoEtiqueta["campo"], tamanho: tamanho as TamanhoCampo },
    );
  }

  const config: ConfigModeloEtiqueta = {
    versao: 1,
    tipo,
    larguraMm: arred(larguraMm),
    alturaMm: arred(alturaMm),
    campos,
  };
  if (tipo === "folha") {
    const colunas = num(entrada.colunas);
    const linhas = num(entrada.linhas);
    if (colunas == null || !Number.isInteger(colunas) || colunas < 1 || colunas > 8)
      return { ok: false, erro: "As colunas precisam ser de 1 a 8." };
    if (linhas == null || !Number.isInteger(linhas) || linhas < 1 || linhas > 30)
      return { ok: false, erro: "As linhas precisam ser de 1 a 30." };
    const medidas = {
      margemSuperiorMm: num(entrada.margemSuperiorMm ?? 0),
      margemEsquerdaMm: num(entrada.margemEsquerdaMm ?? 0),
      espacoHMm: num(entrada.espacoHMm ?? 0),
      espacoVMm: num(entrada.espacoVMm ?? 0),
    };
    for (const [k, v] of Object.entries(medidas)) {
      const max = k.startsWith("margem") ? 50 : 20;
      if (v == null || v < 0 || v > max)
        return { ok: false, erro: `Margens e espaços precisam ficar entre 0 e ${max} mm.` };
    }
    const largTotal =
      medidas.margemEsquerdaMm! + colunas * larguraMm + (colunas - 1) * medidas.espacoHMm!;
    const altTotal =
      medidas.margemSuperiorMm! + linhas * alturaMm + (linhas - 1) * medidas.espacoVMm!;
    if (largTotal > A4.larguraMm + 0.05 || altTotal > A4.alturaMm + 0.05)
      return {
        ok: false,
        erro: "A grade não cabe numa folha A4 (210 × 297 mm). Confira as medidas.",
      };
    Object.assign(config, {
      colunas,
      linhas,
      margemSuperiorMm: arred(medidas.margemSuperiorMm!),
      margemEsquerdaMm: arred(medidas.margemEsquerdaMm!),
      espacoHMm: arred(medidas.espacoHMm!),
      espacoVMm: arred(medidas.espacoVMm!),
    });
  }
  return { ok: true, nome, config };
}

/** Linha do banco → modelo pronto para imprimir. Linha inválida (corrompida ou de versão futura) é ignorada. */
export function modeloDaLinha(linha: {
  id: string;
  nome: string;
  config: unknown;
}): ModeloEtiqueta | null {
  const c = linha.config as Partial<ConfigModeloEtiqueta> | null;
  if (!c || typeof c !== "object" || c.versao !== 1) return null;
  const r = validarModeloProprio({
    ...c,
    nome: linha.nome,
    tipo: c.tipo,
    larguraMm: c.larguraMm,
    alturaMm: c.alturaMm,
    campos: c.campos,
  });
  if (!r.ok) return null;
  const k = r.config;
  return {
    id: idModeloProprio(linha.id),
    nome: r.nome,
    tipo: k.tipo,
    larguraMm: k.larguraMm,
    alturaMm: k.alturaMm,
    campos: k.campos,
    proprio: true,
    ...(k.tipo === "folha"
      ? {
          colunas: k.colunas!,
          linhas: k.linhas!,
          margemSuperiorMm: k.margemSuperiorMm!,
          margemEsquerdaMm: k.margemEsquerdaMm!,
          espacoHMm: k.espacoHMm!,
          espacoVMm: k.espacoVMm!,
        }
      : {}),
  };
}

export const camposIniciais = (): CampoEtiqueta[] => CAMPOS_PADRAO.map((c) => ({ ...c }));

/** Estado do editor: tudo como texto (o que a pessoa digita); os 4 campos sempre presentes, ligados ou não. */
export type EstadoEditorModelo = {
  id: string | null;
  nome: string;
  tipo: "termica" | "folha";
  larguraMm: string;
  alturaMm: string;
  colunas: string;
  linhas: string;
  margemSuperiorMm: string;
  margemEsquerdaMm: string;
  espacoHMm: string;
  espacoVMm: string;
  campos: { campo: CampoEtiqueta["campo"]; ativo: boolean; tamanho: TamanhoCampo }[];
};

const TODOS_OS_CAMPOS: CampoEtiqueta["campo"][] = TIPOS_CAMPO_ETIQUETA.map((t) => t.id);

export function estadoNovoModelo(): EstadoEditorModelo {
  return {
    id: null,
    nome: "",
    tipo: "termica",
    larguraMm: "50",
    alturaMm: "30",
    colunas: "3",
    linhas: "10",
    margemSuperiorMm: "10",
    margemEsquerdaMm: "5",
    espacoHMm: "2",
    espacoVMm: "0",
    // os campos do modelo padrão ligados; os demais (peso e preço do kg) entram desligados
    campos: [
      ...CAMPOS_PADRAO.map((c) => ({ campo: c.campo, ativo: true, tamanho: "m" as TamanhoCampo })),
      ...TODOS_OS_CAMPOS.filter((t) => !CAMPOS_PADRAO.some((c) => c.campo === t)).map((campo) => ({
        campo,
        ativo: false,
        tamanho: "m" as TamanhoCampo,
      })),
    ],
  };
}

export function estadoDoModelo(
  id: string,
  nome: string,
  c: ConfigModeloEtiqueta,
): EstadoEditorModelo {
  const base = estadoNovoModelo();
  const usados = c.campos.map((x) => ({
    campo: x.campo,
    ativo: true,
    tamanho: x.tamanho ?? ("m" as TamanhoCampo),
  }));
  const resto = TODOS_OS_CAMPOS.filter((t) => !usados.some((u) => u.campo === t)).map((campo) => ({
    campo,
    ativo: false,
    tamanho: "m" as TamanhoCampo,
  }));
  const t = (n: number | undefined, padrao: string) => (n == null ? padrao : String(n));
  return {
    ...base,
    id,
    nome,
    tipo: c.tipo,
    larguraMm: String(c.larguraMm),
    alturaMm: String(c.alturaMm),
    colunas: t(c.colunas, base.colunas),
    linhas: t(c.linhas, base.linhas),
    margemSuperiorMm: t(c.margemSuperiorMm, base.margemSuperiorMm),
    margemEsquerdaMm: t(c.margemEsquerdaMm, base.margemEsquerdaMm),
    espacoHMm: t(c.espacoHMm, base.espacoHMm),
    espacoVMm: t(c.espacoVMm, base.espacoVMm),
    campos: [...usados, ...resto],
  };
}

/** Estado do editor → entrada de `validarModeloProprio` (só os campos ligados, na ordem da lista). */
export function entradaDoEstado(e: EstadoEditorModelo) {
  return {
    nome: e.nome,
    tipo: e.tipo,
    larguraMm: e.larguraMm,
    alturaMm: e.alturaMm,
    campos: e.campos.filter((c) => c.ativo).map((c) => ({ campo: c.campo, tamanho: c.tamanho })),
    colunas: e.colunas,
    linhas: e.linhas,
    margemSuperiorMm: e.margemSuperiorMm,
    margemEsquerdaMm: e.margemEsquerdaMm,
    espacoHMm: e.espacoHMm,
    espacoVMm: e.espacoVMm,
  };
}

/** Sobe (-1) ou desce (+1) um campo na lista; nos extremos não muda nada. */
export function moverCampoEditor(
  e: EstadoEditorModelo,
  indice: number,
  delta: -1 | 1,
): EstadoEditorModelo {
  const alvo = indice + delta;
  if (indice < 0 || indice >= e.campos.length || alvo < 0 || alvo >= e.campos.length) return e;
  const campos = [...e.campos];
  [campos[indice], campos[alvo]] = [campos[alvo]!, campos[indice]!];
  return { ...e, campos };
}
