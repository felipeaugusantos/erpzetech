// Foto do item do cardápio: bucket público `cardapio-fotos`, pasta da empresa, nome aleatório.
// O banco confere o caminho (pasta da própria empresa, nome simples) e o armazenamento só deixa a gestão enviar.
import { supabase } from "@/integrations/supabase/client";
import { erroDaFoto, reduzirFoto } from "@/lib/lava-fotos";

export const BUCKET_CARDAPIO = "cardapio-fotos";

/** Endereço público da foto (ou null quando o item não tem foto). */
export function urlFotoCardapio(caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  return supabase.storage.from(BUCKET_CARDAPIO).getPublicUrl(caminho).data.publicUrl;
}

/** Endereço público a partir da base do projeto (para a página pública, no servidor). */
export function urlPublicaFoto(base: string, caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET_CARDAPIO}/${caminho}`;
}

/** Caminho novo: `<empresa>/<id aleatório>.jpg`. */
export function caminhoNovoFoto(tenantId: string): string {
  return `${tenantId}/${crypto.randomUUID()}.jpg`;
}

/** Reduz a foto, envia e devolve o caminho gravado. Quem chama grava o caminho no item e apaga a foto antiga. */
export async function enviarFotoCardapio(tenantId: string, arquivo: File): Promise<string> {
  const erro = erroDaFoto(arquivo);
  if (erro) throw new Error(erro);
  const blob = await reduzirFoto(arquivo);
  const caminho = caminhoNovoFoto(tenantId);
  const { error } = await supabase.storage
    .from(BUCKET_CARDAPIO)
    .upload(caminho, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return caminho;
}

/** Apaga a foto antiga; falhar aqui não atrapalha (fica só um arquivo sem uso). */
export async function apagarFotoCardapio(caminho: string | null | undefined) {
  if (!caminho) return;
  await supabase.storage.from(BUCKET_CARDAPIO).remove([caminho]);
}
