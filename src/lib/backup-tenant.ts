// Backup por cliente (tenant): catálogo e regras puras, sem rede nem banco.
// O isolamento do sistema é por tenant_id; este catálogo diz o que entra no pacote de UM cliente e o que nunca entra.
// tests/backup-tenant.test.ts confere o catálogo contra src/integrations/supabase/types.ts: tabela nova com tenant_id
// precisa entrar aqui (ou em TABELAS_FORA_DO_BACKUP, com o motivo), senão o teste falha.
import { z } from "zod";

export const VERSAO_BACKUP = 1;
export const TAMANHO_PAGINA_BACKUP = 1000;

export const lerPaginaBackup = z.object({
  tenantId: z.guid("Cliente inválido."),
  tabela: z.string().min(1).max(80),
  cursor: z.string().max(200).nullable(),
});

export const listarBackupCliente = z.object({ tenantId: z.guid("Cliente inválido.") });

/** como a tabela se liga ao cliente: tenant_id (padrão), o próprio id do tenant, ou empresa_id (via empresas do tenant) */
export type EscopoBackup = "tenant" | "tenants" | "empresa";

/** tabelas do cliente que entram no backup (além de `tenants` e `empresa_modulos_liberados`, tratadas à parte) */
const TABELAS_COM_TENANT = [
  "auditoria",
  "banco_extrato_linhas",
  "banco_movimentos",
  "bulario_notas",
  "caixa_movimentos",
  "caixas",
  "cardapio_cardapio_itens",
  "cardapio_categorias",
  "cardapio_ficha",
  "cardapio_grupos",
  "cardapio_itens",
  "cardapio_opcoes",
  "cardapios",
  "categorias",
  "clientes",
  "clinica_acessos",
  "clinica_cadastros_rapidos",
  "clinica_fila",
  "clinica_operacoes_offline",
  "cobranca_config",
  "cobrancas",
  "comanda_itens",
  "comanda_pagamentos",
  "comandas",
  "comissoes",
  "compra_cotacao_itens",
  "compra_cotacoes",
  "compra_ctes",
  "compra_devolucao_itens",
  "compra_devolucoes",
  "compra_itens",
  "compra_recebimento_itens",
  "compra_recebimentos",
  "compras",
  "contas_bancarias",
  "contas_pagar",
  "contas_receber",
  "credito_autorizacoes",
  "dashboard_personalizado",
  "depositos",
  "devolucao_itens",
  "devolucoes",
  "empresa_links",
  "empresas",
  "entrega_itens",
  "entrega_reagendamentos",
  "entrega_tentativas",
  "entregas",
  "estoque_grade",
  "estoque_grade_movimentos",
  "estoque_lote_movimentos",
  "estoque_lotes",
  "estoque_movimentacoes",
  "estoques",
  "faixas_desconto",
  "filiais",
  "financeiro_baixas",
  "fiscal_config",
  "fornecedores",
  "gestor_autorizacoes",
  "granel_aberturas",
  "hs_config",
  "hs_diarias",
  "hs_folio_notas",
  "hs_folios",
  "hs_hospedes",
  "hs_lancamentos",
  "hs_ocupacoes",
  "hs_pagamentos",
  "hs_reserva_hospedes",
  "hs_reserva_uhs",
  "hs_reservas",
  "hs_tarifas",
  "hs_tipos_uh",
  "hs_uhs",
  "icms_uf_destino",
  "importacoes",
  "inventario_itens",
  "inventarios",
  "link_acesso_usuarios",
  "locacao_equipamentos",
  "locacao_itens",
  "locacao_manutencoes",
  "locacao_planos_manutencao",
  "locacao_vistoria_avarias",
  "locacao_vistorias",
  "locacoes",
  "lr_agenda_config",
  "lr_agenda_ocupacoes",
  "lr_agendamento_itens",
  "lr_agendamentos",
  "lr_assinatura_usos",
  "lr_assinaturas",
  "lr_avarias",
  "lr_comissoes",
  "lr_config",
  "lr_contatos",
  "lr_fidelidade_config",
  "lr_fotos",
  "lr_insumo_baixas",
  "lr_insumo_config",
  "lr_lavadores",
  "lr_mensagem_modelos",
  "lr_ordem_itens",
  "lr_ordens",
  "lr_planos",
  "lr_servico_insumos",
  "lr_servico_precos",
  "lr_servicos",
  "lr_veiculos",
  "menu_personalizado",
  "mesa_reservas",
  "mesas",
  "mf_apontamentos",
  "mf_bom_itens",
  "mf_boms",
  "mf_entregas",
  "mf_etapas",
  "mf_ordem_etapas",
  "mf_ordem_insumos",
  "mf_ordens",
  "modelo_negocio",
  "motoristas",
  "nfce_config",
  "nfe",
  "nfe_contingencia",
  "nfe_entrada_produtos",
  "nfe_eventos",
  "nfe_itens",
  "nfe_pedidos",
  "obras",
  "orcamento_itens",
  "orcamentos",
  "os_itens",
  "os_ordens",
  "pedido_historico",
  "pedido_itens",
  "pedido_ocorrencias",
  "pedido_orcamentos",
  "pedido_personalizacao",
  "pedidos",
  "pet_agendamento_itens",
  "pet_agendamentos",
  "pet_atendimento_adendos",
  "pet_atendimentos_clinicos",
  "pet_boxes",
  "pet_campos",
  "pet_campos_valores",
  "pet_comissoes",
  "pet_contatos",
  "pet_documento_modelos",
  "pet_documentos",
  "pet_exame_adendos",
  "pet_exame_anexos",
  "pet_exame_campos",
  "pet_exame_modelos",
  "pet_exame_referencias",
  "pet_exame_resultados",
  "pet_exames",
  "pet_internacao_cobrancas",
  "pet_internacao_execucoes",
  "pet_internacao_itens",
  "pet_internacao_ocorrencias",
  "pet_internacao_pendencia_baixas",
  "pet_internacao_pendencias",
  "pet_internacao_prescricoes",
  "pet_internacao_relatos",
  "pet_internacao_sinais",
  "pet_internacao_turno_ciencias",
  "pet_internacao_turnos",
  "pet_internacoes",
  "pet_mensagem_modelos",
  "pet_pacote_modelos",
  "pet_pacote_usos",
  "pet_pacotes",
  "pet_pesagens",
  "pet_profissionais",
  "pet_receita_modelos",
  "pet_servico_precos",
  "pet_servicos",
  "pet_sinais_parametros",
  "pet_vacinacoes",
  "pet_vacinas_catalogo",
  "pets",
  "portal_acessos",
  "portal_liberacoes",
  "portal_vinculos",
  "premiacao_abatimentos",
  "premiacoes",
  "produto_conversoes",
  "produto_variacoes",
  "produtos",
  "profiles",
  "profissionais",
  "restaurante_chamados",
  "restaurante_chamados_motivos",
  "restaurante_config",
  "restaurante_pedidos_externos",
  "restaurante_pracas",
  "restaurante_senhas_contador",
  "restaurante_taras",
  "restaurante_zonas_entrega",
  "role_permissoes",
  "sngpc_documentos",
  "sngpc_envios",
  "sngpc_itens",
  "sngpc_medicamentos",
  "tabela_preco_itens",
  "tabelas_preco",
  "tecnicos",
  "tef_config",
  "tef_transacoes",
  "transferencia_itens",
  "transferencias",
  "tributos_aprox_ncm",
  "user_roles",
  "veiculos",
  "vendedor_comissao_regras",
  "wa_config",
  "wa_mensagens",
  "wa_saidas",
] as const;

export const TABELA_TENANTS = "tenants";
export const TABELA_MODULOS_LIBERADOS = "empresa_modulos_liberados";

export const TABELAS_BACKUP: readonly string[] = [
  TABELA_TENANTS,
  ...TABELAS_COM_TENANT,
  TABELA_MODULOS_LIBERADOS,
];

/** tabelas com tenant_id que ficam de FORA do backup do cliente, e por quê */
export const TABELAS_FORA_DO_BACKUP: Record<string, string> = {
  portal_convites: "guarda só o hash do código de convite do tutor; não deve sair do banco",
  saas_clientes:
    "cadastro comercial do cliente na Ze Tech (cobrança, plano), não é dado do cliente",
  assinaturas: "cobrança do cliente pela Ze Tech, não é dado do cliente",
  assinatura_faturas: "cobrança do cliente pela Ze Tech, não é dado do cliente",
  backup_execucoes: "controle interno da rotina de backup, não é dado do cliente",
  backup_drive_config: "credencial cifrada e autorização do Drive: nunca exportar",
  backup_drive_execucoes: "controle interno das cópias no Drive, não é dado restaurável",
  webhook_eventos:
    "corpo bruto de avisos de provedores externos; pode trazer segredos e é reenviável",
};

/** colunas que nunca saem no backup (segredos e chaves de integração) */
export const COLUNAS_FORA_DO_BACKUP: Record<string, readonly string[]> = {
  cobranca_config: ["api_key", "webhook_token_hash"],
  fiscal_config: ["nfse_token"],
  nfce_config: ["csc_token"],
};

/** ordem estável de leitura; sem ela a paginação pularia ou repetiria linhas. Padrão: ["id"] */
export const ORDEM_BACKUP: Record<string, readonly string[]> = {
  tenants: ["id"],
  cardapio_cardapio_itens: ["cardapio_id", "item_id"],
  clinica_cadastros_rapidos: ["chave"],
  clinica_operacoes_offline: ["chave"],
  cobranca_config: ["tenant_id"],
  dashboard_personalizado: ["painel"],
  empresa_modulos_liberados: ["empresa_id", "modulo"],
  link_acesso_usuarios: ["link_id", "user_id"],
  lr_agenda_config: ["tenant_id"],
  lr_config: ["tenant_id"],
  lr_fidelidade_config: ["tenant_id"],
  lr_insumo_config: ["tenant_id"],
  lr_mensagem_modelos: ["tipo"],
  menu_personalizado: ["tenant_id"],
  pet_campos_valores: ["campo_id", "registro_id"],
  pet_mensagem_modelos: ["tipo"],
  restaurante_config: ["tenant_id"],
  restaurante_senhas_contador: ["data", "filial_chave"],
  wa_config: ["tenant_id"],
  wa_saidas: ["chave"],
};

export function escopoDaTabela(tabela: string): EscopoBackup {
  if (tabela === TABELA_TENANTS) return "tenants";
  if (tabela === TABELA_MODULOS_LIBERADOS) return "empresa";
  return "tenant";
}

export function ordemDaTabela(tabela: string): readonly string[] {
  return ORDEM_BACKUP[tabela] ?? ["id"];
}

/** só tabelas com chave "id" leem por cursor (id maior que o último); as demais, por posição */
export function leCursorPorId(tabela: string): boolean {
  const o = ordemDaTabela(tabela);
  return o.length === 1 && o[0] === "id";
}

export type GrupoBackup =
  | "base"
  | "fiscal"
  | "clinica"
  | "portal"
  | "lava_rapido"
  | "hotelaria"
  | "restaurante"
  | "locacao"
  | "manufatura"
  | "whatsapp";

export const ROTULO_GRUPO: Record<GrupoBackup, string> = {
  base: "Cadastro, vendas, estoque e financeiro",
  fiscal: "Fiscal",
  clinica: "Clínica e pet shop",
  portal: "Portal do tutor",
  lava_rapido: "Lava rápido",
  hotelaria: "Hotelaria",
  restaurante: "Restaurante e delivery",
  locacao: "Locação",
  manufatura: "Manufatura",
  whatsapp: "WhatsApp",
};

/** o grupo vem do prefixo da tabela: dá para escolher o que baixar e ver o que cada segmento usa */
export function grupoDaTabela(tabela: string): GrupoBackup {
  if (/^(pet_|pets$|clinica_|sngpc_|bulario_)/.test(tabela)) return "clinica";
  if (tabela.startsWith("portal_")) return "portal";
  if (tabela.startsWith("lr_")) return "lava_rapido";
  if (tabela.startsWith("hs_")) return "hotelaria";
  if (/^(cardapio|comanda|mesa|mesas|restaurante_|entrega|entregas)/.test(tabela))
    return "restaurante";
  if (/^(locacao_|locacoes|obras)/.test(tabela)) return "locacao";
  if (tabela.startsWith("mf_")) return "manufatura";
  if (tabela.startsWith("wa_")) return "whatsapp";
  if (/^(nfe|nfce_|fiscal_|compra_ctes|nfe_)/.test(tabela)) return "fiscal";
  return "base";
}

/** colunas a pedir de cada tabela: tudo, menos o que está em COLUNAS_FORA_DO_BACKUP */
export function colunasDaTabela(tabela: string, todas: readonly string[]): string[] {
  const fora = new Set(COLUNAS_FORA_DO_BACKUP[tabela] ?? []);
  return todas.filter((c) => !fora.has(c));
}

export function tabelaDoBackup(tabela: string): boolean {
  return TABELAS_BACKUP.includes(tabela);
}

export type TabelaContada = { tabela: string; grupo: GrupoBackup; linhas: number };

export type ManifestoBackup = {
  formato: "ezra-backup-cliente";
  versao: number;
  cliente: { tenantId: string; nome: string };
  gerado_em: string;
  gerado_por: string;
  tabelas: { tabela: string; linhas: number }[];
  total_linhas: number;
  avisos: string[];
};

export const AVISOS_BACKUP: readonly string[] = [
  "Contas de acesso (e-mail, usuário e senha) ficam no serviço de autenticação e não entram neste pacote.",
  "Chaves e tokens de integrações (cobrança, NFS-e, NFC-e) e convites do portal do tutor não entram.",
  "Arquivos (fotos, anexos, XML) ficam no armazenamento e não entram; só os caminhos aparecem nas tabelas.",
  "Operações guardadas no navegador do cliente e ainda não sincronizadas não estão no banco, portanto não estão aqui.",
];

export function montarManifesto(p: {
  tenantId: string;
  nome: string;
  geradoEm: Date;
  geradoPor: string;
  tabelas: { tabela: string; linhas: number }[];
}): ManifestoBackup {
  return {
    formato: "ezra-backup-cliente",
    versao: VERSAO_BACKUP,
    cliente: { tenantId: p.tenantId, nome: p.nome },
    gerado_em: p.geradoEm.toISOString(),
    gerado_por: p.geradoPor,
    tabelas: p.tabelas,
    total_linhas: p.tabelas.reduce((s, t) => s + t.linhas, 0),
    avisos: [...AVISOS_BACKUP],
  };
}

/** uma linha do arquivo NDJSON: o manifesto abre o arquivo e cada registro leva o nome da tabela */
export function linhaManifesto(m: ManifestoBackup): string {
  return JSON.stringify({ manifesto: m }) + "\n";
}

/** última linha do arquivo da rotina: o manifesto do início traz as contagens prévias, esta traz as reais */
export function linhaFim(tabelas: { tabela: string; linhas: number }[]): string {
  return (
    JSON.stringify({
      fim: { tabelas, total_linhas: tabelas.reduce((s, t) => s + t.linhas, 0) },
    }) + "\n"
  );
}

export function linhasDaTabela(tabela: string, registros: readonly unknown[]): string {
  return registros.map((r) => JSON.stringify({ t: tabela, d: r }) + "\n").join("");
}

/** nome do arquivo: sem acento nem símbolo, com a data */
export function nomeArquivoBackup(nomeCliente: string, data: Date): string {
  const slug =
    nomeCliente
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cliente";
  return `backup-${slug}-${data.toISOString().slice(0, 10)}.ndjson.gz`;
}

export type ValorJson = string | number | boolean | null | ValorJson[] | { [k: string]: ValorJson };
export type RegistroBackup = Record<string, ValorJson>;

export type PaginaBackup = { registros: RegistroBackup[]; proximo: string | null };

export type ProgressoBackup = { tabela: string; linhasTabela: number; linhasTotal: number };

/**
 * Lê as tabelas escolhidas, página por página, e monta as linhas do arquivo (sem o manifesto, que usa as contagens reais).
 * `lerPagina` é a chamada ao servidor; aqui só há o laço, para poder ser testado sem rede.
 */
export async function coletarBackup(p: {
  tabelas: readonly string[];
  lerPagina: (tabela: string, cursor: string | null) => Promise<PaginaBackup>;
  aoProgredir?: (x: ProgressoBackup) => void;
  cancelado?: () => boolean;
}): Promise<{ partes: string[]; tabelas: { tabela: string; linhas: number }[] }> {
  const partes: string[] = [];
  const tabelas: { tabela: string; linhas: number }[] = [];
  let total = 0;
  for (const tabela of p.tabelas) {
    if (!tabelaDoBackup(tabela)) throw new Error(`Tabela fora do catálogo do backup: ${tabela}`);
    let cursor: string | null = null;
    let linhas = 0;
    for (;;) {
      if (p.cancelado?.()) throw new Error("Backup cancelado.");
      const pagina: PaginaBackup = await p.lerPagina(tabela, cursor);
      if (pagina.registros.length > 0) {
        partes.push(linhasDaTabela(tabela, pagina.registros));
        linhas += pagina.registros.length;
        total += pagina.registros.length;
        p.aoProgredir?.({ tabela, linhasTabela: linhas, linhasTotal: total });
      }
      if (pagina.proximo === null) break;
      if (pagina.proximo === cursor) throw new Error(`Leitura de ${tabela} não avançou.`);
      cursor = pagina.proximo;
    }
    if (linhas > 0) tabelas.push({ tabela, linhas });
  }
  return { partes, tabelas };
}
