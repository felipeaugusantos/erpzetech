// Regras dos anexos da clínica sem dependência de tela: formatos, limite e conferência do arquivo (o banco e o armazenamento conferem de novo).

export const LIMITE_ANEXO_BYTES = 15 * 1024 * 1024;

export const TIPOS_ANEXO = [
  { mime: "image/jpeg", rotulo: "JPEG", extensoes: ["jpg", "jpeg"] },
  { mime: "image/png", rotulo: "PNG", extensoes: ["png"] },
  { mime: "application/pdf", rotulo: "PDF", extensoes: ["pdf"] },
] as const;

export const CATEGORIAS_ANEXO = [
  { value: "imagem", label: "Imagem (ultrassom, raio-x…)" },
  { value: "laudo", label: "Laudo em arquivo" },
  { value: "laboratorial", label: "Exame laboratorial" },
] as const;

export type CategoriaAnexo = (typeof CATEGORIAS_ANEXO)[number]["value"];

export type AnexoClinico = {
  id: string;
  categoria: CategoriaAnexo;
  descricao: string;
  nome_arquivo: string;
  mime: string;
  tamanho: number;
  situacao: "ativo" | "cancelado";
  created_at: string;
  veterinario: string;
  crmv: string;
  crmv_uf: string;
  cancelado_em: string | null;
  cancelado_motivo: string | null;
};

/** Formato do arquivo: o que o navegador informa ou, se vier vazio, o que a extensão diz. */
export function mimeDoArquivo(arquivo: { name: string; type: string }): string | null {
  const direto = TIPOS_ANEXO.find((t) => t.mime === arquivo.type.toLowerCase());
  if (direto) return direto.mime;
  if (arquivo.type) return null;
  const ext = arquivo.name.toLowerCase().split(".").pop() ?? "";
  return TIPOS_ANEXO.find((t) => (t.extensoes as readonly string[]).includes(ext))?.mime ?? null;
}

/** Tamanho como aparece na tela (KB ou MB, com vírgula). */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Confere o arquivo escolhido com as regras do banco; devolve a mensagem do primeiro erro. */
export function erroDoArquivo(arquivo: {
  name: string;
  size: number;
  type: string;
}): string | null {
  if (arquivo.size <= 0) return "O arquivo está vazio";
  if (arquivo.size > LIMITE_ANEXO_BYTES) return "O arquivo passa de 15 MB";
  if (!mimeDoArquivo(arquivo)) return "Formato não aceito: envie JPEG, PNG ou PDF";
  if (arquivo.name.trim().length === 0 || arquivo.name.length > 120)
    return "Nome do arquivo inválido (até 120 caracteres)";
  return null;
}
