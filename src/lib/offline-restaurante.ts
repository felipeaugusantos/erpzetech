import { supabase } from "@/integrations/supabase/client";
import { ehErroDeRede } from "@/lib/offline";
import type { ComandaOffline } from "./offline-restaurante-conta.ts";

export { subtotalOffline, totalOffline } from "./offline-restaurante-conta.ts";
export type { ComandaOffline, ItemOffline } from "./offline-restaurante-conta.ts";

export type MesaOffline = { id: string; numero: string };
export type ItemCardapioOffline = { id: string; nome: string; preco: number };
export type CaixaOffline = { id: string; numero: number; filial_id: string | null };
export type BaseRestauranteOffline = {
  mesas: MesaOffline[];
  itens: ItemCardapioOffline[];
  caixas: CaixaOffline[];
  taxaServico: number;
};

const CHAVE = "zt-comandas-offline";
export const EVENTO_COMANDAS_OFFLINE = "zt-comandas-offline";

export function lerComandasOffline(): ComandaOffline[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as ComandaOffline[];
  } catch {
    return [];
  }
}

export function salvarComandasOffline(lista: ComandaOffline[]) {
  localStorage.setItem(CHAVE, JSON.stringify(lista));
  window.dispatchEvent(new Event(EVENTO_COMANDAS_OFFLINE));
}

/** Envia as comandas guardadas. Cada uma é gravada inteira (ou nada) e nunca em dobro. */
export async function sincronizarComandasOffline(): Promise<{
  enviadas: number;
  recusadas: number;
}> {
  if (!navigator.onLine) return { enviadas: 0, recusadas: 0 };
  const lista = lerComandasOffline();
  let enviadas = 0;
  let recusadas = 0;
  const restantes: ComandaOffline[] = [];
  for (const c of lista) {
    // comanda ainda aberta no computador continua aqui até ser fechada
    if (!c.fechar && c.tipo === "salao" && !c.erro && c.itens.length === 0) {
      restantes.push(c);
      continue;
    }
    if (c.erro) {
      restantes.push(c);
      continue;
    }
    const { error } = await supabase.rpc(
      "restaurante_sincronizar_offline" as never,
      {
        p: c,
      } as never,
    );
    if (!error) enviadas++;
    else if (ehErroDeRede(error.message)) restantes.push(c);
    else {
      recusadas++;
      restantes.push({ ...c, erro: error.message });
    }
  }
  salvarComandasOffline(restantes);
  return { enviadas, recusadas };
}

/** Atualiza a cópia de mesas, cardápio e caixas usada sem internet. */
export async function atualizarBaseRestauranteOffline(): Promise<void> {
  if (!navigator.onLine) return;
  const de = (t: string) => supabase.from(t as never);
  const [mesas, itens, caixas] = await Promise.all([
    de("mesas").select("id, numero, ativa"),
    de("cardapio_itens").select("id, nome, preco, ativo, interno").order("nome"),
    supabase.from("caixas").select("id, numero, filial_id").eq("situacao", "aberto"),
  ]);
  if (mesas.error || itens.error || caixas.error) return;
  const base: BaseRestauranteOffline = {
    mesas: ((mesas.data ?? []) as unknown as (MesaOffline & { ativa: boolean })[])
      .filter((m) => m.ativa)
      .map((m) => ({ id: m.id, numero: m.numero }))
      .sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true })),
    itens: (
      (itens.data ?? []) as unknown as (ItemCardapioOffline & {
        ativo: boolean;
        interno: boolean;
      })[]
    )
      .filter((i) => i.ativo && !i.interno)
      .map((i) => ({ id: i.id, nome: i.nome, preco: Number(i.preco) })),
    caixas: (caixas.data ?? []).map((c) => ({
      id: c.id,
      numero: Number(c.numero),
      filial_id: c.filial_id,
    })),
    taxaServico: 10,
  };
  localStorage.setItem("zt-base-restaurante", JSON.stringify(base));
}

export function lerBaseRestauranteOffline(): BaseRestauranteOffline | null {
  try {
    const t = localStorage.getItem("zt-base-restaurante");
    return t ? (JSON.parse(t) as BaseRestauranteOffline) : null;
  } catch {
    return null;
  }
}
