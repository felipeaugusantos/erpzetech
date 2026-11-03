// Ordem de serviço do pet sem dependência de tela: andamento, retrato do animal e totais (o banco confere as regras de verdade).

export const SITUACOES_OS_PET = [
  { value: "aberta", label: "Aberta" },
  { value: "orcamento", label: "Orçamento enviado" },
  { value: "aprovada", label: "Aprovada" },
  { value: "em_reparo", label: "Em atendimento" },
  { value: "pronta", label: "Pronta" },
  { value: "entregue", label: "Entregue" },
  { value: "cancelada", label: "Cancelada" },
] as const;

export const PRIORIDADES_OS = [
  { value: "baixa", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
] as const;

export const rotuloSituacaoOsPet = (v: string) =>
  SITUACOES_OS_PET.find((s) => s.value === v)?.label ?? v;

export const osEncerrada = (situacao: string) =>
  situacao === "entregue" || situacao === "cancelada";

const ORDEM = ["aberta", "orcamento", "aprovada", "em_reparo", "pronta", "entregue"];

/** Próxima etapa do andamento normal (null quando a ordem está encerrada ou já é a última). */
export function proximaSituacaoOsPet(situacao: string): { para: string; rotulo: string } | null {
  const i = ORDEM.indexOf(situacao);
  if (i < 0 || i >= ORDEM.length - 1) return null;
  const para = ORDEM[i + 1]!;
  const rotulos: Record<string, string> = {
    orcamento: "Enviar orçamento",
    aprovada: "Aprovar",
    em_reparo: "Começar atendimento",
    pronta: "Marcar como pronta",
    entregue: "Entregar",
  };
  return { para, rotulo: rotulos[para] ?? rotuloSituacaoOsPet(para) };
}

export type ResumoPetOs = {
  nome: string;
  especie: string;
  raca: string | null;
  porte: string | null;
  sexo: string | null;
  pelagem: string | null;
  peso_kg: number | null;
  nascimento: string | null;
  castrado: boolean | null;
  alergias: string | null;
  microchip: string | null;
  tutor: string | null;
  tutor_telefone: string | null;
};

export type ItemOsPet = {
  id: string;
  tipo: string;
  descricao: string;
  quantidade: number;
  preco_unitario: number;
  total: number;
};

/** "Produto" sai do estoque (tipo peça); o resto é serviço. */
export const rotuloTipoItemOs = (tipo: string) => (tipo === "peca" ? "Produto" : "Serviço");

export const totalDoItem = (quantidade: number, preco: number) =>
  Math.round(quantidade * preco * 100) / 100;

/** Total da ordem: itens menos desconto, nunca negativo. */
export function totalDaOs(itens: readonly Pick<ItemOsPet, "total">[], desconto: number) {
  const soma = itens.reduce((s, i) => s + Number(i.total), 0);
  return Math.max(Math.round((soma - Math.max(desconto, 0)) * 100) / 100, 0);
}
