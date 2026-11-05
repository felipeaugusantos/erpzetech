// Portal do tutor: lógica pura das telas (sem rede). Três regras que o portal nunca quebra:
//   1. as consultas do portal têm chave "clinica-portal…": o cache do navegador guarda em texto simples tudo que NÃO começa com
//      "clinica-", e dado clínico de tutor nunca pode ir para lá;
//   2. o código do convite viaja no fragmento do link (#c=…), que o navegador não envia ao servidor nem ao próximo site;
//   3. o portal mostra o que a clínica registrou; não interpreta resultado, não marca "alto" ou "baixo" e não dá orientação clínica.

export const CHAVE_PORTAL = "clinica-portal";

/** Chave de consulta do portal (sempre com o prefixo que impede o cache em texto simples). */
export const chavePortal = (...partes: unknown[]) => [CHAVE_PORTAL, ...partes] as const;

const TAMANHO_CODIGO = 16;

/** Maiúsculas, só letras e números, no máximo 16: "abcd-ef01 2345…" vira "ABCDEF012345…". */
export function normalizarCodigo(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, TAMANHO_CODIGO);
}

/** Como o código aparece no campo: grupos de 4 separados por hífen. */
export function formatarCodigo(texto: string): string {
  return (normalizarCodigo(texto).match(/.{1,4}/g) ?? []).join("-");
}

export const codigoCompleto = (texto: string) => normalizarCodigo(texto).length === TAMANHO_CODIGO;

/** Link do portal com o código no FRAGMENTO (nunca em ?consulta, que vai para logs do servidor e para o referrer). */
export function linkDoConvite(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, "")}/portal/entrar#c=${normalizarCodigo(codigo)}`;
}

/** Código vindo do fragmento da página (#c=XXXX), ou "" se não houver um código completo. */
export function codigoDoFragmento(hash: string): string {
  const m = /(?:^|[#&])c=([A-Za-z0-9-]+)/.exec(hash);
  const c = m ? normalizarCodigo(m[1] ?? "") : "";
  return c.length === TAMANHO_CODIGO ? c : "";
}

/** Texto pronto para a recepção copiar e entregar ao tutor (o sistema não envia nada). */
export function mensagemConvite(p: {
  clinica: string;
  tutor: string;
  codigo: string;
  link: string;
  expiraEm: string;
}): string {
  const validade = new Date(p.expiraEm).toLocaleDateString("pt-BR");
  return [
    `Olá, ${p.tutor}! A ${p.clinica} liberou o seu acesso ao portal do tutor, onde você vê as próximas vacinas, e os exames e receitas que a clínica liberar.`,
    "",
    `Para entrar, abra: ${p.link}`,
    `Se o link não abrir o código sozinho, use este código: ${formatarCodigo(p.codigo)}`,
    `O código vale até ${validade} e só pode ser usado uma vez.`,
  ].join("\n");
}

export type VacinaPortal = {
  nome: string;
  tipo: string;
  proxima_dose_em: string;
  atrasada: boolean;
};

const DIA_MS = 86_400_000;

/** Quando é a próxima dose, em palavras, a partir da data registrada pela clínica (sem recomendar nada). */
export function quandoVacina(proximaDoseEm: string, hoje: Date = new Date()): string {
  const alvo = new Date(`${proximaDoseEm.slice(0, 10)}T00:00:00`);
  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.round((alvo.getTime() - ref.getTime()) / DIA_MS);
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias > 1) return `em ${dias} dias`;
  if (dias === -1) return "atrasada há 1 dia";
  return `atrasada há ${-dias} dias`;
}

export type EstadoItem = "disponivel" | "cancelado" | "indisponivel" | "nao_liberado";

/** Aviso claro para cada estado (null = o item está disponível e não precisa de aviso). */
export function avisoDoEstado(estado: EstadoItem, tipo: "exame" | "receita"): string | null {
  switch (estado) {
    case "disponivel":
      return null;
    case "cancelado":
      return tipo === "receita"
        ? "Esta receita foi cancelada pela clínica. Não use: peça uma nova à clínica."
        : "Este item foi cancelado pela clínica.";
    case "indisponivel":
      return "Este item não está disponível no momento. Fale com a clínica.";
    case "nao_liberado":
      return "A clínica ainda não liberou este item para você. Fale com a clínica.";
  }
}

export type ResultadoExame = {
  grupo: string | null;
  nome: string;
  unidade: string | null;
  forma: string;
  casas: number | null;
  valor_num: number | null;
  valor_texto: string | null;
  faixa_min: number | null;
  faixa_max: number | null;
};

/** Valor como a clínica registrou: número com as casas do campo, ou o texto. Nunca "alto" nem "baixo". */
export function valorDoResultado(r: ResultadoExame): string {
  if (r.valor_texto) return r.valor_texto;
  if (r.valor_num === null || r.valor_num === undefined) return "—";
  const casas = r.casas ?? 2;
  const n = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(Number(r.valor_num));
  return r.unidade ? `${n} ${r.unidade}` : n;
}

/** Referência cadastrada pela clínica para a espécie ("5,5 a 8,5"), ou null. Só exibição: não compara com o valor. */
export function referenciaDoResultado(r: ResultadoExame): string | null {
  if (r.forma !== "numero" && r.forma !== "calculado") return null;
  const { faixa_min: min, faixa_max: max } = r;
  if (min === null && max === null) return null;
  const casas = r.casas ?? 2;
  const f = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(Number(v));
  if (min !== null && max !== null) return `${f(min)} a ${f(max)}`;
  return min !== null ? `a partir de ${f(min)}` : `até ${f(max as number)}`;
}

/** Agrupa os resultados pelo grupo do modelo (mantém a ordem em que vieram); sem grupo vai em "Resultados". */
export function agruparResultados(
  rs: ResultadoExame[],
): { grupo: string; itens: ResultadoExame[] }[] {
  const ordem: string[] = [];
  const mapa = new Map<string, ResultadoExame[]>();
  for (const r of rs) {
    const g = r.grupo?.trim() || "Resultados";
    if (!mapa.has(g)) {
      mapa.set(g, []);
      ordem.push(g);
    }
    mapa.get(g)!.push(r);
  }
  return ordem.map((grupo) => ({ grupo, itens: mapa.get(grupo)! }));
}

export type DadosPortalDoPet = {
  id: string;
  nome: string;
  especie: string;
  raca: string | null;
  nascimento: string | null;
  vacinas: VacinaPortal[];
  exames: number;
  receitas: number;
};

export type CadastroPortal = {
  vinculo_id: string;
  clinica: string | null;
  tutor: string | null;
  pets: DadosPortalDoPet[];
};
