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
      caixa_movimentos: {
        Row: {
          caixa_id: string
          created_at: string
          descricao: string | null
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          id: string
          tenant_id: string
          tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
          usuario_id: string | null
          valor: number
        }
        Insert: {
          caixa_id: string
          created_at?: string
          descricao?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          tenant_id: string
          tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
          usuario_id?: string | null
          valor: number
        }
        Update: {
          caixa_id?: string
          created_at?: string
          descricao?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["caixa_mov_tipo"]
          usuario_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "caixa_movimentos_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixa_movimentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      caixas: {
        Row: {
          aberto_em: string
          aberto_por: string | null
          created_at: string
          diferenca: number | null
          fechado_em: string | null
          fechado_por: string | null
          filial_id: string | null
          id: string
          numero: number | null
          observacao: string | null
          situacao: Database["public"]["Enums"]["caixa_situacao"]
          tenant_id: string
          updated_at: string
          valor_abertura: number
          valor_esperado: number | null
          valor_informado: number | null
        }
        Insert: {
          aberto_em?: string
          aberto_por?: string | null
          created_at?: string
          diferenca?: number | null
          fechado_em?: string | null
          fechado_por?: string | null
          filial_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          situacao?: Database["public"]["Enums"]["caixa_situacao"]
          tenant_id: string
          updated_at?: string
          valor_abertura?: number
          valor_esperado?: number | null
          valor_informado?: number | null
        }
        Update: {
          aberto_em?: string
          aberto_por?: string | null
          created_at?: string
          diferenca?: number | null
          fechado_em?: string | null
          fechado_por?: string | null
          filial_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          situacao?: Database["public"]["Enums"]["caixa_situacao"]
          tenant_id?: string
          updated_at?: string
          valor_abertura?: number
          valor_esperado?: number | null
          valor_informado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "caixas_aberto_por_fkey"
            columns: ["aberto_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixas_fechado_por_fkey"
            columns: ["fechado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixas_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixas_tenant_id_fkey"
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
      compra_cotacoes: {
        Row: {
          compra_id: string
          condicao_pagamento: string | null
          created_at: string
          escolhida: boolean
          fornecedor_id: string
          id: string
          observacao: string | null
          prazo_entrega_dias: number | null
          tenant_id: string
          valor_total: number
        }
        Insert: {
          compra_id: string
          condicao_pagamento?: string | null
          created_at?: string
          escolhida?: boolean
          fornecedor_id: string
          id?: string
          observacao?: string | null
          prazo_entrega_dias?: number | null
          tenant_id: string
          valor_total?: number
        }
        Update: {
          compra_id?: string
          condicao_pagamento?: string | null
          created_at?: string
          escolhida?: boolean
          fornecedor_id?: string
          id?: string
          observacao?: string | null
          prazo_entrega_dias?: number | null
          tenant_id?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "compra_cotacoes_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_cotacoes_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_cotacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_itens: {
        Row: {
          compra_id: string
          created_at: string
          custo_unitario: number
          id: string
          observacao: string | null
          produto_id: string
          quantidade: number
          quantidade_recebida: number
          tenant_id: string
          total: number
          unidade: string | null
        }
        Insert: {
          compra_id: string
          created_at?: string
          custo_unitario?: number
          id?: string
          observacao?: string | null
          produto_id: string
          quantidade: number
          quantidade_recebida?: number
          tenant_id: string
          total?: number
          unidade?: string | null
        }
        Update: {
          compra_id?: string
          created_at?: string
          custo_unitario?: number
          id?: string
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          quantidade_recebida?: number
          tenant_id?: string
          total?: number
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compra_itens_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_recebimento_itens: {
        Row: {
          compra_item_id: string
          created_at: string
          custo_unitario: number
          divergencia: Database["public"]["Enums"]["divergencia_tipo"] | null
          divergencia_obs: string | null
          id: string
          produto_id: string
          quantidade: number
          recebimento_id: string
          tenant_id: string
        }
        Insert: {
          compra_item_id: string
          created_at?: string
          custo_unitario?: number
          divergencia?: Database["public"]["Enums"]["divergencia_tipo"] | null
          divergencia_obs?: string | null
          id?: string
          produto_id: string
          quantidade: number
          recebimento_id: string
          tenant_id: string
        }
        Update: {
          compra_item_id?: string
          created_at?: string
          custo_unitario?: number
          divergencia?: Database["public"]["Enums"]["divergencia_tipo"] | null
          divergencia_obs?: string | null
          id?: string
          produto_id?: string
          quantidade?: number
          recebimento_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compra_recebimento_itens_compra_item_id_fkey"
            columns: ["compra_item_id"]
            isOneToOne: false
            referencedRelation: "compra_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_recebimento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_recebimento_itens_recebimento_id_fkey"
            columns: ["recebimento_id"]
            isOneToOne: false
            referencedRelation: "compra_recebimentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_recebimento_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_recebimentos: {
        Row: {
          compra_id: string
          created_at: string
          data_recebimento: string
          documento: string | null
          id: string
          numero: number | null
          observacao: string | null
          tenant_id: string
          usuario_id: string | null
        }
        Insert: {
          compra_id: string
          created_at?: string
          data_recebimento?: string
          documento?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          tenant_id: string
          usuario_id?: string | null
        }
        Update: {
          compra_id?: string
          created_at?: string
          data_recebimento?: string
          documento?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          tenant_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compra_recebimentos_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_recebimentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compras: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          condicao_pagamento: string | null
          created_at: string
          deposito_id: string
          desconto: number
          empresa_id: string | null
          filial_id: string | null
          fornecedor_id: string | null
          frete: number
          id: string
          motivo_cancelamento: string | null
          numero: number | null
          observacoes: string | null
          origem: string
          previsao_entrega: string | null
          situacao: Database["public"]["Enums"]["compra_situacao"]
          solicitante_id: string | null
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          condicao_pagamento?: string | null
          created_at?: string
          deposito_id: string
          desconto?: number
          empresa_id?: string | null
          filial_id?: string | null
          fornecedor_id?: string | null
          frete?: number
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          observacoes?: string | null
          origem?: string
          previsao_entrega?: string | null
          situacao?: Database["public"]["Enums"]["compra_situacao"]
          solicitante_id?: string | null
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          condicao_pagamento?: string | null
          created_at?: string
          deposito_id?: string
          desconto?: number
          empresa_id?: string | null
          filial_id?: string | null
          fornecedor_id?: string | null
          frete?: number
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          observacoes?: string | null
          origem?: string
          previsao_entrega?: string | null
          situacao?: Database["public"]["Enums"]["compra_situacao"]
          solicitante_id?: string | null
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contas_pagar: {
        Row: {
          categoria: string | null
          compra_id: string | null
          created_at: string
          descricao: string
          empresa_id: string | null
          filial_id: string | null
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor_id: string | null
          id: string
          motivo_cancelamento: string | null
          numero: number | null
          observacoes: string | null
          parcela: number
          parcelas: number
          situacao: Database["public"]["Enums"]["conta_situacao"]
          tenant_id: string
          updated_at: string
          valor: number
          valor_pago: number
          vencimento: string
        }
        Insert: {
          categoria?: string | null
          compra_id?: string | null
          created_at?: string
          descricao: string
          empresa_id?: string | null
          filial_id?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          observacoes?: string | null
          parcela?: number
          parcelas?: number
          situacao?: Database["public"]["Enums"]["conta_situacao"]
          tenant_id: string
          updated_at?: string
          valor: number
          valor_pago?: number
          vencimento: string
        }
        Update: {
          categoria?: string | null
          compra_id?: string | null
          created_at?: string
          descricao?: string
          empresa_id?: string | null
          filial_id?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          observacoes?: string | null
          parcela?: number
          parcelas?: number
          situacao?: Database["public"]["Enums"]["conta_situacao"]
          tenant_id?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_pagar_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contas_receber: {
        Row: {
          cliente_id: string | null
          created_at: string
          descricao: string
          empresa_id: string | null
          filial_id: string | null
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          id: string
          motivo_cancelamento: string | null
          numero: number | null
          observacoes: string | null
          parcela: number
          parcelas: number
          pedido_id: string | null
          situacao: Database["public"]["Enums"]["conta_situacao"]
          tenant_id: string
          updated_at: string
          valor: number
          valor_recebido: number
          vencimento: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          descricao: string
          empresa_id?: string | null
          filial_id?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          observacoes?: string | null
          parcela?: number
          parcelas?: number
          pedido_id?: string | null
          situacao?: Database["public"]["Enums"]["conta_situacao"]
          tenant_id: string
          updated_at?: string
          valor: number
          valor_recebido?: number
          vencimento: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          descricao?: string
          empresa_id?: string | null
          filial_id?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          observacoes?: string | null
          parcela?: number
          parcelas?: number
          pedido_id?: string | null
          situacao?: Database["public"]["Enums"]["conta_situacao"]
          tenant_id?: string
          updated_at?: string
          valor?: number
          valor_recebido?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_receber_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credito_autorizacoes: {
        Row: {
          autorizado_em: string | null
          autorizado_por: string | null
          cliente_id: string
          created_at: string
          id: string
          limite: number
          motivo: string | null
          observacao: string | null
          orcamento_id: string | null
          pedido_id: string | null
          saldo_utilizado: number
          situacao: Database["public"]["Enums"]["autorizacao_situacao"]
          solicitante_id: string | null
          tenant_id: string
          updated_at: string
          valor: number
        }
        Insert: {
          autorizado_em?: string | null
          autorizado_por?: string | null
          cliente_id: string
          created_at?: string
          id?: string
          limite?: number
          motivo?: string | null
          observacao?: string | null
          orcamento_id?: string | null
          pedido_id?: string | null
          saldo_utilizado?: number
          situacao?: Database["public"]["Enums"]["autorizacao_situacao"]
          solicitante_id?: string | null
          tenant_id: string
          updated_at?: string
          valor: number
        }
        Update: {
          autorizado_em?: string | null
          autorizado_por?: string | null
          cliente_id?: string
          created_at?: string
          id?: string
          limite?: number
          motivo?: string | null
          observacao?: string | null
          orcamento_id?: string | null
          pedido_id?: string | null
          saldo_utilizado?: number
          situacao?: Database["public"]["Enums"]["autorizacao_situacao"]
          solicitante_id?: string | null
          tenant_id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "credito_autorizacoes_autorizado_por_fkey"
            columns: ["autorizado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credito_autorizacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credito_autorizacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credito_autorizacoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credito_autorizacoes_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credito_autorizacoes_tenant_id_fkey"
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
      entrega_itens: {
        Row: {
          created_at: string
          entrega_id: string
          id: string
          pedido_item_id: string
          produto_id: string
          quantidade: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          entrega_id: string
          id?: string
          pedido_item_id: string
          produto_id: string
          quantidade: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          entrega_id?: string
          id?: string
          pedido_item_id?: string
          produto_id?: string
          quantidade?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entrega_itens_entrega_id_fkey"
            columns: ["entrega_id"]
            isOneToOne: false
            referencedRelation: "entregas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entrega_itens_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entrega_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entrega_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      entregas: {
        Row: {
          created_at: string
          data_entrega: string
          id: string
          numero: number | null
          observacao: string | null
          pedido_id: string
          recebedor: string | null
          situacao: string
          tenant_id: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          data_entrega?: string
          id?: string
          numero?: number | null
          observacao?: string | null
          pedido_id: string
          recebedor?: string | null
          situacao?: string
          tenant_id: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          data_entrega?: string
          id?: string
          numero?: number | null
          observacao?: string | null
          pedido_id?: string
          recebedor?: string | null
          situacao?: string
          tenant_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entregas_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_tenant_id_fkey"
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
      financeiro_baixas: {
        Row: {
          caixa_id: string | null
          conta_pagar_id: string | null
          conta_receber_id: string | null
          created_at: string
          data_baixa: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          id: string
          observacao: string | null
          tenant_id: string
          usuario_id: string | null
          valor: number
        }
        Insert: {
          caixa_id?: string | null
          conta_pagar_id?: string | null
          conta_receber_id?: string | null
          created_at?: string
          data_baixa?: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          observacao?: string | null
          tenant_id: string
          usuario_id?: string | null
          valor: number
        }
        Update: {
          caixa_id?: string | null
          conta_pagar_id?: string | null
          conta_receber_id?: string | null
          created_at?: string
          data_baixa?: string
          forma_pagamento?: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          observacao?: string | null
          tenant_id?: string
          usuario_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_baixas_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_baixas_conta_pagar_id_fkey"
            columns: ["conta_pagar_id"]
            isOneToOne: false
            referencedRelation: "contas_pagar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_baixas_conta_receber_id_fkey"
            columns: ["conta_receber_id"]
            isOneToOne: false
            referencedRelation: "contas_receber"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_baixas_tenant_id_fkey"
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
      orcamento_itens: {
        Row: {
          created_at: string
          desconto: number
          id: string
          observacao: string | null
          orcamento_id: string
          preco_unitario: number
          produto_id: string
          quantidade: number
          tenant_id: string
          total: number
          unidade: string | null
        }
        Insert: {
          created_at?: string
          desconto?: number
          id?: string
          observacao?: string | null
          orcamento_id: string
          preco_unitario?: number
          produto_id: string
          quantidade: number
          tenant_id: string
          total?: number
          unidade?: string | null
        }
        Update: {
          created_at?: string
          desconto?: number
          id?: string
          observacao?: string | null
          orcamento_id?: string
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          tenant_id?: string
          total?: number
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          cliente_id: string
          condicao_pagamento: string | null
          created_at: string
          deleted_at: string | null
          desconto: number
          empresa_id: string | null
          filial_id: string | null
          frete: number
          id: string
          motivo_rejeicao: string | null
          numero: number | null
          obra_id: string | null
          observacoes: string | null
          prazo_entrega: string | null
          situacao: Database["public"]["Enums"]["orcamento_situacao"]
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          validade: string | null
          vendedor_id: string | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          cliente_id: string
          condicao_pagamento?: string | null
          created_at?: string
          deleted_at?: string | null
          desconto?: number
          empresa_id?: string | null
          filial_id?: string | null
          frete?: number
          id?: string
          motivo_rejeicao?: string | null
          numero?: number | null
          obra_id?: string | null
          observacoes?: string | null
          prazo_entrega?: string | null
          situacao?: Database["public"]["Enums"]["orcamento_situacao"]
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          validade?: string | null
          vendedor_id?: string | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          cliente_id?: string
          condicao_pagamento?: string | null
          created_at?: string
          deleted_at?: string | null
          desconto?: number
          empresa_id?: string | null
          filial_id?: string | null
          frete?: number
          id?: string
          motivo_rejeicao?: string | null
          numero?: number | null
          obra_id?: string | null
          observacoes?: string | null
          prazo_entrega?: string | null
          situacao?: Database["public"]["Enums"]["orcamento_situacao"]
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          validade?: string | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_historico: {
        Row: {
          created_at: string
          id: string
          observacao: string | null
          pedido_id: string
          situacao_anterior:
            | Database["public"]["Enums"]["pedido_situacao"]
            | null
          situacao_nova: Database["public"]["Enums"]["pedido_situacao"]
          tenant_id: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          observacao?: string | null
          pedido_id: string
          situacao_anterior?:
            | Database["public"]["Enums"]["pedido_situacao"]
            | null
          situacao_nova: Database["public"]["Enums"]["pedido_situacao"]
          tenant_id: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          observacao?: string | null
          pedido_id?: string
          situacao_anterior?:
            | Database["public"]["Enums"]["pedido_situacao"]
            | null
          situacao_nova?: Database["public"]["Enums"]["pedido_situacao"]
          tenant_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_historico_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_historico_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_itens: {
        Row: {
          created_at: string
          desconto: number
          divergencia: string | null
          id: string
          observacao: string | null
          pedido_id: string
          preco_unitario: number
          produto_id: string
          quantidade: number
          quantidade_conferida: number
          quantidade_entregue: number
          quantidade_separada: number
          tenant_id: string
          total: number
          unidade: string | null
        }
        Insert: {
          created_at?: string
          desconto?: number
          divergencia?: string | null
          id?: string
          observacao?: string | null
          pedido_id: string
          preco_unitario?: number
          produto_id: string
          quantidade: number
          quantidade_conferida?: number
          quantidade_entregue?: number
          quantidade_separada?: number
          tenant_id: string
          total?: number
          unidade?: string | null
        }
        Update: {
          created_at?: string
          desconto?: number
          divergencia?: string | null
          id?: string
          observacao?: string | null
          pedido_id?: string
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          quantidade_conferida?: number
          quantidade_entregue?: number
          quantidade_separada?: number
          tenant_id?: string
          total?: number
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          cliente_id: string
          condicao_pagamento: string | null
          created_at: string
          deposito_id: string
          desconto: number
          empresa_id: string | null
          entrega_bairro: string | null
          entrega_cep: string | null
          entrega_cidade: string | null
          entrega_endereco: string | null
          entrega_estado: string | null
          entrega_numero: string | null
          estoque_reservado: boolean
          filial_id: string | null
          forma_pagamento: string | null
          frete: number
          id: string
          motivo_cancelamento: string | null
          numero: number | null
          obra_id: string | null
          observacoes: string | null
          orcamento_id: string | null
          previsao_entrega: string | null
          situacao: Database["public"]["Enums"]["pedido_situacao"]
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          vendedor_id: string | null
        }
        Insert: {
          cliente_id: string
          condicao_pagamento?: string | null
          created_at?: string
          deposito_id: string
          desconto?: number
          empresa_id?: string | null
          entrega_bairro?: string | null
          entrega_cep?: string | null
          entrega_cidade?: string | null
          entrega_endereco?: string | null
          entrega_estado?: string | null
          entrega_numero?: string | null
          estoque_reservado?: boolean
          filial_id?: string | null
          forma_pagamento?: string | null
          frete?: number
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          obra_id?: string | null
          observacoes?: string | null
          orcamento_id?: string | null
          previsao_entrega?: string | null
          situacao?: Database["public"]["Enums"]["pedido_situacao"]
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          vendedor_id?: string | null
        }
        Update: {
          cliente_id?: string
          condicao_pagamento?: string | null
          created_at?: string
          deposito_id?: string
          desconto?: number
          empresa_id?: string | null
          entrega_bairro?: string | null
          entrega_cep?: string | null
          entrega_cidade?: string | null
          entrega_endereco?: string | null
          entrega_estado?: string | null
          entrega_numero?: string | null
          estoque_reservado?: boolean
          filial_id?: string | null
          forma_pagamento?: string | null
          frete?: number
          id?: string
          motivo_cancelamento?: string | null
          numero?: number | null
          obra_id?: string | null
          observacoes?: string | null
          orcamento_id?: string | null
          previsao_entrega?: string | null
          situacao?: Database["public"]["Enums"]["pedido_situacao"]
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      abrir_caixa: {
        Args: { p_filial_id: string; p_valor_abertura?: number }
        Returns: string
      }
      baixar_conta: {
        Args: {
          p_caixa_id?: string
          p_conta_id: string
          p_data?: string
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
          p_observacao?: string
          p_tipo: string
          p_valor: number
        }
        Returns: string
      }
      caixa_movimento: {
        Args: {
          p_caixa_id: string
          p_descricao?: string
          p_forma?: Database["public"]["Enums"]["forma_pagamento"]
          p_tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
          p_valor: number
        }
        Returns: string
      }
      compra_avancar_status: {
        Args: {
          p_compra_id: string
          p_observacao?: string
          p_situacao: Database["public"]["Enums"]["compra_situacao"]
        }
        Returns: undefined
      }
      compra_escolher_cotacao: {
        Args: { p_cotacao_id: string }
        Returns: undefined
      }
      converter_orcamento_em_pedido: {
        Args: { p_deposito_id: string; p_orcamento_id: string }
        Returns: string
      }
      current_tenant_id: { Args: never; Returns: string }
      decidir_autorizacao_credito: {
        Args: { p_aprovar: boolean; p_id: string; p_observacao?: string }
        Returns: undefined
      }
      fechar_caixa: {
        Args: {
          p_caixa_id: string
          p_observacao?: string
          p_valor_informado: number
        }
        Returns: number
      }
      gerar_compra_estoque_minimo: {
        Args: { p_deposito_id: string }
        Returns: string
      }
      gerar_contas_receber: {
        Args: {
          p_forma?: Database["public"]["Enums"]["forma_pagamento"]
          p_parcelas?: number
          p_pedido_id: string
          p_primeiro_vencimento?: string
        }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      pedido_avancar_status: {
        Args: {
          p_observacao?: string
          p_pedido_id: string
          p_situacao: Database["public"]["Enums"]["pedido_situacao"]
        }
        Returns: undefined
      }
      pedido_registrar_entrega: {
        Args: {
          p_itens: Json
          p_observacao?: string
          p_pedido_id: string
          p_recebedor?: string
        }
        Returns: string
      }
      recalcular_compra: { Args: { p_id: string }; Returns: undefined }
      recalcular_orcamento: { Args: { p_id: string }; Returns: undefined }
      recalcular_pedido: { Args: { p_id: string }; Returns: undefined }
      receber_compra: {
        Args: {
          p_compra_id: string
          p_documento?: string
          p_gerar_conta?: boolean
          p_itens: Json
          p_observacao?: string
          p_parcelas?: number
          p_vencimento?: string
        }
        Returns: string
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
      solicitar_autorizacao_credito: {
        Args: {
          p_cliente_id: string
          p_motivo?: string
          p_orcamento_id?: string
          p_pedido_id?: string
          p_valor: number
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
      autorizacao_situacao: "pendente" | "aprovada" | "negada"
      caixa_mov_tipo:
        | "abertura"
        | "entrada"
        | "saida"
        | "sangria"
        | "suprimento"
        | "venda"
        | "recebimento"
        | "fechamento"
      caixa_situacao: "aberto" | "fechado"
      compra_situacao:
        | "rascunho"
        | "cotacao"
        | "aprovado"
        | "pedido_enviado"
        | "parcialmente_recebido"
        | "recebido"
        | "cancelado"
      conta_situacao: "aberto" | "parcial" | "pago" | "cancelado"
      divergencia_tipo: "quantidade" | "produto_errado" | "danificado"
      forma_pagamento:
        | "dinheiro"
        | "pix"
        | "cartao_credito"
        | "cartao_debito"
        | "boleto"
        | "transferencia"
        | "crediario"
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
      orcamento_situacao:
        | "rascunho"
        | "enviado"
        | "em_negociacao"
        | "aprovado"
        | "rejeitado"
        | "expirado"
      pedido_situacao:
        | "aguardando_pagamento"
        | "aprovado"
        | "separacao"
        | "separado"
        | "conferencia"
        | "pronto_entrega"
        | "em_rota"
        | "entregue"
        | "concluido"
        | "cancelado"
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
      autorizacao_situacao: ["pendente", "aprovada", "negada"],
      caixa_mov_tipo: [
        "abertura",
        "entrada",
        "saida",
        "sangria",
        "suprimento",
        "venda",
        "recebimento",
        "fechamento",
      ],
      caixa_situacao: ["aberto", "fechado"],
      compra_situacao: [
        "rascunho",
        "cotacao",
        "aprovado",
        "pedido_enviado",
        "parcialmente_recebido",
        "recebido",
        "cancelado",
      ],
      conta_situacao: ["aberto", "parcial", "pago", "cancelado"],
      divergencia_tipo: ["quantidade", "produto_errado", "danificado"],
      forma_pagamento: [
        "dinheiro",
        "pix",
        "cartao_credito",
        "cartao_debito",
        "boleto",
        "transferencia",
        "crediario",
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
      orcamento_situacao: [
        "rascunho",
        "enviado",
        "em_negociacao",
        "aprovado",
        "rejeitado",
        "expirado",
      ],
      pedido_situacao: [
        "aguardando_pagamento",
        "aprovado",
        "separacao",
        "separado",
        "conferencia",
        "pronto_entrega",
        "em_rota",
        "entregue",
        "concluido",
        "cancelado",
      ],
      pessoa_tipo: ["PF", "PJ"],
    },
  },
} as const
