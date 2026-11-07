// Editor do menu personalizado (lógica pura, sem React): monta o desenho que a pessoa edita a partir do menu base e da
// configuração salva, aplica as operações (subir, descer, mover, esconder, criar área) e volta a gerar a configuração mínima.
// A configuração gerada é conferida por lerConfigMenu antes de gravar e aplicada por aplicarMenuPersonalizado.
import {
  ESSENCIAIS_MENU,
  aplicarMenuPersonalizado,
  lerConfigMenu,
  type ConfigMenu,
} from "./menu-personalizado.ts";

type ItemBase = { to?: string; label: string; secao?: string };
type AreaBase = { label: string; items: ItemBase[] };

export type ItemEditor = { to: string; label: string; oculto: boolean };
export type AreaEditor = { chave: string; nome: string; propria: boolean; itens: ItemEditor[] };
export type LayoutEditor = AreaEditor[];

export const MAX_AREAS_PROPRIAS = 10;
export const NOME_AREA_MIN = 2;
export const NOME_AREA_MAX = 30;

export type Resultado = { ok: true; layout: LayoutEditor } | { ok: false; erro: string };

export const ehEssencial = (to: string, essenciais: readonly string[] = ESSENCIAIS_MENU) =>
  essenciais.includes(to);

const criarAreaVazia = (nome: string): AreaBase => ({ label: nome, items: [] });
const caminhos = (a: AreaEditor) => a.itens.map((i) => i.to);

/** Área do sistema em que cada tela está no menu base (para saber o que foi movido). */
function origemDasTelas(base: readonly AreaBase[]): Map<string, string> {
  const origem = new Map<string, string>();
  for (const a of base)
    for (const i of a.items) if (i.to && !origem.has(i.to)) origem.set(i.to, a.label);
  return origem;
}

export function montarLayout(
  base: readonly AreaBase[],
  config: ConfigMenu | null | undefined,
  essenciais: readonly string[] = ESSENCIAIS_MENU,
): LayoutEditor {
  const nomes = new Map<string, string>(); // rótulo exibido → chave
  for (const a of base) nomes.set(a.label, a.label);
  for (const p of config?.areas ?? []) nomes.set(p.nome, p.id);
  const ocultos = new Set((config?.ocultos ?? []).filter((c) => !ehEssencial(c, essenciais)));
  const rotulos = new Map<string, string>(); // chave → nome exibido
  for (const a of base) rotulos.set(a.label, a.label);
  for (const p of config?.areas ?? []) rotulos.set(p.id, p.nome);
  const proprias = new Set((config?.areas ?? []).map((p) => p.id));

  // aplica mover e ordenar sem esconder, para as telas escondidas continuarem na lista
  const aplicado = config
    ? aplicarMenuPersonalizado<ItemBase, AreaBase>(base, { ...config, ocultos: [] }, criarAreaVazia)
    : [...base];
  const layout: LayoutEditor = aplicado.map((a) => {
    const chave = nomes.get(a.label) ?? a.label;
    return {
      chave,
      nome: a.label,
      propria: proprias.has(chave),
      itens: a.items
        .filter((i): i is ItemBase & { to: string } => Boolean(i.to))
        .map((i) => ({ to: i.to, label: i.label, oculto: ocultos.has(i.to) })),
    };
  });
  // áreas próprias vazias não saem do aplicar: o editor precisa delas para receber telas
  for (const p of config?.areas ?? [])
    if (!layout.some((a) => a.chave === p.id))
      layout.push({ chave: p.id, nome: p.nome, propria: true, itens: [] });
  // áreas do sistema que ficaram sem telas também continuam na lista
  for (const a of base)
    if (!layout.some((x) => x.chave === a.label))
      layout.push({ chave: a.label, nome: a.label, propria: false, itens: [] });
  const ordem = config?.ordemAreas ?? [];
  const pos = (k: string) => {
    const i = ordem.indexOf(k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return layout
    .map((a, indice) => ({ a, indice }))
    .sort((x, y) => pos(x.a.chave) - pos(y.a.chave) || x.indice - y.indice)
    .map(({ a }) => a);
}

/** Configuração mínima que reproduz o desenho: só o que difere do menu padrão entra. */
export function layoutParaConfig(
  layout: LayoutEditor,
  base: readonly AreaBase[],
  essenciais: readonly string[] = ESSENCIAIS_MENU,
): ConfigMenu {
  const padrao = montarLayout(base, null);
  const origem = origemDasTelas(base);
  const ordemPadraoAreas = padrao.map((a) => a.chave);
  const config: ConfigMenu = {
    versao: 1,
    ocultos: [],
    areas: layout.filter((a) => a.propria).map((a) => ({ id: a.chave, nome: a.nome })),
    ordemAreas: [],
    itens: {},
    ordemItens: {},
  };
  for (const a of layout) {
    const original = padrao.find((p) => p.chave === a.chave);
    let recebeuDeFora = false;
    for (const i of a.itens) {
      if (i.oculto && !ehEssencial(i.to, essenciais)) config.ocultos.push(i.to);
      if (origem.get(i.to) !== a.chave) {
        config.itens[i.to] = { area: a.chave };
        recebeuDeFora = true;
      }
    }
    const atual = caminhos(a);
    const igualAoPadrao = original
      ? JSON.stringify(atual) === JSON.stringify(caminhos(original))
      : false;
    if (atual.length > 0 && (!igualAoPadrao || recebeuDeFora)) config.ordemItens[a.chave] = atual;
  }
  const chavesAtuais = layout.map((a) => a.chave);
  if (config.areas.length > 0 || JSON.stringify(chavesAtuais) !== JSON.stringify(ordemPadraoAreas))
    config.ordemAreas = chavesAtuais;
  return config;
}

/** Valida e normaliza uma configuração gerada (formato e limites). Devolve null se não cabe nas regras. */
export const conferirConfig = (config: ConfigMenu): ConfigMenu | null => lerConfigMenu(config);

const trocar = <T>(lista: T[], de: number, para: number): T[] => {
  if (para < 0 || para >= lista.length || de === para) return lista;
  const copia = [...lista];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item as T);
  return copia;
};

export function moverItem(layout: LayoutEditor, to: string, delta: -1 | 1): LayoutEditor {
  return layout.map((a) => {
    const pos = a.itens.findIndex((i) => i.to === to);
    return pos < 0 ? a : { ...a, itens: trocar(a.itens, pos, pos + delta) };
  });
}

export function moverItemParaArea(layout: LayoutEditor, to: string, destino: string): LayoutEditor {
  const origem = layout.find((a) => a.itens.some((i) => i.to === to));
  if (!origem || origem.chave === destino || !layout.some((a) => a.chave === destino))
    return layout;
  const item = origem.itens.find((i) => i.to === to) as ItemEditor;
  return layout.map((a) =>
    a.chave === origem.chave
      ? { ...a, itens: a.itens.filter((i) => i.to !== to) }
      : a.chave === destino
        ? { ...a, itens: [...a.itens, item] }
        : a,
  );
}

export function alternarOculto(
  layout: LayoutEditor,
  to: string,
  essenciais: readonly string[] = ESSENCIAIS_MENU,
): LayoutEditor {
  if (ehEssencial(to, essenciais)) return layout;
  return layout.map((a) => ({
    ...a,
    itens: a.itens.map((i) => (i.to === to ? { ...i, oculto: !i.oculto } : i)),
  }));
}

export function moverArea(layout: LayoutEditor, chave: string, delta: -1 | 1): LayoutEditor {
  const pos = layout.findIndex((a) => a.chave === chave);
  return pos < 0 ? layout : trocar(layout, pos, pos + delta);
}

function validarNome(layout: LayoutEditor, nome: string, ignorar?: string): string | null {
  const limpo = nome.trim();
  if (limpo.length < NOME_AREA_MIN || limpo.length > NOME_AREA_MAX)
    return `O nome da área deve ter de ${NOME_AREA_MIN} a ${NOME_AREA_MAX} caracteres.`;
  const repetido = layout.some(
    (a) => a.chave !== ignorar && a.nome.trim().toLowerCase() === limpo.toLowerCase(),
  );
  return repetido ? "Já existe uma área com esse nome." : null;
}

export function adicionarAreaPropria(layout: LayoutEditor, nome: string): Resultado {
  if (layout.filter((a) => a.propria).length >= MAX_AREAS_PROPRIAS)
    return { ok: false, erro: `No máximo ${MAX_AREAS_PROPRIAS} áreas próprias.` };
  const erro = validarNome(layout, nome);
  if (erro) return { ok: false, erro };
  let n = 1;
  while (layout.some((a) => a.chave === `meu-${n}`)) n += 1;
  return {
    ok: true,
    layout: [...layout, { chave: `meu-${n}`, nome: nome.trim(), propria: true, itens: [] }],
  };
}

export function renomearAreaPropria(layout: LayoutEditor, chave: string, nome: string): Resultado {
  const alvo = layout.find((a) => a.chave === chave);
  if (!alvo?.propria)
    return { ok: false, erro: "Só as áreas criadas por você podem ser renomeadas." };
  const erro = validarNome(layout, nome, chave);
  if (erro) return { ok: false, erro };
  return {
    ok: true,
    layout: layout.map((a) => (a.chave === chave ? { ...a, nome: nome.trim() } : a)),
  };
}

/** Exclui a área própria; as telas voltam para a área de origem no menu do sistema. */
export function excluirAreaPropria(
  layout: LayoutEditor,
  chave: string,
  base: readonly AreaBase[],
): LayoutEditor {
  const alvo = layout.find((a) => a.chave === chave);
  if (!alvo?.propria) return layout;
  const origem = origemDasTelas(base);
  let resto = layout.filter((a) => a.chave !== chave);
  for (const i of alvo.itens) {
    const volta = origem.get(i.to);
    if (volta && resto.some((a) => a.chave === volta))
      resto = resto.map((a) => (a.chave === volta ? { ...a, itens: [...a.itens, i] } : a));
  }
  return resto;
}

/** Chave estável da configuração, para saber se há alteração a salvar. */
export const assinatura = (
  layout: LayoutEditor,
  base: readonly AreaBase[],
  essenciais: readonly string[] = ESSENCIAIS_MENU,
) => JSON.stringify(layoutParaConfig(layout, base, essenciais));
