// O link usado para entrar é guardado no navegador até o login terminar (inclusive no retorno do Google) e então registrado no servidor.
import { registrarAcessoPorLink } from "@/lib/link-uso.functions";

const CHAVE = "zt:link-de-entrada";

export function guardarLinkDeEntrada(slug: string) {
  try {
    localStorage.setItem(CHAVE, slug);
  } catch {
    // sem armazenamento: o uso deste acesso simplesmente não é registrado
  }
}

/** Registra o link guardado (uma vez) e apaga. Falha de rede não atrapalha a entrada. */
export async function registrarLinkDeEntrada() {
  let slug: string | null = null;
  try {
    slug = localStorage.getItem(CHAVE);
    if (!slug) return;
    localStorage.removeItem(CHAVE);
  } catch {
    return;
  }
  try {
    await registrarAcessoPorLink({ data: { slug } });
  } catch {
    // o registro de uso é informativo
  }
}
