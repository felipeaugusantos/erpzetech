import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * Cliente sem os tipos gerados: as tabelas hs_* e as funções hs_* só entram no arquivo de tipos do Supabase depois que as migrations
 * da Hotelaria são aplicadas. Os formatos estão em hotelaria-tipos.ts e o banco é quem valida tudo.
 */
export const hsDb = supabase as unknown as SupabaseClient;

/** Chama uma função do banco e devolve o resultado; erro do banco vira Error com a mensagem em português. */
export async function hsRpc<T = unknown>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await hsDb.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Resultado de uma consulta de tabela: devolve as linhas ou lança o erro. */
export function linhas<T>(r: { data: unknown; error: { message: string } | null }): T[] {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as T[];
}
