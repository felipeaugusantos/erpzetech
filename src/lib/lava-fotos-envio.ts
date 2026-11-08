import { supabase } from "@/integrations/supabase/client";
import { erroDaFoto, nomeDaFotoReduzida, reduzirFoto, type MomentoFoto } from "@/lib/lava-fotos";

export const BUCKET_FOTOS = "lava-fotos";
export const FOTOS_POR_AVARIA = 3;

export type FotoDaOrdem = {
  id: string;
  momento: MomentoFoto;
  nome_arquivo: string;
  caminho: string;
  created_at: string;
  pode_cancelar: boolean;
  avaria_id: string | null;
  url: string | null;
};

/** Fotos ativas da ordem com link temporário de 60 s (a lista é renovada antes de expirar). */
export async function listarFotosDaOrdem(ordemId: string): Promise<FotoDaOrdem[]> {
  const { data, error } = await supabase.rpc("lr_fotos_da_ordem", { p_ordem_id: ordemId });
  if (error) throw error;
  const lista = (data ?? []) as unknown as Omit<FotoDaOrdem, "url">[];
  if (lista.length === 0) return [];
  const { data: links } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(
    lista.map((f) => f.caminho),
    60,
  );
  return lista.map((f) => ({
    ...f,
    url: links?.find((l) => l.path === f.caminho)?.signedUrl ?? null,
  }));
}

/** Reduz, reserva o caminho, envia e confirma uma foto (de uma avaria, se informada). */
export async function enviarFotoDaOrdem(
  ordemId: string,
  momento: MomentoFoto,
  arquivo: File,
  avariaId?: string,
) {
  const erro = erroDaFoto(arquivo);
  if (erro) throw new Error(`${arquivo.name}: ${erro}`);
  let blob: Blob;
  try {
    blob = await reduzirFoto(arquivo);
  } catch {
    throw new Error(`${arquivo.name}: não foi possível ler a foto neste aparelho`);
  }
  const { data: reserva, error: e1 } = await supabase.rpc("lr_foto_preparar", {
    p_ordem_id: ordemId,
    p_momento: momento,
    p_nome_arquivo: nomeDaFotoReduzida(arquivo.name),
    p_mime: "image/jpeg",
    p_tamanho: blob.size,
    ...(avariaId ? { p_avaria_id: avariaId } : {}),
  });
  if (e1) throw e1;
  const { id, caminho } = reserva as unknown as { id: string; caminho: string };
  const up = await supabase.storage
    .from(BUCKET_FOTOS)
    .upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw up.error;
  const { error: e3 } = await supabase.rpc("lr_foto_confirmar", { p_id: id });
  if (e3) throw e3;
}
