import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type ErroLegado = {
  id: string;
  mensagem: string;
  origem: string;
  situacao: string;
  rota: string | null;
  cliente: string | null;
  ocorrencias: number;
  primeira_vez: string;
  ultima_vez: string;
  navegador: string | null;
  stack: string | null;
};

export type MonitoramentoResumo = {
  erros_abertos: number;
  erros_novos: number;
  erros_reincidentes: number;
  clientes_com_erro: number;
  clientes_ativos: number;
  clientes_sem_uso: number;
  usuarios_ativos: number;
  acoes: number;
};

export type MonitoramentoDia = {
  dia: string;
  erros_novos: number;
  usuarios_ativos: number;
  acoes: number;
};

export type MonitoramentoUsoCliente = {
  cliente: string;
  tenant_id: string;
  usuarios_ativos: number;
  acoes: number;
  ultima_atividade: string | null;
  ultimo_login: string | null;
  erros_abertos: number;
  erros_periodo: number;
};

export type MonitoramentoTopErro = {
  id: string;
  mensagem: string;
  rota: string | null;
  origem: string;
  cliente: string | null;
  ocorrencias: number;
  ultima_vez: string;
};

// Historical installations can still expose this schema; missing tables remain errors, not invented data.
type Assinatura = {
  id: string;
  tenant_id: string;
  plano: string;
  valor_mensal: number;
  filiais_extras: number;
  valor_filial_extra: number;
  valor_implantacao: number;
  implantacao_paga: boolean;
  situacao: string;
  teste_ate: string | null;
  dia_vencimento: number;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
};
type Fatura = {
  id: string;
  tenant_id: string;
  assinatura_id: string;
  tipo: string;
  descricao: string;
  competencia: string | null;
  valor: number;
  vencimento: string;
  valor_pago: number;
  pago_em: string | null;
  forma_pagamento: string | null;
  created_at: string;
  updated_at: string;
};
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type LegacyDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      assinaturas: Table<Assinatura>;
      assinatura_faturas: Table<Fatura>;
    };
    Functions: Database["public"]["Functions"] & {
      assinatura_resumo: { Args: Record<string, never>; Returns: Json };
      saas_erros_listar: {
        Args: { p_situacao: string; p_limite: number };
        Returns: ErroLegado[];
      };
      saas_erro_situacao: {
        Args: { p_id: string; p_situacao: string };
        Returns: undefined;
      };
      saas_monitoramento_resumo: {
        Args: { p_de: string; p_ate: string };
        Returns: MonitoramentoResumo[];
      };
      saas_monitoramento_dia: {
        Args: { p_de: string; p_ate: string };
        Returns: MonitoramentoDia[];
      };
      saas_monitoramento_uso_cliente: {
        Args: { p_de: string; p_ate: string };
        Returns: MonitoramentoUsoCliente[];
      };
      saas_monitoramento_top_erros: {
        Args: { p_de: string; p_ate: string; p_limite: number };
        Returns: MonitoramentoTopErro[];
      };
      erros_app_limpar: { Args: Record<string, never>; Returns: number };
      gerar_faturas_assinatura: { Args: Record<string, never>; Returns: number };
      assinatura_taxa_inicial: {
        Args: Record<string, never>;
        Returns: { rotulo: string; valor: number }[];
      };
    };
  };
};
export function clienteLegado(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<LegacyDatabase>;
}
export const assinaturaLegada = clienteLegado(supabase);
