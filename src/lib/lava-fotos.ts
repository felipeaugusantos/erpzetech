// Regras das fotos do lava rápido sem dependência de tela: formatos, limite e tamanho reduzido (o banco e o armazenamento conferem de novo).

export const LIMITE_FOTO_BYTES = 8 * 1024 * 1024;
export const LADO_MAXIMO_FOTO = 1600;
export const FOTOS_POR_MOMENTO = 12;

export const MOMENTOS_FOTO = [
  { value: "antes", label: "Antes da lavagem" },
  { value: "depois", label: "Depois da lavagem" },
] as const;
export type MomentoFoto = (typeof MOMENTOS_FOTO)[number]["value"];

const TIPOS_FOTO = [
  { mime: "image/jpeg", extensoes: ["jpg", "jpeg"] },
  { mime: "image/png", extensoes: ["png"] },
  { mime: "image/webp", extensoes: ["webp"] },
] as const;

/** Formato aceito: o que o navegador informa ou, se vier vazio, o que a extensão diz. */
export function mimeDaFoto(arquivo: { name: string; type: string }): string | null {
  const direto = TIPOS_FOTO.find((t) => t.mime === arquivo.type.toLowerCase());
  if (direto) return direto.mime;
  if (arquivo.type) return null;
  const ext = arquivo.name.toLowerCase().split(".").pop() ?? "";
  return TIPOS_FOTO.find((t) => (t.extensoes as readonly string[]).includes(ext))?.mime ?? null;
}

/** Confere o arquivo escolhido; devolve a mensagem do primeiro erro (antes de reduzir a foto). */
export function erroDaFoto(arquivo: { name: string; size: number; type: string }): string | null {
  if (arquivo.size <= 0) return "O arquivo está vazio";
  if (!mimeDaFoto(arquivo)) return "Formato não aceito: envie JPEG, PNG ou WebP";
  if (arquivo.name.trim().length === 0) return "Arquivo sem nome";
  return null;
}

/** Novo tamanho com o maior lado limitado, sem ampliar e mantendo a proporção. */
export function dimensoesReduzidas(largura: number, altura: number, maximo = LADO_MAXIMO_FOTO) {
  const maior = Math.max(largura, altura);
  if (maior <= maximo) return { largura, altura };
  const fator = maximo / maior;
  return { largura: Math.round(largura * fator), altura: Math.round(altura * fator) };
}

/** Nome do arquivo reduzido: mantém o nome original, troca a extensão por .jpg e corta em 120 caracteres. */
export function nomeDaFotoReduzida(nome: string) {
  const base = nome.replace(/\.[^.]+$/, "").trim() || "foto";
  return `${base.slice(0, 110)}.jpg`;
}

/** Reduz a foto no navegador (fotos de câmera chegam a vários MB) e devolve um JPEG. */
export async function reduzirFoto(arquivo: File): Promise<Blob> {
  const imagem = await createImageBitmap(arquivo);
  const { largura, altura } = dimensoesReduzidas(imagem.width, imagem.height);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a foto");
  ctx.drawImage(imagem, 0, 0, largura, altura);
  imagem.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
  if (!blob) throw new Error("Não foi possível preparar a foto");
  return blob;
}

/** Texto do cartão do pátio: "Sem fotos", "2 antes", "2 antes · 1 depois". */
export function textoFotos(antes: number, depois: number) {
  if (antes + depois === 0) return "Sem fotos";
  return [antes > 0 ? `${antes} antes` : "", depois > 0 ? `${depois} depois` : ""]
    .filter(Boolean)
    .join(" · ");
}
