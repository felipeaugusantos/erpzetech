export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      auditoria: {
        Row: {
          created_at: string
          entidade: string
          entidade_id: string | null
          id: string
          operacao: string
          tenant_id: string
          usuario_id: string | null
          valor_anterior: Json | null
          valor_novo: Json | null
        }
        Insert: {
          created_at?: string
          entidade: string
          entidade_id?: string | null
          id?: string
          operacao: string
          tenant_id: string
          usuario_id?: string | null
          valor_anterior?: Json | null
          valor_novo?: Json | null
        }
        Update: {
          created_at?: string
          entidade?: string
          entidade_id?: string | null
          id?: string
          operacao?: string
          tenant_id?: string
          usuario_id?: string | null
          valor_anterior?: Json | null
          valor_novo?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          parent_id: string | null
          tenant_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          parent_id?: string | null
          tenant_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          parent_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorias_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          complemento: string | null
          cpf: string | null
          created_at: string
          deleted_at: string | null
          desconto_maximo: number
          email: string | null
          empresa_id: string | null
          endereco: string | null
          estado: string | null
          filial_id: string | null
          id: string
          inscricao_estadual: string | null
          limite_credito: number
          nome: string
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          prazo_padrao_dias: number
          saldo_utilizado: number
          telefone: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          desconto_maximo?: number
          email?: string | null
          empresa_id?: string | null
          endereco?: string | null
          estado?: string | null
          filial_id?: string | null
          id?: string
          inscricao_estadual?: string | null
          limite_credito?: number
          nome: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          prazo_padrao_dias?: number
          saldo_utilizado?: number
          telefone?: string | null
          tenant_id: string
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          desconto_maximo?: number
          email?: string | null
          empresa_id?: string | null
          endereco?: string | null
          estado?: string | null
          filial_id?: string | null
          id?: string
          inscricao_estadual?: string | null
          limite_credito?: number
          nome?: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          prazo_padrao_dias?: number
          saldo_utilizado?: number
          telefone?: string | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      depositos: {
        Row: {
          ativo: boolean
          created_at: string
          endereco: string | null
          filial_id: string | null
          id: string
          nome: string
          permite_negativo: boolean
          tenant_id: string
          tipo: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          endereco?: string | null
          filial_id?: string | null
          id?: string
          nome: string
          permite_negativo?: boolean
          tenant_id: string
          tipo?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          endereco?: string | null
          filial_id?: string | null
          id?: string
          nome?: string
          permite_negativo?: boolean
          tenant_id?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depositos_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          complemento: string | null
          created_at: string
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          nome_fantasia: string | null
          numero: string | null
          razao_social: string
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          razao_social: string
          telefone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          razao_social?: string
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_movimentacoes: {
        Row: {
          created_at: string
          deposito_destino_id: string | null
          deposito_id: string
          documento: string | null
          id: string
          motivo: string | null
          produto_id: string
          quantidade: number
          saldo_anterior: number | null
          saldo_posterior: number | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["mov_tipo"]
          unidade: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          deposito_destino_id?: string | null
          deposito_id: string
          documento?: string | null
          id?: string
          motivo?: string | null
          produto_id: string
          quantidade: number
          saldo_anterior?: number | null
          saldo_posterior?: number | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["mov_tipo"]
          unidade?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          deposito_destino_id?: string | null
          deposito_id?: string
          documento?: string | null
          id?: string
          motivo?: string | null
          produto_id?: string
          quantidade?: number
          saldo_anterior?: number | null
          saldo_posterior?: number | null
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["mov_tipo"]
          unidade?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentacoes_deposito_destino_id_fkey"
            columns: ["deposito_destino_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estoques: {
        Row: {
          deposito_id: string
          id: string
          localizacao: string | null
          produto_id: string
          quantidade: number
          reservado: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          deposito_id: string
          id?: string
          localizacao?: string | null
          produto_id: string
          quantidade?: number
          reservado?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          deposito_id?: string
          id?: string
          localizacao?: string | null
          produto_id?: string
          quantidade?: number
          reservado?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoques_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoques_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoques_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      filiais: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          codigo: string | null
          created_at: string
          empresa_id: string
          endereco: string | null
          estado: string | null
          id: string
          nome: string
          numero: string | null
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          codigo?: string | null
          created_at?: string
          empresa_id: string
          endereco?: string | null
          estado?: string | null
          id?: string
          nome: string
          numero?: string | null
          telefone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          codigo?: string | null
          created_at?: string
          empresa_id?: string
          endereco?: string | null
          estado?: string | null
          id?: string
          nome?: string
          numero?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "filiais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filiais_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          condicao_pagamento: string | null
          contato: string | null
          created_at: string
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          nome_fantasia: string | null
          numero: string | null
          prazo_entrega_dias: number | null
          razao_social: string
          telefone: string | null
          tenant_id: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          condicao_pagamento?: string | null
          contato?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          nome_fantasia?: string | null
          numero?: string | null
          prazo_entrega_dias?: number | null
          razao_social: string
          telefone?: string | null
          tenant_id: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          condicao_pagamento?: string | null
          contato?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          nome_fantasia?: string | null
          numero?: string | null
          prazo_entrega_dias?: number | null
          razao_social?: string
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fornecedores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      obras: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          cliente_id: string
          created_at: string
          data_inicio: string | null
          endereco: string | null
          estado: string | null
          id: string
          nome: string
          numero: string | null
          observacoes: string | null
          previsao_termino: string | null
          responsavel: string | null
          situacao: Database["public"]["Enums"]["obra_situacao"]
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cliente_id: string
          created_at?: string
          data_inicio?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          nome: string
          numero?: string | null
          observacoes?: string | null
          previsao_termino?: string | null
          responsavel?: string | null
          situacao?: Database["public"]["Enums"]["obra_situacao"]
          telefone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cliente_id?: string
          created_at?: string
          data_inicio?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          nome?: string
          numero?: string | null
          observacoes?: string | null
          previsao_termino?: string | null
          responsavel?: string | null
          situacao?: Database["public"]["Enums"]["obra_situacao"]
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "obras_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_conversoes: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          fator: number
          id: string
          produto_id: string
          tenant_id: string
          unidade: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          fator?: number
          id?: string
          produto_id: string
          tenant_id: string
          unidade: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          fator?: number
          id?: string
          produto_id?: string
          tenant_id?: string
          unidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_conversoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_conversoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          altura: number | null
          ativo: boolean
          categoria_id: string | null
          codigo_barras: string | null
          codigo_interno: string
          comprimento: number | null
          created_at: string
          custo: number
          deleted_at: string | null
          descricao: string
          descricao_resumida: string | null
          estoque_maximo: number
          estoque_minimo: number
          fabricante: string | null
          fator_conversao: number
          fornecedor_id: string | null
          id: string
          imagem_url: string | null
          largura: number | null
          localizacao: string | null
          marca: string | null
          ncm: string | null
          peso: number | null
          preco_venda: number
          tenant_id: string
          unidade: string
          unidade_compra: string | null
          unidade_venda: string | null
          updated_at: string
        }
        Insert: {
          altura?: number | null
          ativo?: boolean
          categoria_id?: string | null
          codigo_barras?: string | null
          codigo_interno: string
          comprimento?: number | null
          created_at?: string
          custo?: number
          deleted_at?: string | null
          descricao: string
          descricao_resumida?: string | null
          estoque_maximo?: number
          estoque_minimo?: number
          fabricante?: string | null
          fator_conversao?: number
          fornecedor_id?: string | null
          id?: string
          imagem_url?: string | null
          largura?: number | null
          localizacao?: string | null
          marca?: string | null
          ncm?: string | null
          peso?: number | null
          preco_venda?: number
          tenant_id: string
          unidade?: string
          unidade_compra?: string | null
          unidade_venda?: string | null
          updated_at?: string
        }
        Update: {
          altura?: number | null
          ativo?: boolean
          categoria_id?: string | null
          codigo_barras?: string | null
          codigo_interno?: string
          comprimento?: number | null
          created_at?: string
          custo?: number
          deleted_at?: string | null
          descricao?: string
          descricao_resumida?: string | null
          estoque_maximo?: number
          estoque_minimo?: number
          fabricante?: string | null
          fator_conversao?: number
          fornecedor_id?: string | null
          id?: string
          imagem_url?: string | null
          largura?: number | null
          localizacao?: string | null
          marca?: string | null
          ncm?: string | null
          peso?: number | null
          preco_venda?: number
          tenant_id?: string
          unidade?: string
          unidade_compra?: string | null
          unidade_venda?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          created_at: string
          email: string | null
          empresa_id: string | null
          filial_id: string | null
          id: string
          nome: string
          telefone: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id: string
          nome?: string
          telefone?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissoes: {
        Row: {
          id: string
          modulo: string
          pode_criar: boolean
          pode_editar: boolean
          pode_excluir: boolean
          pode_ver: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
        }
        Insert: {
          id?: string
          modulo: string
          pode_criar?: boolean
          pode_editar?: boolean
          pode_excluir?: boolean
          pode_ver?: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
        }
        Update: {
          id?: string
          modulo?: string
          pode_criar?: boolean
          pode_editar?: boolean
          pode_excluir?: boolean
          pode_ver?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          slug: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          slug?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          slug?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      registrar_movimentacao: {
        Args: {
          p_deposito_destino_id?: string
          p_deposito_id: string
          p_documento?: string
          p_motivo?: string
          p_produto_id: string
          p_quantidade: number
          p_tipo: Database["public"]["Enums"]["mov_tipo"]
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "administrador"
        | "gestor"
        | "vendedor"
        | "caixa"
        | "estoquista"
        | "comprador"
        | "financeiro"
        | "logistica"
        | "motorista"
      mov_tipo:
        | "entrada"
        | "saida"
        | "ajuste"
        | "inventario"
        | "transferencia_saida"
        | "transferencia_entrada"
        | "reserva"
        | "liberacao_reserva"
      obra_situacao:
        | "planejamento"
        | "em_andamento"
        | "pausada"
        | "concluida"
        | "cancelada"
      pessoa_tipo: "PF" | "PJ"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "administrador",
        "gestor",
        "vendedor",
        "caixa",
        "estoquista",
        "comprador",
        "financeiro",
        "logistica",
        "motorista",
      ],
      mov_tipo: [
        "entrada",
        "saida",
        "ajuste",
        "inventario",
        "transferencia_saida",
        "transferencia_entrada",
        "reserva",
        "liberacao_reserva",
      ],
      obra_situacao: [
        "planejamento",
        "em_andamento",
        "pausada",
        "concluida",
        "cancelada",
      ],
      pessoa_tipo: ["PF", "PJ"],
    },
  },
} as const
