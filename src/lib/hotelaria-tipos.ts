// Formatos das tabelas e das respostas das funções da Hotelaria (supabase/migrations/20261209 a 20261213).
// Escritos à mão: o arquivo de tipos gerado do Supabase só os conhece depois que as migrations são aplicadas e ele é gerado de novo.

export type SituacaoLimpeza = "limpo" | "sujo" | "inspecionado";
export type SituacaoReserva =
  "pendente" | "confirmada" | "hospedada" | "finalizada" | "cancelada" | "no_show";
export type SituacaoQuarto = "reservada" | "hospedada" | "finalizada" | "cancelada" | "no_show";

export type Hotel = { id: string; nome: string };

export type HsConfig = {
  id: string;
  filial_id: string;
  checkin_hora: string;
  checkout_hora: string;
  taxa_turismo_por_hospede_noite: number;
  cobra_diaria_no_checkout_tardio: boolean;
  exige_documento_checkin: boolean;
  fuso: string;
};

export type HsTipoUh = {
  id: string;
  filial_id: string;
  nome: string;
  descricao: string | null;
  capacidade_adultos: number;
  capacidade_criancas: number;
  comodidades: string[];
  ativo: boolean;
};

export type HsUh = {
  id: string;
  filial_id: string;
  tipo_id: string;
  numero: string;
  andar: string | null;
  situacao_limpeza: SituacaoLimpeza;
  interditada: boolean;
  motivo_interdicao: string | null;
  ativo: boolean;
};

export type HsTarifaLinha = {
  id: string;
  tipo_id: string;
  nome: string;
  vigencia_de: string;
  vigencia_ate: string;
  dias_semana: number[];
  valor_diaria: number;
  valor_adulto_extra: number;
  valor_crianca: number;
  minimo_noites: number;
  pessoas_incluidas: number;
  prioridade: number;
  ativo: boolean;
};

export type HsHospede = {
  id: string;
  nome: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  nacionalidade: string;
  data_nascimento: string | null;
  sexo: string | null;
  profissao: string | null;
  telefone: string | null;
  email: string | null;
  cidade_residencia: string | null;
  estado_residencia: string | null;
  pais_residencia: string;
  procedencia: string | null;
  destino: string | null;
  motivo_viagem: string | null;
  meio_transporte: string | null;
  observacoes: string | null;
  cliente_id: string | null;
  ativo: boolean;
};

export type HsReserva = {
  id: string;
  filial_id: string;
  numero: number;
  titular_id: string;
  pagador_cliente_id: string | null;
  origem: string;
  situacao: SituacaoReserva;
  observacoes: string | null;
  motivo_cancelamento: string | null;
  cancelada_em: string | null;
  created_at: string;
};

export type HsReservaUh = {
  id: string;
  reserva_id: string;
  filial_id: string;
  tipo_id: string;
  uh_id: string | null;
  entrada: string;
  saida: string;
  adultos: number;
  criancas: number;
  situacao: SituacaoQuarto;
  checkin_em: string | null;
  checkout_em: string | null;
  valor_acordado_total: number | null;
};

export type HsBloqueio = {
  id: string;
  uh_id: string;
  periodo: string;
  motivo: string | null;
};

export type HsCaixa = { id: string; filial_id: string | null; situacao: string };

// ===== respostas das funções =====
export type QuartoDoPainel = {
  reserva_uh_id: string;
  reserva_id: string;
  reserva_numero: number;
  situacao: string;
  titular: string;
  uh: string | null;
  tipo: string;
  entrada?: string;
  saida?: string;
  adultos?: number;
  criancas?: number;
  pendente?: boolean;
  hospedes?: number;
  saldo?: number;
};

export type PainelDia = {
  filial_id: string;
  data: string;
  hoje: string;
  chegadas: QuartoDoPainel[];
  saidas: QuartoDoPainel[];
  chegadas_atrasadas: QuartoDoPainel[];
  saidas_atrasadas: QuartoDoPainel[];
  hospedados: QuartoDoPainel[];
  ocupacao: {
    acomodacoes: number;
    bloqueadas: number;
    vendaveis: number;
    ocupadas: number;
    livres: number;
    percentual: number;
  };
  sujas: { uh_id: string; numero: string; tipo: string; ocupada: boolean }[];
  contas_em_aberto: { quantidade: number; total: number };
  totais: { chegadas: number; saidas: number; hospedados: number; sujas: number };
};

export type OcupacaoDoMapaDados = {
  id: string;
  origem: "reserva" | "bloqueio";
  de: string;
  ate: string;
  motivo: string | null;
  reserva_uh_id: string | null;
  reserva_id: string | null;
  reserva_numero: number | null;
  situacao: SituacaoQuarto | null;
  reserva_situacao: SituacaoReserva | null;
  titular: string | null;
  adultos: number | null;
  criancas: number | null;
};

export type MapaDados = {
  filial_id: string;
  de: string;
  ate: string;
  dias: string[];
  uhs: {
    uh_id: string;
    numero: string;
    andar: string | null;
    tipo_id: string;
    tipo: string;
    situacao_limpeza: SituacaoLimpeza;
    interditada: boolean;
    motivo_interdicao: string | null;
    ocupacoes: OcupacaoDoMapaDados[];
  }[];
  totais_por_dia: {
    data: string;
    total: number;
    ocupadas: number;
    bloqueadas: number;
    livres: number;
  }[];
  sem_acomodacao: {
    reserva_uh_id: string;
    reserva_id: string;
    reserva_numero: number;
    tipo_id: string;
    tipo: string;
    entrada: string;
    saida: string;
    adultos: number;
    criancas: number;
    titular: string;
  }[];
};

export type Disponibilidade = {
  tipo_id: string;
  nome: string;
  total: number;
  bloqueadas: number;
  ocupadas: number;
  sem_acomodacao: number;
  disponiveis: number;
  preco_total: number | null;
  motivo_sem_preco: string | null;
}[];

export type UhLivre = {
  id: string;
  numero: string;
  andar: string | null;
  tipo_id: string;
  tipo: string;
  situacao_limpeza: SituacaoLimpeza;
};

export type CotacaoResposta = {
  quantidade: number;
  total: number;
  noites: { data: string; valor: number; tarifa_id: string | null }[];
};

export type LancamentoResumo = {
  id: string;
  data_competencia: string;
  tipo: "diaria" | "taxa_turismo" | "consumo" | "servico" | "ajuste";
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  total: number;
  reserva_uh_id: string | null;
  uh: string | null;
  estorna_id: string | null;
  motivo: string | null;
  estornado: boolean;
  criado_em: string;
};

export type PagamentoResumo = {
  id: string;
  tipo: "sinal" | "pagamento" | "devolucao";
  forma: string;
  valor: number;
  criado_em: string;
};

export type FolioResumo = {
  folio: {
    id: string;
    titulo: string;
    principal: boolean;
    situacao: "aberto" | "fechado";
    fechado_em: string | null;
  };
  reserva: { id: string; numero: number; situacao: SituacaoReserva; titular: string };
  lancamentos: LancamentoResumo[];
  pagamentos: PagamentoResumo[];
  nota: {
    nfe_id: string;
    numero: number | null;
    situacao: string;
    modelo: string;
    valor_total: number;
    pendencias: string[] | null;
  } | null;
  totais: { lancado: number; recebido: number; devolvido: number; saldo: number };
};

export type QuartoDaReserva = {
  reserva_uh_id: string;
  situacao: SituacaoQuarto;
  uh_id: string | null;
  uh: string | null;
  tipo_id: string;
  tipo: string;
  entrada: string;
  saida: string;
  noites: number;
  adultos: number;
  criancas: number;
  checkin_em: string | null;
  checkout_em: string | null;
  valor_acordado_total: number | null;
  diarias: { total: number; noites: number; lancadas: number };
  hospedes: {
    hospede_id: string;
    nome: string;
    principal: boolean;
    documento_tipo: string | null;
    documento_numero: string | null;
  }[];
};

export type ReservaResumo = {
  reserva: {
    id: string;
    numero: number;
    filial_id: string;
    situacao: SituacaoReserva;
    origem: string;
    observacoes: string | null;
    motivo_cancelamento: string | null;
    cancelada_em: string | null;
    pagador_cliente_id: string | null;
    criada_em: string;
  };
  titular: {
    id: string;
    nome: string;
    documento_tipo: string | null;
    documento_numero: string | null;
    telefone: string | null;
    email: string | null;
  };
  quartos: QuartoDaReserva[];
  contas: {
    id: string;
    titulo: string;
    principal: boolean;
    situacao: "aberto" | "fechado";
    saldo: number;
    nfe_id: string | null;
  }[];
  totais: { saldo: number; sinal_liquido: number; diarias: number };
};

export type FichaHospedagemDados = {
  reserva_uh_id: string;
  reserva_numero: number;
  folio_id: string;
  uh: string;
  entrada: string;
  saida: string;
  adultos: number;
  criancas: number;
  checkin_em: string | null;
  hospedes: {
    hospede_id: string;
    principal: boolean;
    nome: string;
    documento_tipo: string | null;
    documento_numero: string | null;
    nacionalidade: string;
    data_nascimento: string | null;
    sexo: string | null;
    profissao: string | null;
    telefone: string | null;
    email: string | null;
    cidade_residencia: string | null;
    estado_residencia: string | null;
    pais_residencia: string;
    procedencia: string | null;
    destino: string | null;
    motivo_viagem: string | null;
    meio_transporte: string | null;
  }[];
  repetido: boolean;
};

export type ResultadoCheckout = {
  reserva_uh_id: string;
  repetido: boolean;
  parcial: boolean;
  saida?: string;
  noites_cobradas?: number;
  recebido?: number;
  nfe_ids: string[];
};

export type ResultadoFecharDia = {
  data: string;
  quartos: number;
  total_lancado: number;
  chegadas_pendentes: {
    reserva_uh_id: string;
    reserva_numero: number;
    titular: string;
    uh: string | null;
  }[];
  saidas_atrasadas: {
    reserva_uh_id: string;
    reserva_numero: number;
    titular: string;
    uh: string | null;
    saida: string;
  }[];
};

export type PreviaCheckout = {
  reserva_uh_id: string;
  reserva_id: string;
  /** saída que passa a valer depois do check-out */
  saida: string;
  saida_prevista: string;
  noites_cobradas: number;
  /** diárias e taxa de turismo ainda por lançar */
  a_lancar: number;
  ultimo_quarto: boolean;
  contas: {
    folio_id: string | null;
    titulo: string;
    principal: boolean;
    saldo_atual: number;
    saldo_previsto: number;
  }[];
};
