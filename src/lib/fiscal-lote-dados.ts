import { supabase } from "@/integrations/supabase/client";
import {
  consultasDosProdutos,
  emLotesFiscais,
  juntarLotes,
  lerLoteSugestoes,
  type LoteSugestoes,
} from "./fiscal-lote";

type Chamada = (
  nome: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Consulta a base fiscal para os NCMs (e CEST) dos produtos, em lotes. Só leitura. Devolve nulo se não houver NCM de 8 dígitos.
 * Os tipos gerados só conhecem a função depois da migração aplicada, por isso a chamada é tipada aqui.
 */
export async function consultarLoteFiscal(
  produtos: readonly { ncm: string | null; cest: string | null }[],
): Promise<LoteSugestoes | null> {
  const consultas = consultasDosProdutos(produtos);
  if (consultas.length === 0) return null;
  const respostas: LoteSugestoes[] = [];
  for (const lote of emLotesFiscais(consultas)) {
    const { data, error } = await (supabase as unknown as { rpc: Chamada }).rpc(
      "fiscal_sugerir_lote",
      { p_itens: lote },
    );
    if (error) throw new Error(error.message);
    const lido = lerLoteSugestoes(data);
    if (!lido) throw new Error("Resposta inesperada da base fiscal");
    respostas.push(lido);
  }
  return juntarLotes(respostas);
}
