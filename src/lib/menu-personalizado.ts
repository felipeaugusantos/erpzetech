// Menu personalizado por empresa (esconder, mover entre áreas, criar áreas próprias e reordenar).
// Lógica pura, sem tela nem banco. Entra DEPOIS do filtro por permissão e módulo e do agrupamento em áreas do trilho
// (montarAreas, no AppShell): a personalização só reorganiza o que a pessoa já pode ver e nunca libera tela nenhuma.
import { z } from "zod";

/** Telas que nunca saem do menu, para a empresa sempre conseguir desfazer a personalização. */
export const ESSENCIAIS_MENU = ["/configuracoes", "/usuarios", "/menu-personalizado"] as const;

/**
 * Telas de que a clínica depende para operar: o cadastro do veterinário com CRMV (sem ele não há prontuário) e os serviços de consulta,
 * vacina e exame (a visita avulsa usa esses serviços). Numa empresa com clínica elas não saem do menu, como as essenciais acima.
 */
export const ESSENCIAIS_DA_CLINICA = ["/pet-profissionais", "/pet-servicos"] as const;

/** Telas que não podem ser escondidas na empresa: as essenciais e, com a clínica, as de que ela depende. */
export const essenciaisDoMenu = (clinica: boolean): readonly string[] =>
  clinica ? [...ESSENCIAIS_MENU, ...ESSENCIAIS_DA_CLINICA] : ESSENCIAIS_MENU;

/** Telas da clínica que a configuração salva esconde (não valem: continuam no menu). Serve para avisar a administração. */
export const essenciaisEscondidosPelaConfig = (
  config: { ocultos: readonly string[] } | null | undefined,
  essenciais: readonly string[],
): string[] => (config?.ocultos ?? []).filter((c) => essenciais.includes(c));

const CAMINHO = z
  .string()
  .max(120)
  .regex(/^\/[A-Za-z0-9\-_/.$]*$/);
const CHAVE_AREA = z.string().trim().min(1).max(60);

export const configMenuSchema = z.object({
  versao: z.literal(1),
  /** telas escondidas (caminho da rota) */
  ocultos: z.array(CAMINHO).max(300).default([]),
  /** áreas criadas pela empresa: id estável e nome exibido */
  areas: z
    .array(
      z.object({
        id: z.string().regex(/^meu-[a-z0-9]{1,12}$/),
        nome: z.string().trim().min(2).max(30),
      }),
    )
    .max(10)
    .default([]),
  /** ordem das áreas do trilho (rótulo da área ou id da área própria) */
  ordemAreas: z.array(CHAVE_AREA).max(40).default([]),
  /** telas movidas para outra área: caminho → rótulo da área ou id da área própria */
  itens: z.record(CAMINHO, z.object({ area: CHAVE_AREA })).default({}),
  /** ordem das telas dentro de cada área */
  ordemItens: z.record(CHAVE_AREA, z.array(CAMINHO).max(300)).default({}),
});

export type ConfigMenu = z.infer<typeof configMenuSchema>;

/** Lê a configuração guardada. Qualquer coisa fora do formato (ou grande demais) vira "sem personalização". */
export function lerConfigMenu(bruto: unknown): ConfigMenu | null {
  const r = configMenuSchema.safeParse(bruto);
  if (!r.success) return null;
  const c = r.data;
  const ids = new Set(c.areas.map((a) => a.id));
  const nomes = new Set(c.areas.map((a) => a.nome.toLowerCase()));
  if (ids.size !== c.areas.length || nomes.size !== c.areas.length) return null;
  return c;
}

type ItemBase = { to?: string; secao?: string };
type AreaBase<I extends ItemBase> = { label: string; items: I[] };

/**
 * Aplica a personalização às áreas do trilho já filtradas.
 * - Esconder: tira a tela (menos as essenciais).
 * - Mover: leva a tela para outra área existente (do trilho ou própria); destino inexistente = fica onde estava.
 * - Reordenar: as telas listadas vêm primeiro, na ordem dada; as demais (inclusive as novas do sistema) ficam depois.
 * - Área que fica sem telas some do trilho. Telas e áreas que a pessoa não vê continuam invisíveis.
 */
export function aplicarMenuPersonalizado<I extends ItemBase, A extends AreaBase<I>>(
  areas: readonly A[],
  config: ConfigMenu | null | undefined,
  criarArea: (nome: string) => A,
  essenciais: readonly string[] = ESSENCIAIS_MENU,
): A[] {
  if (!config) return [...areas];
  const rotulosBase = new Set(areas.map((a) => a.label.toLowerCase()));

  // chave da área: o rótulo, nas do sistema; o id, nas próprias
  const trabalho = new Map<string, A>();
  for (const a of areas) trabalho.set(a.label, { ...a, items: [...a.items] });
  for (const p of config.areas) {
    if (rotulosBase.has(p.nome.toLowerCase())) continue; // nome igual ao de uma área do sistema: ignora
    const nova = criarArea(p.nome);
    trabalho.set(p.id, { ...nova, items: [] });
  }

  const protegidos = new Set(essenciais);
  const ocultos = new Set(config.ocultos.filter((c) => !protegidos.has(c)));
  const existentes = new Set<string>();
  for (const a of areas) for (const i of a.items) if (i.to) existentes.add(i.to);

  // esconder
  for (const a of trabalho.values()) a.items = a.items.filter((i) => !(i.to && ocultos.has(i.to)));

  // mover (só telas que a pessoa já vê e que não foram escondidas)
  const movidas = new Set<string>();
  for (const [caminho, destino] of Object.entries(config.itens)) {
    if (!existentes.has(caminho) || ocultos.has(caminho)) continue;
    const alvo = trabalho.get(destino.area);
    if (!alvo) continue;
    for (const a of trabalho.values()) {
      const pos = a.items.findIndex((i) => i.to === caminho);
      if (pos < 0) continue;
      if (a === alvo) break;
      const [item] = a.items.splice(pos, 1);
      if (item) {
        const { secao: _secao, ...resto } = item;
        alvo.items.push(resto as I);
        movidas.add(caminho);
      }
      break;
    }
  }

  // reordenar dentro de cada área (com ordem própria, a lista fica sem as seções do sistema)
  for (const [chave, ordem] of Object.entries(config.ordemItens)) {
    const a = trabalho.get(chave);
    if (!a) continue;
    const porCaminho = new Map(a.items.filter((i) => i.to).map((i) => [i.to as string, i]));
    const primeiros = ordem
      .filter((c, pos) => porCaminho.has(c) && ordem.indexOf(c) === pos)
      .map((c) => porCaminho.get(c) as I);
    const usados = new Set(primeiros);
    a.items = [...primeiros, ...a.items.filter((i) => !usados.has(i))].map((i) => {
      const { secao: _secao, ...resto } = i;
      return resto as I;
    });
  }

  // áreas vazias saem; ordem das áreas: as listadas primeiro, o resto na ordem de origem
  const chaves = [...trabalho.keys()].filter((k) => (trabalho.get(k)?.items.length ?? 0) > 0);
  const listadas = config.ordemAreas.filter(
    (k, pos) => chaves.includes(k) && config.ordemAreas.indexOf(k) === pos,
  );
  const ordemFinal = [...listadas, ...chaves.filter((k) => !listadas.includes(k))];
  return ordemFinal.map((k) => trabalho.get(k) as A);
}
