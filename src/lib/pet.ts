// Regras do módulo Pet shop sem dependência de tela: rótulos e preço do serviço por porte, raça e pelagem.

export const ESPECIES = [
  { value: "cao", label: "Cão" },
  { value: "gato", label: "Gato" },
  { value: "outro", label: "Outro" },
] as const;

export const PORTES = [
  { value: "mini", label: "Mini" },
  { value: "pequeno", label: "Pequeno" },
  { value: "medio", label: "Médio" },
  { value: "grande", label: "Grande" },
  { value: "gigante", label: "Gigante" },
] as const;

export const PELAGENS = [
  { value: "curta", label: "Curta" },
  { value: "media", label: "Média" },
  { value: "longa", label: "Longa" },
  { value: "dupla", label: "Dupla" },
  { value: "crespa", label: "Crespa" },
  { value: "sem_pelo", label: "Sem pelo" },
] as const;

export const SEXOS = [
  { value: "macho", label: "Macho" },
  { value: "femea", label: "Fêmea" },
] as const;

export const CATEGORIAS_SERVICO = [
  { value: "banho", label: "Banho" },
  { value: "tosa", label: "Tosa" },
  { value: "estetica", label: "Estética" },
  { value: "outro", label: "Outro" },
] as const;

export const FUNCOES_PROFISSIONAL = [
  { value: "banhista", label: "Banhista" },
  { value: "tosador", label: "Tosador" },
  { value: "groomer", label: "Groomer" },
  { value: "veterinario", label: "Veterinário" },
  { value: "auxiliar", label: "Auxiliar" },
  { value: "outro", label: "Outro" },
] as const;

type Opcao = readonly { value: string; label: string }[];

export const rotulo = (lista: Opcao, valor: string | null | undefined) =>
  lista.find((o) => o.value === valor)?.label ?? "";

/** Pontos de cada critério: raça pesa mais que pelagem, que pesa mais que porte (cada combinação tem um total único). */
const PESO_RACA = 4;
const PESO_PELAGEM = 2;
const PESO_PORTE = 1;

export type PetPreco = {
  id?: string;
  porte: string | null;
  raca: string | null;
  pelagem: string | null;
  preco: number;
};

export type PetParaPreco = {
  porte?: string | null;
  raca?: string | null;
  pelagem?: string | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export function pontosDoPreco(p: Pick<PetPreco, "porte" | "raca" | "pelagem">) {
  return (p.raca ? PESO_RACA : 0) + (p.pelagem ? PESO_PELAGEM : 0) + (p.porte ? PESO_PORTE : 0);
}

/** O preço vale para o pet quando cada critério preenchido é igual ao do pet (critério vazio vale para qualquer um). */
export function precoServeAoPet(p: PetPreco, pet: PetParaPreco) {
  if (p.porte && p.porte !== (pet.porte ?? null)) return false;
  if (p.raca && norm(p.raca) !== norm(pet.raca)) return false;
  if (p.pelagem && p.pelagem !== (pet.pelagem ?? null)) return false;
  return true;
}

/** Entre os preços que servem ao pet, vence o mais específico; sem nenhum, o serviço não é oferecido para ele (null). */
export function precoDoServico(precos: readonly PetPreco[], pet: PetParaPreco): PetPreco | null {
  let melhor: PetPreco | null = null;
  for (const p of precos) {
    if (!precoServeAoPet(p, pet)) continue;
    if (!melhor || pontosDoPreco(p) > pontosDoPreco(melhor)) melhor = p;
  }
  return melhor;
}

/** Texto curto dos critérios de um preço: "Poodle · Pelagem longa · Porte pequeno" ou "Qualquer pet". */
export function descricaoDoPreco(p: Pick<PetPreco, "porte" | "raca" | "pelagem">) {
  const partes = [
    p.raca ? p.raca : null,
    p.pelagem ? `Pelagem ${rotulo(PELAGENS, p.pelagem).toLowerCase()}` : null,
    p.porte ? `Porte ${rotulo(PORTES, p.porte).toLowerCase()}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Qualquer pet";
}

/** Idade em texto a partir do nascimento (AAAA-MM-DD). */
export function idadeDoPet(nascimento: string | null | undefined, hoje = new Date()) {
  if (!nascimento) return "";
  const n = new Date(`${nascimento}T00:00:00`);
  if (Number.isNaN(n.getTime())) return "";
  let meses = (hoje.getFullYear() - n.getFullYear()) * 12 + (hoje.getMonth() - n.getMonth());
  if (hoje.getDate() < n.getDate()) meses -= 1;
  if (meses < 0) return "";
  if (meses < 12) return meses === 1 ? "1 mês" : `${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "1 ano" : `${anos} anos`;
}
