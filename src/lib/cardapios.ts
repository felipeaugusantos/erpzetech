// Vários cardápios do restaurante: cada cardápio lista os itens que vendem nele e pode trocar preço e ordem.
// A regra de preço de verdade fica no banco (restaurante_lancar_item_no_cardapio); aqui ficam a escolha do
// cardápio sugerido pelo horário, a lista de itens e o preço mostrado.

export type CardapioCadastro = {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  padrao: boolean;
  uso_salao: boolean;
  uso_delivery: boolean;
  uso_online: boolean;
  uso_ifood: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
};

export type VinculoCardapio = {
  cardapio_id: string;
  item_id: string;
  preco: number | null;
  ordem: number | null;
};

const minutos = (hora: string) => {
  const [h, m] = hora.split(":");
  return Number(h) * 60 + Number(m ?? 0);
};

/** O horário (HH:MM[:SS]) cai na janela do cardápio? A janela pode virar a meia-noite (18:00 → 02:00). */
export function dentroDoHorario(
  c: Pick<CardapioCadastro, "hora_inicio" | "hora_fim">,
  agora: Date,
): boolean {
  if (!c.hora_inicio || !c.hora_fim) return false;
  const t = agora.getHours() * 60 + agora.getMinutes();
  const ini = minutos(c.hora_inicio);
  const fim = minutos(c.hora_fim);
  if (ini === fim) return false;
  return ini < fim ? t >= ini && t < fim : t >= ini || t < fim;
}

/** Cardápio sugerido: o primeiro cuja janela de horário está aberta; senão o padrão; senão o primeiro. */
export function cardapioSugerido<T extends CardapioCadastro>(
  menus: readonly T[],
  agora: Date,
): T | null {
  const ordenados = [...menus].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  return (
    ordenados.find((m) => dentroDoHorario(m, agora)) ??
    ordenados.find((m) => m.padrao) ??
    ordenados[0] ??
    null
  );
}

/** Preço do item no cardápio: o do cardápio, se tiver; senão o preço base. */
export function precoNoCardapio(
  item: { id: string; preco: number },
  vinculos: readonly VinculoCardapio[],
  cardapioId: string | null,
): number {
  if (!cardapioId) return Number(item.preco);
  const v = vinculos.find((x) => x.cardapio_id === cardapioId && x.item_id === item.id);
  return v?.preco != null ? Number(v.preco) : Number(item.preco);
}

/** Itens do cardápio, na ordem dele (ordem do cardápio, depois a do item, depois o nome). */
export function itensDoCardapio<T extends { id: string; nome: string; ordem: number }>(
  itens: readonly T[],
  vinculos: readonly VinculoCardapio[],
  cardapioId: string,
): T[] {
  const doCardapio = new Map(
    vinculos.filter((v) => v.cardapio_id === cardapioId).map((v) => [v.item_id, v]),
  );
  return itens
    .filter((i) => doCardapio.has(i.id))
    .sort((a, b) => {
      const oa = doCardapio.get(a.id)?.ordem ?? a.ordem;
      const ob = doCardapio.get(b.id)?.ordem ?? b.ordem;
      return oa - ob || a.nome.localeCompare(b.nome, "pt-BR");
    });
}
