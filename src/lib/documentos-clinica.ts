// Receituário e documentos da clínica sem dependência de tela: tipos, modelos iniciais e montagem do texto.
// As regras de verdade (perfil Veterinário, imutabilidade, numeração, recusa de controlado) ficam no banco.

export type TipoDocumento = "receita" | "atestado" | "termo" | "solicitacao_exame";

export const TIPOS_DOCUMENTO: Record<TipoDocumento, { rotulo: string; impresso: string }> = {
  receita: { rotulo: "Receita", impresso: "Receituário" },
  atestado: { rotulo: "Atestado", impresso: "Atestado veterinário" },
  termo: { rotulo: "Termo de consentimento", impresso: "Termo de consentimento" },
  solicitacao_exame: { rotulo: "Solicitação de exames", impresso: "Solicitação de exames" },
};

export type ItemReceita = {
  medicamento: string;
  posologia: string;
  via?: string;
  duracao?: string;
  quantidade?: string;
};
export type ItemExame = { exame: string; observacao?: string };

export type DocumentoClinico = {
  id: string;
  tipo: TipoDocumento;
  ano: number;
  numero: number;
  titulo: string;
  corpo: string | null;
  itens: (ItemReceita & ItemExame)[];
  situacao: "emitido" | "cancelado";
  emitido_em: string;
  cancelado_em: string | null;
  cancelado_motivo: string | null;
  atendimento_id: string | null;
  veterinario: { id: string; nome: string; crmv: string; crmv_uf: string };
  pet: {
    id: string;
    nome: string;
    especie: string;
    raca: string | null;
    sexo: string | null;
    peso_kg: number | null;
    nascimento: string | null;
  };
  tutor: { nome: string; cpf: string | null; cnpj: string | null; telefone: string | null };
  clinica: {
    nome: string | null;
    razao_social: string | null;
    cnpj: string | null;
    telefone: string | null;
    email: string | null;
    endereco: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    cep: string | null;
  } | null;
};

export type ResumoDocumento = {
  id: string;
  tipo: TipoDocumento;
  ano: number;
  numero: number;
  titulo: string;
  situacao: "emitido" | "cancelado";
  emitido_em: string;
  veterinario: string;
  atendimento_id: string | null;
};

export type ModeloDocumento = {
  id?: string;
  tipo: "atestado" | "termo";
  titulo: string;
  corpo: string;
};

export const numeroDoDocumento = (d: { numero: number; ano: number }) =>
  `${String(d.numero).padStart(4, "0")}/${d.ano}`;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "21 de outubro de 2026" a partir de AAAA-MM-DD ou de um instante ISO (usa o dia que veio escrito). */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? ""} de ${m[1]}`;
}

export type VariaveisDocumento = {
  tutor?: string;
  pet?: string;
  especie?: string;
  raca?: string | null;
  data?: string;
  veterinario?: string;
  crmv?: string;
  clinica?: string;
};

export const CAMPOS_DOCUMENTO = [
  "tutor",
  "pet",
  "especie",
  "raca",
  "data",
  "veterinario",
  "crmv",
  "clinica",
] as const;

/** Troca {tutor}, {pet}, {especie}, {raca}, {data}, {veterinario}, {crmv} e {clinica}; marcador sem valor fica como está. */
export function montarTextoDocumento(modelo: string, v: VariaveisDocumento): string {
  const mapa: Record<string, string | undefined> = {
    tutor: v.tutor,
    pet: v.pet,
    especie: v.especie,
    raca: v.raca ? v.raca : undefined,
    data: v.data,
    veterinario: v.veterinario,
    crmv: v.crmv,
    clinica: v.clinica,
  };
  return modelo.replace(
    /\{(tutor|pet|especie|raca|data|veterinario|crmv|clinica)\}/g,
    (m, k: string) => mapa[k] ?? m,
  );
}

/** Marcadores que ainda estão no texto (campo sem valor): o veterinário confere antes de emitir. */
export function marcadoresPendentes(texto: string): string[] {
  return [...new Set(texto.match(/\{[a-z]+\}/g) ?? [])];
}

const AVISO = "Modelo padrão: revise o texto com a assessoria jurídica da clínica antes de adotar.";

/** Modelos que acompanham o sistema; a clínica guarda os dela por cima. */
export const MODELOS_INICIAIS: readonly ModeloDocumento[] = [
  {
    tipo: "atestado",
    titulo: "Atestado de saúde",
    corpo:
      "Atesto, para os devidos fins, que o animal {pet}, da espécie {especie}, raça {raca}, de propriedade de {tutor}, foi examinado nesta data e, ao exame clínico, não apresentava sinais de doença infectocontagiosa, estando apto para a finalidade solicitada: ____________________.\n\n{clinica}, {data}.",
  },
  {
    tipo: "atestado",
    titulo: "Atestado de comparecimento",
    corpo:
      "Atesto, para os devidos fins, que {tutor} compareceu a {clinica} em {data}, acompanhando o animal {pet} (espécie {especie}) para atendimento médico-veterinário.",
  },
  {
    tipo: "termo",
    titulo: "Termo de consentimento — anestesia e procedimento",
    corpo:
      "Eu, {tutor}, tutor(a) do animal {pet} (espécie {especie}, raça {raca}), autorizo a realização do procedimento: ____________________, sob anestesia ou sedação, pelo(a) médico(a) veterinário(a) {veterinario} (CRMV {crmv}).\n\nFui informado(a) de que todo ato anestésico e cirúrgico envolve riscos, mesmo com a avaliação prévia e os cuidados adotados, inclusive o risco de intercorrências e de óbito, e que o resultado não pode ser garantido. Tive a oportunidade de esclarecer minhas dúvidas e informei ao veterinário o que sei sobre a saúde do animal, seus medicamentos em uso e alergias.\n\n{clinica}, {data}.\n\n" +
      AVISO,
  },
  {
    tipo: "termo",
    titulo: "Termo de consentimento — cirurgia",
    corpo:
      "Eu, {tutor}, tutor(a) do animal {pet} (espécie {especie}, raça {raca}), autorizo a realização da cirurgia: ____________________, pelo(a) médico(a) veterinário(a) {veterinario} (CRMV {crmv}), e a conduta que se mostrar necessária durante o ato para preservar a saúde do animal.\n\nFui informado(a) sobre a técnica, os riscos, o pós-operatório e os cuidados em casa, e sei que não há garantia de resultado. Estou ciente dos custos informados e de que o jejum e os exames pré-operatórios foram explicados.\n\n{clinica}, {data}.\n\n" +
      AVISO,
  },
  {
    tipo: "termo",
    titulo: "Termo de consentimento — eutanásia",
    corpo:
      "Eu, {tutor}, tutor(a) do animal {pet} (espécie {especie}, raça {raca}), declaro que, após avaliação e orientação do(a) médico(a) veterinário(a) {veterinario} (CRMV {crmv}), solicito e autorizo, de forma livre e consciente, a realização da eutanásia do meu animal, nos termos da regulamentação do Conselho Federal de Medicina Veterinária.\n\nFui informado(a) sobre o procedimento, que é irreversível, e sobre as alternativas disponíveis. Declaro ser o(a) responsável legal pelo animal.\n\n{clinica}, {data}.\n\n" +
      AVISO,
  },
  {
    tipo: "termo",
    titulo: "Termo de internação",
    corpo:
      "Eu, {tutor}, tutor(a) do animal {pet} (espécie {especie}, raça {raca}), autorizo a internação do meu animal em {clinica}, sob os cuidados do(a) médico(a) veterinário(a) {veterinario} (CRMV {crmv}).\n\nEstou ciente de que o quadro clínico pode mudar durante a internação, de que serei informado(a) das evoluções e dos custos, e de que devo manter um telefone de contato atualizado para decisões urgentes. Informei as alergias e os medicamentos em uso.\n\n{clinica}, {data}.\n\n" +
      AVISO,
  },
];

/** Receita em branco para começar o formulário. */
export const itemReceitaVazio = (): ItemReceita => ({ medicamento: "", posologia: "" });

/** O que falta para emitir (mesma conferência que o banco faz de novo). */
export function faltaParaEmitir(
  tipo: TipoDocumento,
  d: { titulo: string; corpo: string; receita: ItemReceita[]; exames: ItemExame[] },
): string[] {
  const f: string[] = [];
  if (d.titulo.trim().length < 3) f.push("o título");
  if (tipo === "atestado" || tipo === "termo") {
    if (!d.corpo.trim()) f.push("o texto do documento");
  } else if (tipo === "receita") {
    const itens = d.receita.filter((i) => i.medicamento.trim() || i.posologia.trim());
    if (itens.length === 0) f.push("pelo menos um medicamento");
    for (const i of itens) {
      if (!i.medicamento.trim()) f.push("o nome do medicamento");
      else if (!i.posologia.trim()) f.push(`a posologia de ${i.medicamento.trim()}`);
    }
  } else if (d.exames.filter((e) => e.exame.trim()).length === 0) f.push("pelo menos um exame");
  return f;
}
