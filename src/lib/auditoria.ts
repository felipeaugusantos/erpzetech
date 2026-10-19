// Tela da auditoria: nomes em português, valores legíveis e o antes e depois de cada registro.
import { brl, dateBR, dateTimeBR, num } from "./format.ts";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export const OPERACOES: Record<string, string> = {
  insert: "Inclusão",
  update: "Alteração",
  delete: "Exclusão",
};

export const ENTIDADES: Record<string, string> = {
  contas_receber: "Conta a receber",
  contas_pagar: "Conta a pagar",
  comissoes: "Comissão",
  nfe: "Nota fiscal",
  nfe_itens: "Item da nota fiscal",
  empresas: "Empresa",
  filiais: "Filial",
  fiscal_config: "Configuração fiscal",
  user_roles: "Perfil de acesso",
  produtos: "Produto",
  estoques: "Estoque",
  pedidos: "Pedido",
  pedido_itens: "Item do pedido",
  orcamentos: "Orçamento",
  orcamento_itens: "Item do orçamento",
  cardapio_itens: "Item do cardápio",
};

const CAMPOS: Record<string, string> = {
  valor: "Valor",
  vencimento: "Vencimento",
  valor_recebido: "Valor recebido",
  valor_pago: "Valor pago",
  situacao: "Situação",
  forma_pagamento: "Forma de pagamento",
  motivo_cancelamento: "Motivo do cancelamento",
  cliente_id: "Cliente",
  pedido_id: "Pedido",
  fornecedor_id: "Fornecedor",
  compra_id: "Compra",
  vendedor_id: "Vendedor",
  percentual: "Percentual",
  pago_em: "Pago em",
  numero: "Número",
  serie: "Série",
  chave: "Chave",
  protocolo: "Protocolo",
  ambiente: "Ambiente",
  cfop: "CFOP",
  natureza_operacao: "Natureza da operação",
  valor_produtos: "Valor dos produtos",
  valor_desconto: "Desconto",
  valor_frete: "Frete",
  valor_total: "Valor total",
  valor_icms: "ICMS",
  valor_icms_st: "ICMS ST",
  valor_pis: "PIS",
  valor_cofins: "COFINS",
  valor_iss: "ISS",
  cancelada_em: "Cancelada em",
  produto_id: "Produto",
  ncm: "NCM",
  cst_csosn: "CST/CSOSN",
  quantidade: "Quantidade",
  preco_unitario: "Preço unitário",
  desconto: "Desconto",
  frete: "Frete",
  total: "Total",
  aliquota_icms: "Alíquota de ICMS",
  aliquota_pis: "Alíquota de PIS",
  aliquota_cofins: "Alíquota de COFINS",
  aliquota_iss: "Alíquota de ISS",
  razao_social: "Razão social",
  nome_fantasia: "Nome fantasia",
  cnpj: "CNPJ",
  inscricao_estadual: "Inscrição estadual",
  inscricao_municipal: "Inscrição municipal",
  regime_tributario: "Regime tributário",
  cnae: "CNAE",
  codigo_municipio: "Código do município",
  ativo: "Ativo",
  pdv_desconto_limite: "Limite de desconto no PDV",
  nome: "Nome",
  codigo: "Código",
  empresa_id: "Empresa",
  filial_id: "Filial",
  emissor: "Emissor",
  conta_emissor: "Conta do emissor",
  certificado_nome: "Certificado",
  certificado_validade: "Validade do certificado",
  certificado_tipo: "Tipo de certificado",
  certificado_titular: "Titular do certificado",
  certificado_observacoes: "Observações do certificado",
  cfop_padrao: "CFOP padrão",
  aliquota_icms_interna: "ICMS interno",
  aliquota_icms_interestadual: "ICMS interestadual",
  mva_st: "MVA da substituição tributária",
  cst_pis: "CST do PIS",
  cst_cofins: "CST do COFINS",
  reducao_base_icms: "Redução da base do ICMS",
  serie_nfse: "Série da NFS-e",
  nfse_prefeitura: "Prefeitura",
  nfse_padrao: "Padrão da NFS-e",
  nfse_url: "Endereço da prefeitura",
  nfse_usuario: "Usuário da prefeitura",
  nfse_token: "Token da prefeitura",
  nfse_codigo_tributacao: "Código de tributação",
  nfse_regime_especial: "Regime especial",
  nfse_incentivador_cultural: "Incentivador cultural",
  nfse_optante_simples: "Optante do Simples",
  nfse_iss_retido: "ISS retido",
  nfse_observacoes: "Observações da NFS-e",
  nfse_codigo_municipio: "Município da NFS-e",
  codigo_servico: "Código de serviço",
  item_lista_servico: "Item da lista de serviço",
  responsavel_tecnico_cnpj: "CNPJ do responsável técnico",
  responsavel_tecnico_contato: "Contato do responsável técnico",
  responsavel_tecnico_email: "E-mail do responsável técnico",
  responsavel_tecnico_fone: "Telefone do responsável técnico",
  informacoes_complementares: "Informações complementares",
  user_id: "Usuário",
  role: "Perfil",
  preco: "Preço",
  preco_venda: "Preço de venda",
  custo: "Custo",
  custo_medio: "Custo médio",
};

const MOEDA = new Set([
  "valor",
  "valor_recebido",
  "valor_pago",
  "valor_produtos",
  "valor_desconto",
  "valor_frete",
  "valor_total",
  "valor_icms",
  "valor_icms_st",
  "valor_pis",
  "valor_cofins",
  "valor_iss",
  "desconto",
  "frete",
  "preco_unitario",
  "preco",
  "preco_venda",
  "custo",
  "custo_medio",
  "total",
]);

const PERCENTUAL = new Set([
  "percentual",
  "aliquota_icms",
  "aliquota_pis",
  "aliquota_cofins",
  "aliquota_iss",
  "aliquota_icms_interna",
  "aliquota_icms_interestadual",
  "mva_st",
  "reducao_base_icms",
  "pdv_desconto_limite",
]);

const DATA_HORA = new Set(["pago_em", "cancelada_em"]);

const PERFIS: Record<string, string> = {
  administrador: "Administrador",
  gestor: "Gestor",
  vendedor: "Vendedor",
  caixa: "Caixa",
  financeiro: "Financeiro",
  estoquista: "Estoquista",
  comprador: "Comprador",
  logistica: "Logística",
  motorista: "Motorista",
  garcom: "Garçom",
  cozinha: "Cozinha",
  profissional: "Profissional (pet shop)",
  veterinario: "Veterinário",
};

const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export const rotuloEntidade = (e: string) => ENTIDADES[e] ?? e;
export const rotuloOperacao = (o: string) => OPERACOES[o] ?? o;
export const rotuloCampo = (c: string) => CAMPOS[c] ?? c.replace(/_/g, " ");

/** Valor de um campo como aparece na tela. `***` é um segredo: mostra só que foi alterado. */
export function formatarValor(campo: string, valor: Json | undefined): string {
  if (valor === undefined || valor === null || valor === "") return "—";
  if (valor === "***") return "•••• (valor protegido)";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number" || (typeof valor === "string" && /^-?\d+(\.\d+)?$/.test(valor))) {
    const n = Number(valor);
    if (MOEDA.has(campo)) return brl(n);
    if (PERCENTUAL.has(campo)) return `${num(n, 4)}%`;
    if (typeof valor === "number") return num(n, 4);
  }
  if (typeof valor === "string") {
    if (campo === "role") return PERFIS[valor] ?? valor;
    if (DATA_HORA.has(campo) || ISO_INSTANTE.test(valor)) return dateTimeBR(valor);
    if (ISO_DIA.test(valor)) return dateBR(valor);
    return valor;
  }
  return JSON.stringify(valor);
}

export type Alteracao = { campo: string; rotulo: string; antes: string; depois: string };

/** Cada campo registrado, com o valor de antes e o de depois (inclusão não tem antes; exclusão, depois). */
export function alteracoes(
  anterior: Record<string, Json> | null,
  novo: Record<string, Json> | null,
): Alteracao[] {
  const campos = [...new Set([...Object.keys(anterior ?? {}), ...Object.keys(novo ?? {})])];
  return campos.map((campo) => ({
    campo,
    rotulo: rotuloCampo(campo),
    antes: formatarValor(campo, anterior?.[campo]),
    depois: formatarValor(campo, novo?.[campo]),
  }));
}

/** Limite de data da busca: o início e o fim do dia no fuso de Brasília (UTC−3, sem horário de verão). */
export function inicioDoDia(dia: string): string {
  return `${dia}T00:00:00-03:00`;
}
export function fimDoDia(dia: string): string {
  return `${dia}T23:59:59.999-03:00`;
}
