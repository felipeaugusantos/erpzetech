// Foto do animal: reduz a imagem escolhida para uma miniatura JPEG pequena (o banco aceita até ~90 KB).

export const LADO_FOTO = 320;
export const LIMITE_FOTO_CHARS = 120000;

/** Confere o valor que vai ao banco: JPEG em data URL e dentro do limite. */
export const fotoValida = (foto: string | null | undefined) =>
  !foto || (foto.startsWith("data:image/jpeg;base64,") && foto.length <= LIMITE_FOTO_CHARS);

/** Lado menor da miniatura mantendo a proporção (nunca amplia). */
export function tamanhoDaMiniatura(largura: number, altura: number, lado = LADO_FOTO) {
  const maior = Math.max(largura, altura);
  if (maior <= lado) return { largura, altura };
  const f = lado / maior;
  return {
    largura: Math.max(1, Math.round(largura * f)),
    altura: Math.max(1, Math.round(altura * f)),
  };
}

/** Lê a imagem no navegador e devolve a miniatura JPEG; baixa a qualidade até caber no limite. */
export async function reduzirFoto(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem (JPEG ou PNG).");
  const bmp = await createImageBitmap(arquivo);
  const { largura, altura } = tamanhoDaMiniatura(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a foto neste navegador.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(bmp, 0, 0, largura, altura);
  bmp.close();
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (fotoValida(url)) return url;
  }
  throw new Error("A foto ficou grande demais; escolha outra.");
}
