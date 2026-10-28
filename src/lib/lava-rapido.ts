// Regras do Lava rápido sem dependência de tela: ficam à parte para os testes rodarem no Node.
// As mesmas regras estão no banco (lr_* em supabase/migrations/20261117000000_lava_rapido.sql); o banco é quem decide.

export const TIPOS_VEICULO = [
  { value: "carro", label: "Carro" },
  { value: "moto", label: "Moto" },
  { value: "caminhonete", label: "Caminhonete" },
  { value: "aviao", label: "Avião" },
  { value: "helicoptero", label: "Helicóptero" },
] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number]["value"];

export const CATEGORIAS_SERVICO = [
  { value: "lavagem", label: "Lavagem" },
  { value: "polimento", label: "Polimento" },
  { value: "higienizacao", label: "Higienização" },
  { value: "estetica", label: "Estética" },
  { value: "outro", label: "Outro" },
] as const;

export const rotuloTipo = (tipo: string | null | undefined) =>
  TIPOS_VEICULO.find((t) => t.value === tipo)?.label ?? "Qualquer veículo";

export const rotuloCategoria = (cat: string | null | undefined) =>
  CATEGORIAS_SERVICO.find((c) => c.value === cat)?.label ?? "Outro";

/** Avião e helicóptero são identificados pelo prefixo da aeronave; os demais, pela placa. */
export const ehAeronave = (tipo: string | null | undefined) =>
  tipo === "aviao" || tipo === "helicoptero";

/** Deixa só letras e números, em maiúsculas (abc-1d23 → ABC1D23). */
export function normalizarIdentificacao(texto: string) {
  return texto.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23) para veículo terrestre; 4 a 6 letras/números para aeronave. */
export function identificacaoValida(tipo: string, texto: string) {
  const id = normalizarIdentificacao(texto);
  if (ehAeronave(tipo)) return /^[A-Z0-9]{4,6}$/.test(id);
  return /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/.test(id);
}

/** Como a identificação aparece na tela: ABC-1234, ABC1D23 (Mercosul não leva hífen), PT-ABC. */
export function formatarIdentificacao(tipo: string, texto: string) {
  const id = normalizarIdentificacao(texto);
  if (ehAeronave(tipo)) return id.length > 2 ? `${id.slice(0, 2)}-${id.slice(2)}` : id;
  return /^[A-Z]{3}[0-9]{4}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3)}` : id;
}

export function mensagemIdentificacao(tipo: string) {
  return ehAeronave(tipo)
    ? "Informe o prefixo da aeronave (ex.: PT-ABC)."
    : "Informe a placa (ex.: ABC-1234 ou ABC1D23).";
}

export type PrecoPorTipo = { tipo: string | null; preco: number };

/**
 * Preço que vale para o veículo: o do tipo dele, senão o geral (sem tipo), senão o preço de balcão do serviço.
 * Mesma regra de _lr_preco no banco.
 */
export function precoDoServico(tipo: string, precos: PrecoPorTipo[], precoBalcao: number) {
  const doTipo = precos.find((p) => p.tipo === tipo);
  if (doTipo) return doTipo.preco;
  const geral = precos.find((p) => p.tipo === null);
  return geral ? geral.preco : precoBalcao;
}

export const SITUACOES = [
  { value: "aguardando", label: "Aguardando" },
  { value: "lavando", label: "Lavando" },
  { value: "secando", label: "Secando" },
  { value: "pronto", label: "Pronto" },
] as const;
export type SituacaoOrdem =
  "aguardando" | "lavando" | "secando" | "pronto" | "entregue" | "cancelada";

export const rotuloSituacao = (s: string) =>
  s === "entregue"
    ? "Entregue"
    : s === "cancelada"
      ? "Cancelada"
      : (SITUACOES.find((x) => x.value === s)?.label ?? s);

const MUDANCAS: Record<SituacaoOrdem, SituacaoOrdem[]> = {
  aguardando: ["lavando", "cancelada"],
  lavando: ["aguardando", "secando", "pronto", "cancelada"],
  secando: ["lavando", "pronto", "cancelada"],
  pronto: ["secando", "cancelada"],
  // "entregue" só nasce da cobrança no caixa
  entregue: [],
  cancelada: [],
};

export function podeMudarPara(de: SituacaoOrdem, para: SituacaoOrdem) {
  return MUDANCAS[de].includes(para);
}

/** Passo seguinte do quadro (o botão principal do cartão). Depois de "pronto" vem a cobrança. */
export function proximaSituacao(s: SituacaoOrdem): SituacaoOrdem | null {
  if (s === "aguardando") return "lavando";
  if (s === "lavando") return "secando";
  if (s === "secando") return "pronto";
  return null;
}

/** A lavagem só começa com lavador escolhido. */
export function motivoDeNaoIniciar(lavadorId: string | null | undefined) {
  return lavadorId ? null : "Escolha o lavador antes de começar a lavagem.";
}

/** Ordem ainda ocupa o veículo no pátio (o banco recusa uma segunda ordem aberta para o mesmo veículo). */
export const ordemAberta = (s: SituacaoOrdem) =>
  s === "aguardando" || s === "lavando" || s === "secando" || s === "pronto";

/** Parte do serviço na venda, com o desconto repartido por igual entre todos os itens (mesma conta de lr_ordem_retirar). */
export function liquidoDoServico(bruto: number, subtotalVenda: number, totalVenda: number) {
  return subtotalVenda > 0 ? Math.round(((bruto * totalVenda) / subtotalVenda) * 100) / 100 : bruto;
}

export function comissaoDoLavador(liquido: number, percentual: number) {
  return Math.round(((liquido * percentual) / 100) * 100) / 100;
}

/** Tempo no pátio, em minutos, desde a entrada (ou até a hora em que ficou pronto). */
export function minutosNoPatio(entradaEm: string, ate: Date | string = new Date()) {
  const fim = typeof ate === "string" ? new Date(ate) : ate;
  return Math.max(0, Math.round((fim.getTime() - new Date(entradaEm).getTime()) / 60000));
}

export function textoTempo(minutos: number) {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
