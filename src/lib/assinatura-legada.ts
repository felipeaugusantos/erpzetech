import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
      gerar_faturas_assinatura: { Args: Record<string, never>; Returns: number };
      assinatura_taxa_inicial: {
        Args: Record<string, never>;
        Returns: { rotulo: string; valor: number }[];
      };
    };
  };
};
export const assinaturaLegada = supabase as unknown as SupabaseClient<LegacyDatabase>;
