import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { LIMITE_LOTE, URL_MAPA, emLotes, lerBulario, type ItemBulario } from "./bulario.ts";
import { decodificar } from "./importacao.ts";

const LIMITE_BYTES = 80 * 1024 * 1024;

/** Só a equipe EZRA carrega a base global; a empresa apenas consulta. */
async function exigirOperador(supabase: {
  rpc: (n: "eh_saas_operador") => PromiseLike<{ data: boolean | null; error: unknown }>;
}) {
  const { data, error } = await supabase.rpc("eh_saas_operador");
  if (error) throw error;
  if (data !== true) throw new Error("Somente a equipe EZRA carrega o bulário");
}

async function gravar(itens: ItemBulario[]): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let total = 0;
  for (const lote of emLotes(itens, LIMITE_LOTE)) {
    const { data, error } = await supabaseAdmin.rpc("bulario_importar", {
      p_itens: lote as unknown as never,
    });
    if (error) throw error;
    total += Number(data ?? 0);
  }
  return total;
}

/** Baixa o CSV oficial do MAPA (endereço fixo, nunca informado pelo usuário) e grava a base inteira. */
export const carregarBularioDoMapa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirOperador(context.supabase as never);
    const resp = await fetch(URL_MAPA, { redirect: "follow" });
    if (!resp.ok)
      throw new Error(
        `O MAPA não respondeu (HTTP ${resp.status}). Tente de novo ou envie o arquivo.`,
      );
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength > LIMITE_BYTES) throw new Error("Arquivo do MAPA maior que o esperado");
    const leitura = lerBulario(decodificar(bytes));
    if (leitura.erro) throw new Error(leitura.erro);
    const gravados = await gravar(leitura.itens);
    return { lidos: leitura.itens.length, gravados, ignoradas: leitura.ignoradas };
  });

/** Um lote já lido no navegador (arquivo enviado à mão, quando o download direto não funciona). */
export const importarLoteBulario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itens: ItemBulario[] }) => {
    if (!Array.isArray(input?.itens) || input.itens.length === 0) throw new Error("Lote vazio");
    if (input.itens.length > LIMITE_LOTE) throw new Error(`Até ${LIMITE_LOTE} itens por lote`);
    return { itens: input.itens };
  })
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase as never);
    return { gravados: await gravar(data.itens) };
  });
