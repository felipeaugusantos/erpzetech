// Campos personalizados do pet e do tutor sem dependência de tela: tipos, conferência dos valores e texto para a tela e a impressão.
// O banco confere de novo (supabase/migrations/20261210000000_pet_campos_personalizados.sql).

export type EntidadeCampo = "pet" | "tutor";
export type TipoCampoPet = "texto" | "numero" | "data" | "sim_nao" | "lista";

export const ENTIDADES_CAMPO: readonly { value: EntidadeCampo; label: string }[] = [
  { value: "pet", label: "Animal" },
  { value: "tutor", label: "Tutor" },
];

export const TIPOS_CAMPO_PET: readonly { value: TipoCampoPet; label: string }[] = [
  { value: "texto", label: "Texto" },
  { value: "numero", label: "Número" },
  { value: "data", label: "Data" },
  { value: "sim_nao", label: "Sim ou não" },
  { value: "lista", label: "Lista de opções" },
];

export type CampoPet = {
  id: string;
  entidade: EntidadeCampo;
  nome: string;
  tipo: TipoCampoPet;
  opcoes: string[];
  obrigatorio: boolean;
  ordem: number;
  ativo: boolean;
};

/** Opções digitadas uma por linha (ou separadas por ponto e vírgula): tira vazias e repetidas. */
export function opcoesDoTexto(texto: string): string[] {
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const parte of texto.split(/[\n;]+/)) {
    const o = parte.trim();
    if (!o || vistas.has(o)) continue;
    vistas.add(o);
    lista.push(o);
  }
  return lista;
}

/** Campos ativos de uma entidade, na ordem da tela (ordem e depois nome). */
export function camposAtivos(campos: readonly CampoPet[], entidade: EntidadeCampo): CampoPet[] {
  return campos
    .filter((c) => c.entidade === entidade && c.ativo)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Mensagem do primeiro problema de um valor (vazio vale se o campo não é obrigatório); null quando está certo. */
export function erroDoValor(campo: CampoPet, valor: string | undefined): string | null {
  const v = (valor ?? "").trim();
  if (!v) return campo.obrigatorio ? `Preencha o campo "${campo.nome}".` : null;
  if (v.length > 500) return `O campo "${campo.nome}" aceita até 500 letras.`;
  if (campo.tipo === "numero" && !/^-?\d+([.,]\d+)?$/.test(v))
    return `O campo "${campo.nome}" aceita só número.`;
  if (campo.tipo === "data") {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    const dt = d ? new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!)) : null;
    if (!d || !dt || dt.getUTCMonth() !== +d[2]! - 1)
      return `O campo "${campo.nome}" precisa de uma data válida.`;
  }
  if (campo.tipo === "sim_nao" && v !== "sim" && v !== "nao")
    return `O campo "${campo.nome}" aceita sim ou não.`;
  if (campo.tipo === "lista" && !campo.opcoes.includes(v))
    return `Escolha uma opção válida em "${campo.nome}".`;
  return null;
}

/** Primeiro erro entre os campos ativos da entidade. */
export function erroDosCampos(
  campos: readonly CampoPet[],
  entidade: EntidadeCampo,
  valores: Record<string, string>,
): string | null {
  for (const c of camposAtivos(campos, entidade)) {
    const e = erroDoValor(c, valores[c.id]);
    if (e) return e;
  }
  return null;
}

/** Pacote enviado ao banco: número com ponto; valor vazio vai vazio (o banco apaga). */
export function valoresParaEnvio(
  campos: readonly CampoPet[],
  entidade: EntidadeCampo,
  valores: Record<string, string>,
): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const c of camposAtivos(campos, entidade)) {
    const v = (valores[c.id] ?? "").trim();
    saida[c.id] = c.tipo === "numero" ? v.replace(",", ".") : v;
  }
  return saida;
}

/** Valor como aparece na tela ou no papel. */
export function valorLegivel(campo: Pick<CampoPet, "tipo">, valor: string): string {
  if (campo.tipo === "sim_nao") return valor === "sim" ? "Sim" : valor === "nao" ? "Não" : valor;
  if (campo.tipo === "data") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
  }
  if (campo.tipo === "numero") return valor.replace(".", ",");
  return valor;
}
