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
      assinatura_faturas: {
        Row: {
          assinatura_id: string
          competencia: string | null
          created_at: string
          descricao: string
          forma_pagamento: string | null
          id: string
          pago_em: string | null
          tenant_id: string
          tipo: string
          updated_at: string
          valor: number
          valor_pago: number
          vencimento: string
        }
        Insert: {
          assinatura_id: string
          competencia?: string | null
          created_at?: string
          descricao: string
          forma_pagamento?: string | null
          id?: string
          pago_em?: string | null
          tenant_id: string
          tipo?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento: string
        }
        Update: {
          assinatura_id?: string
          competencia?: string | null
          created_at?: string
          descricao?: string
          forma_pagamento?: string | null
          id?: string
          pago_em?: string | null
          tenant_id?: string
          tipo?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "assinatura_faturas_assinatura_id_fkey"
            columns: ["assinatura_id"]
            isOneToOne: false
            referencedRelation: "assinaturas"
            referencedColumns: ["id"]
          },
        ]
      }
      assinaturas: {
        Row: {
          created_at: string
          dia_vencimento: number
          filiais_extras: number
          id: string
          implantacao_paga: boolean
          observacoes: string | null
          plano: string
          situacao: string
          tenant_id: string
          teste_ate: string | null
          updated_at: string
          valor_filial_extra: number
          valor_implantacao: number
          valor_mensal: number
        }
        Insert: {
          created_at?: string
          dia_vencimento?: number
          filiais_extras?: number
          id?: string
          implantacao_paga?: boolean
          observacoes?: string | null
          plano?: string
          situacao?: string
          tenant_id: string
          teste_ate?: string | null
          updated_at?: string
          valor_filial_extra?: number
          valor_implantacao?: number
          valor_mensal?: number
        }
        Update: {
          created_at?: string
          dia_vencimento?: number
          filiais_extras?: number
          id?: string
          implantacao_paga?: boolean
          observacoes?: string | null
          plano?: string
          situacao?: string
          tenant_id?: string
          teste_ate?: string | null
          updated_at?: string
          valor_filial_extra?: number
          valor_implantacao?: number
          valor_mensal?: number
        }
        Relationships: []
      }
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
      banco_movimentos: {
        Row: {
          categoria: string | null
          conciliado: boolean
          conciliado_em: string | null
          conta_destino_id: string | null
          conta_id: string
          created_at: string
          data: string
          descricao: string
          documento: string | null
          forma: string | null
          id: string
          origem: string
          origem_id: string | null
          tenant_id: string
          tipo: string
          usuario_id: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          conciliado?: boolean
          conciliado_em?: string | null
          conta_destino_id?: string | null
          conta_id: string
          created_at?: string
          data?: string
          descricao: string
          documento?: string | null
          forma?: string | null
          id?: string
          origem?: string
          origem_id?: string | null
          tenant_id?: string
          tipo: string
          usuario_id?: string | null
          valor: number
        }
        Update: {
          categoria?: string | null
          conciliado?: boolean
          conciliado_em?: string | null
          conta_destino_id?: string | null
          conta_id?: string
          created_at?: string
          data?: string
          descricao?: string
          documento?: string | null
          forma?: string | null
          id?: string
          origem?: string
          origem_id?: string | null
          tenant_id?: string
          tipo?: string
          usuario_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "banco_movimentos_conta_destino_id_fkey"
            columns: ["conta_destino_id"]
            isOneToOne: false
            referencedRelation: "contas_bancarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_movimentos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas_bancarias"
            referencedColumns: ["id"]
          },
        ]
      }
      caixa_movimentos: {
        Row: {
          caixa_id: string
          created_at: string
          deposito_id: string | null
          descricao: string | null
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          id: string
          pedido_id: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
          usuario_id: string | null
          valor: number
        }
        Insert: {
          caixa_id: string
          created_at?: string
          deposito_id?: string | null
          descricao?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          pedido_id?: string | null
          tenant_id: string
          tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
          usuario_id?: string | null
          valor: number
        }
        Update: {
          caixa_id?: string
          created_at?: string
          deposito_id?: string | null
          descricao?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          pedido_id?: string | null
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
            foreignKeyName: "caixa_movimentos_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixa_movimentos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
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
          codigo_municipio: string | null
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
          profissional_id: string | null
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
          codigo_municipio?: string | null
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
          profissional_id?: string | null
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
          codigo_municipio?: string | null
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
          profissional_id?: string | null
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
            foreignKeyName: "clientes_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "profissionais"
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
      comissoes: {
        Row: {
          base: string
          created_at: string
          forma_pagamento: string | null
          id: string
          observacao: string | null
          pago_em: string | null
          pedido_id: string | null
          percentual: number
          situacao: string
          tenant_id: string
          updated_at: string
          valor: number
          valor_base: number
          valor_custo: number
          valor_venda: number
          vendedor_id: string
        }
        Insert: {
          base?: string
          created_at?: string
          forma_pagamento?: string | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          pedido_id?: string | null
          percentual?: number
          situacao?: string
          tenant_id?: string
          updated_at?: string
          valor?: number
          valor_base?: number
          valor_custo?: number
          valor_venda?: number
          vendedor_id: string
        }
        Update: {
          base?: string
          created_at?: string
          forma_pagamento?: string | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          pedido_id?: string | null
          percentual?: number
          situacao?: string
          tenant_id?: string
          updated_at?: string
          valor?: number
          valor_base?: number
          valor_custo?: number
          valor_venda?: number
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comissoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissoes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_cotacao_itens: {
        Row: {
          compra_item_id: string
          cotacao_id: string
          created_at: string
          custo_unitario: number
          id: string
          observacao: string | null
          produto_id: string
          quantidade: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          compra_item_id: string
          cotacao_id: string
          created_at?: string
          custo_unitario?: number
          id?: string
          observacao?: string | null
          produto_id: string
          quantidade?: number
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          compra_item_id?: string
          cotacao_id?: string
          created_at?: string
          custo_unitario?: number
          id?: string
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compra_cotacao_itens_compra_item_id_fkey"
            columns: ["compra_item_id"]
            isOneToOne: false
            referencedRelation: "compra_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_cotacao_itens_cotacao_id_fkey"
            columns: ["cotacao_id"]
            isOneToOne: false
            referencedRelation: "compra_cotacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_cotacao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_cotacao_itens_tenant_id_fkey"
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
          nfe_chave: string | null
          nfe_emissao: string | null
          nfe_numero: string | null
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
          nfe_chave?: string | null
          nfe_emissao?: string | null
          nfe_numero?: string | null
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
          nfe_chave?: string | null
          nfe_emissao?: string | null
          nfe_numero?: string | null
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
      contas_bancarias: {
        Row: {
          agencia: string | null
          apelido: string
          ativa: boolean
          banco_codigo: string | null
          banco_nome: string | null
          chave_pix: string | null
          conta: string | null
          conta_digito: string | null
          created_at: string
          filial_id: string | null
          id: string
          observacoes: string | null
          padrao: boolean
          saldo_inicial: number
          saldo_inicial_data: string
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          agencia?: string | null
          apelido: string
          ativa?: boolean
          banco_codigo?: string | null
          banco_nome?: string | null
          chave_pix?: string | null
          conta?: string | null
          conta_digito?: string | null
          created_at?: string
          filial_id?: string | null
          id?: string
          observacoes?: string | null
          padrao?: boolean
          saldo_inicial?: number
          saldo_inicial_data?: string
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          agencia?: string | null
          apelido?: string
          ativa?: boolean
          banco_codigo?: string | null
          banco_nome?: string | null
          chave_pix?: string | null
          conta?: string | null
          conta_digito?: string | null
          created_at?: string
          filial_id?: string | null
          id?: string
          observacoes?: string | null
          padrao?: boolean
          saldo_inicial?: number
          saldo_inicial_data?: string
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_bancarias_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
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
      contatos: {
        Row: {
          created_at: string
          email: string | null
          id: string
          mensagem: string | null
          nome: string
          plano_interesse: string | null
          situacao: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          mensagem?: string | null
          nome: string
          plano_interesse?: string | null
          situacao?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          mensagem?: string | null
          nome?: string
          plano_interesse?: string | null
          situacao?: string
          whatsapp?: string | null
        }
        Relationships: []
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
      devolucao_itens: {
        Row: {
          created_at: string
          custo_unitario: number
          devolucao_id: string
          id: string
          pedido_item_id: string | null
          preco_unitario: number
          produto_id: string
          quantidade: number
          tenant_id: string
          total: number
          unidade: string | null
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          devolucao_id: string
          id?: string
          pedido_item_id?: string | null
          preco_unitario?: number
          produto_id: string
          quantidade: number
          tenant_id?: string
          total?: number
          unidade?: string | null
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          devolucao_id?: string
          id?: string
          pedido_item_id?: string | null
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          tenant_id?: string
          total?: number
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devolucao_itens_devolucao_id_fkey"
            columns: ["devolucao_id"]
            isOneToOne: false
            referencedRelation: "devolucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucoes: {
        Row: {
          cliente_id: string | null
          created_at: string
          deposito_id: string | null
          empresa_id: string | null
          filial_id: string | null
          id: string
          modo: string
          motivo: string | null
          nfe_id: string | null
          numero: number
          pedido_id: string
          tenant_id: string
          usuario_id: string | null
          valor_abatido: number
          valor_total: number
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          deposito_id?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          modo?: string
          motivo?: string | null
          nfe_id?: string | null
          numero?: number
          pedido_id: string
          tenant_id?: string
          usuario_id?: string | null
          valor_abatido?: number
          valor_total?: number
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          deposito_id?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          modo?: string
          motivo?: string | null
          nfe_id?: string | null
          numero?: number
          pedido_id?: string
          tenant_id?: string
          usuario_id?: string | null
          valor_abatido?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "devolucoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
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
          cnae: string | null
          cnae_secundarios: string | null
          cnpj: string | null
          codigo_municipio: string | null
          complemento: string | null
          cor_primaria: string
          created_at: string
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          logo_path: string | null
          nome_fantasia: string | null
          numero: string | null
          pdv_desconto_limite: number
          ramo_atividade: string
          razao_social: string
          regime_tributario: string
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnae?: string | null
          cnae_secundarios?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          complemento?: string | null
          cor_primaria?: string
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_path?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          pdv_desconto_limite?: number
          ramo_atividade?: string
          razao_social: string
          regime_tributario?: string
          telefone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnae?: string | null
          cnae_secundarios?: string | null
          cnpj?: string | null
          codigo_municipio?: string | null
          complemento?: string | null
          cor_primaria?: string
          created_at?: string
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_path?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          pdv_desconto_limite?: number
          ramo_atividade?: string
          razao_social?: string
          regime_tributario?: string
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
          assinatura: string | null
          created_at: string
          data_entrega: string
          data_saida: string | null
          foto_url: string | null
          id: string
          latitude: number | null
          longitude: number | null
          motivo_insucesso: string | null
          motorista_id: string | null
          numero: number | null
          observacao: string | null
          pedido_id: string
          previsao_data: string | null
          recebedor: string | null
          recebedor_documento: string | null
          sequencia: number | null
          situacao: string
          tenant_id: string
          usuario_id: string | null
          veiculo_id: string | null
        }
        Insert: {
          assinatura?: string | null
          created_at?: string
          data_entrega?: string
          data_saida?: string | null
          foto_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          motivo_insucesso?: string | null
          motorista_id?: string | null
          numero?: number | null
          observacao?: string | null
          pedido_id: string
          previsao_data?: string | null
          recebedor?: string | null
          recebedor_documento?: string | null
          sequencia?: number | null
          situacao?: string
          tenant_id: string
          usuario_id?: string | null
          veiculo_id?: string | null
        }
        Update: {
          assinatura?: string | null
          created_at?: string
          data_entrega?: string
          data_saida?: string | null
          foto_url?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          motivo_insucesso?: string | null
          motorista_id?: string | null
          numero?: number | null
          observacao?: string | null
          pedido_id?: string
          previsao_data?: string | null
          recebedor?: string | null
          recebedor_documento?: string | null
          sequencia?: number | null
          situacao?: string
          tenant_id?: string
          usuario_id?: string | null
          veiculo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entregas_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "entregas_veiculo_id_fkey"
            columns: ["veiculo_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_movimentacoes: {
        Row: {
          created_at: string
          custo_unitario: number
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
          valor_total: number
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
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
          valor_total?: number
        }
        Update: {
          created_at?: string
          custo_unitario?: number
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
          valor_total?: number
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
          custo_medio: number
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
          custo_medio?: number
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
          custo_medio?: number
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
          cnpj: string | null
          codigo: string | null
          created_at: string
          empresa_id: string
          endereco: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          nome: string
          numero: string | null
          situacao: string
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
          codigo?: string | null
          created_at?: string
          empresa_id: string
          endereco?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          nome: string
          numero?: string | null
          situacao?: string
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
          codigo?: string | null
          created_at?: string
          empresa_id?: string
          endereco?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          nome?: string
          numero?: string | null
          situacao?: string
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
      fiscal_config: {
        Row: {
          aliquota_cofins: number
          aliquota_icms_interestadual: number
          aliquota_icms_interna: number
          aliquota_iss: number
          aliquota_pis: number
          ambiente: string
          certificado_nome: string | null
          certificado_observacoes: string | null
          certificado_tipo: string | null
          certificado_titular: string | null
          certificado_validade: string | null
          cfop_padrao: string
          codigo_servico: string | null
          conta_emissor: string | null
          created_at: string
          cst_cofins: string
          cst_pis: string
          emissor: string | null
          empresa_id: string | null
          filial_id: string | null
          id: string
          informacoes_complementares: string | null
          item_lista_servico: string | null
          mva_st: number
          nfse_codigo_municipio: string | null
          nfse_codigo_tributacao: string | null
          nfse_incentivador_cultural: boolean | null
          nfse_iss_retido: boolean | null
          nfse_observacoes: string | null
          nfse_optante_simples: boolean | null
          nfse_padrao: string | null
          nfse_prefeitura: string | null
          nfse_regime_especial: string | null
          nfse_token: string | null
          nfse_url: string | null
          nfse_usuario: string | null
          proximo_numero: number
          proximo_numero_nfse: number | null
          reducao_base_icms: number
          regime_tributario: string
          responsavel_tecnico_cnpj: string | null
          responsavel_tecnico_contato: string | null
          responsavel_tecnico_email: string | null
          responsavel_tecnico_fone: string | null
          serie: number
          serie_nfse: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          aliquota_cofins?: number
          aliquota_icms_interestadual?: number
          aliquota_icms_interna?: number
          aliquota_iss?: number
          aliquota_pis?: number
          ambiente?: string
          certificado_nome?: string | null
          certificado_observacoes?: string | null
          certificado_tipo?: string | null
          certificado_titular?: string | null
          certificado_validade?: string | null
          cfop_padrao?: string
          codigo_servico?: string | null
          conta_emissor?: string | null
          created_at?: string
          cst_cofins?: string
          cst_pis?: string
          emissor?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          informacoes_complementares?: string | null
          item_lista_servico?: string | null
          mva_st?: number
          nfse_codigo_municipio?: string | null
          nfse_codigo_tributacao?: string | null
          nfse_incentivador_cultural?: boolean | null
          nfse_iss_retido?: boolean | null
          nfse_observacoes?: string | null
          nfse_optante_simples?: boolean | null
          nfse_padrao?: string | null
          nfse_prefeitura?: string | null
          nfse_regime_especial?: string | null
          nfse_token?: string | null
          nfse_url?: string | null
          nfse_usuario?: string | null
          proximo_numero?: number
          proximo_numero_nfse?: number | null
          reducao_base_icms?: number
          regime_tributario?: string
          responsavel_tecnico_cnpj?: string | null
          responsavel_tecnico_contato?: string | null
          responsavel_tecnico_email?: string | null
          responsavel_tecnico_fone?: string | null
          serie?: number
          serie_nfse?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          aliquota_cofins?: number
          aliquota_icms_interestadual?: number
          aliquota_icms_interna?: number
          aliquota_iss?: number
          aliquota_pis?: number
          ambiente?: string
          certificado_nome?: string | null
          certificado_observacoes?: string | null
          certificado_tipo?: string | null
          certificado_titular?: string | null
          certificado_validade?: string | null
          cfop_padrao?: string
          codigo_servico?: string | null
          conta_emissor?: string | null
          created_at?: string
          cst_cofins?: string
          cst_pis?: string
          emissor?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          informacoes_complementares?: string | null
          item_lista_servico?: string | null
          mva_st?: number
          nfse_codigo_municipio?: string | null
          nfse_codigo_tributacao?: string | null
          nfse_incentivador_cultural?: boolean | null
          nfse_iss_retido?: boolean | null
          nfse_observacoes?: string | null
          nfse_optante_simples?: boolean | null
          nfse_padrao?: string | null
          nfse_prefeitura?: string | null
          nfse_regime_especial?: string | null
          nfse_token?: string | null
          nfse_url?: string | null
          nfse_usuario?: string | null
          proximo_numero?: number
          proximo_numero_nfse?: number | null
          reducao_base_icms?: number
          regime_tributario?: string
          responsavel_tecnico_cnpj?: string | null
          responsavel_tecnico_contato?: string | null
          responsavel_tecnico_email?: string | null
          responsavel_tecnico_fone?: string | null
          serie?: number
          serie_nfse?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_config_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
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
      gestor_autorizacoes: {
        Row: {
          acao: string
          created_at: string
          expira_em: string
          gestor_id: string
          id: string
          operador_id: string | null
          tenant_id: string
          usado_em: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          expira_em?: string
          gestor_id: string
          id?: string
          operador_id?: string | null
          tenant_id: string
          usado_em?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          expira_em?: string
          gestor_id?: string
          id?: string
          operador_id?: string | null
          tenant_id?: string
          usado_em?: string | null
        }
        Relationships: []
      }
      inventario_itens: {
        Row: {
          created_at: string
          custo_unitario: number
          id: string
          inventario_id: string
          observacao: string | null
          produto_id: string
          quantidade_contada: number | null
          quantidade_sistema: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          id?: string
          inventario_id: string
          observacao?: string | null
          produto_id: string
          quantidade_contada?: number | null
          quantidade_sistema?: number
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          id?: string
          inventario_id?: string
          observacao?: string | null
          produto_id?: string
          quantidade_contada?: number | null
          quantidade_sistema?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_itens_inventario_id_fkey"
            columns: ["inventario_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      inventarios: {
        Row: {
          aplicado_em: string | null
          created_at: string
          deposito_id: string
          descricao: string | null
          id: string
          observacao: string | null
          situacao: string
          tenant_id: string
          updated_at: string
          usuario_id: string | null
        }
        Insert: {
          aplicado_em?: string | null
          created_at?: string
          deposito_id: string
          descricao?: string | null
          id?: string
          observacao?: string | null
          situacao?: string
          tenant_id?: string
          updated_at?: string
          usuario_id?: string | null
        }
        Update: {
          aplicado_em?: string | null
          created_at?: string
          deposito_id?: string
          descricao?: string | null
          id?: string
          observacao?: string | null
          situacao?: string
          tenant_id?: string
          updated_at?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventarios_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
        ]
      }
      locacao_equipamentos: {
        Row: {
          ativo: boolean
          categoria: string | null
          codigo: string | null
          created_at: string
          custo_manutencao: number
          filial_id: string | null
          id: string
          marca: string | null
          modelo: string | null
          nome: string
          numero_serie: string | null
          observacoes: string | null
          quantidade: number
          situacao: string
          tenant_id: string
          updated_at: string
          valor_aquisicao: number
          valor_caucao: number
          valor_diaria: number
          valor_mensal: number
          valor_semanal: number
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          codigo?: string | null
          created_at?: string
          custo_manutencao?: number
          filial_id?: string | null
          id?: string
          marca?: string | null
          modelo?: string | null
          nome: string
          numero_serie?: string | null
          observacoes?: string | null
          quantidade?: number
          situacao?: string
          tenant_id: string
          updated_at?: string
          valor_aquisicao?: number
          valor_caucao?: number
          valor_diaria?: number
          valor_mensal?: number
          valor_semanal?: number
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          codigo?: string | null
          created_at?: string
          custo_manutencao?: number
          filial_id?: string | null
          id?: string
          marca?: string | null
          modelo?: string | null
          nome?: string
          numero_serie?: string | null
          observacoes?: string | null
          quantidade?: number
          situacao?: string
          tenant_id?: string
          updated_at?: string
          valor_aquisicao?: number
          valor_caucao?: number
          valor_diaria?: number
          valor_mensal?: number
          valor_semanal?: number
        }
        Relationships: []
      }
      locacao_itens: {
        Row: {
          created_at: string
          dias: number
          equipamento_id: string
          id: string
          locacao_id: string
          quantidade: number
          tenant_id: string
          total: number
          valor_diaria: number
        }
        Insert: {
          created_at?: string
          dias?: number
          equipamento_id: string
          id?: string
          locacao_id: string
          quantidade?: number
          tenant_id?: string
          total?: number
          valor_diaria?: number
        }
        Update: {
          created_at?: string
          dias?: number
          equipamento_id?: string
          id?: string
          locacao_id?: string
          quantidade?: number
          tenant_id?: string
          total?: number
          valor_diaria?: number
        }
        Relationships: [
          {
            foreignKeyName: "locacao_itens_equipamento_id_fkey"
            columns: ["equipamento_id"]
            isOneToOne: false
            referencedRelation: "locacao_equipamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locacao_itens_locacao_id_fkey"
            columns: ["locacao_id"]
            isOneToOne: false
            referencedRelation: "locacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      locacoes: {
        Row: {
          aprovada: boolean
          aprovado_em: string | null
          caucao: number
          cliente_id: string | null
          conta_receber_id: string | null
          created_at: string
          devolvido_em: string | null
          dias: number
          dias_reais: number | null
          empresa_id: string | null
          entregue_em: string | null
          equipamento_id: string
          filial_id: string | null
          id: string
          inicio: string
          nfe_id: string | null
          numero: number
          obra_id: string | null
          observacao_devolucao: string | null
          observacoes: string | null
          previsao_devolucao: string | null
          situacao: Database["public"]["Enums"]["locacao_situacao"]
          solicitado_em: string
          tenant_id: string
          updated_at: string
          valor_diaria: number
          valor_extras: number
          valor_faturado: number
          valor_total: number
        }
        Insert: {
          aprovada?: boolean
          aprovado_em?: string | null
          caucao?: number
          cliente_id?: string | null
          conta_receber_id?: string | null
          created_at?: string
          devolvido_em?: string | null
          dias?: number
          dias_reais?: number | null
          empresa_id?: string | null
          entregue_em?: string | null
          equipamento_id: string
          filial_id?: string | null
          id?: string
          inicio?: string
          nfe_id?: string | null
          numero?: number
          obra_id?: string | null
          observacao_devolucao?: string | null
          observacoes?: string | null
          previsao_devolucao?: string | null
          situacao?: Database["public"]["Enums"]["locacao_situacao"]
          solicitado_em?: string
          tenant_id: string
          updated_at?: string
          valor_diaria?: number
          valor_extras?: number
          valor_faturado?: number
          valor_total?: number
        }
        Update: {
          aprovada?: boolean
          aprovado_em?: string | null
          caucao?: number
          cliente_id?: string | null
          conta_receber_id?: string | null
          created_at?: string
          devolvido_em?: string | null
          dias?: number
          dias_reais?: number | null
          empresa_id?: string | null
          entregue_em?: string | null
          equipamento_id?: string
          filial_id?: string | null
          id?: string
          inicio?: string
          nfe_id?: string | null
          numero?: number
          obra_id?: string | null
          observacao_devolucao?: string | null
          observacoes?: string | null
          previsao_devolucao?: string | null
          situacao?: Database["public"]["Enums"]["locacao_situacao"]
          solicitado_em?: string
          tenant_id?: string
          updated_at?: string
          valor_diaria?: number
          valor_extras?: number
          valor_faturado?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "locacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locacoes_conta_receber_id_fkey"
            columns: ["conta_receber_id"]
            isOneToOne: false
            referencedRelation: "contas_receber"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locacoes_equipamento_id_fkey"
            columns: ["equipamento_id"]
            isOneToOne: false
            referencedRelation: "locacao_equipamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locacoes_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locacoes_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
        ]
      }
      modelo_negocio: {
        Row: {
          custo_equipe_mensal: number
          custo_infra_mensal: number
          custo_marketing_mensal: number
          id: string
          investimento_realizado: number
          meta_clientes_ano1: number
          meta_clientes_ano2: number
          observacoes: string | null
          preco_filial_extra: number
          preco_implantacao: number
          preco_mensal_loja: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          custo_equipe_mensal?: number
          custo_infra_mensal?: number
          custo_marketing_mensal?: number
          id?: string
          investimento_realizado?: number
          meta_clientes_ano1?: number
          meta_clientes_ano2?: number
          observacoes?: string | null
          preco_filial_extra?: number
          preco_implantacao?: number
          preco_mensal_loja?: number
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          custo_equipe_mensal?: number
          custo_infra_mensal?: number
          custo_marketing_mensal?: number
          id?: string
          investimento_realizado?: number
          meta_clientes_ano1?: number
          meta_clientes_ano2?: number
          observacoes?: string | null
          preco_filial_extra?: number
          preco_implantacao?: number
          preco_mensal_loja?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      motoristas: {
        Row: {
          ativo: boolean
          categoria_cnh: string | null
          cnh: string | null
          created_at: string
          empresa_id: string
          filial_id: string | null
          id: string
          nome: string
          observacao: string | null
          telefone: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
          validade_cnh: string | null
          veiculo_id: string | null
        }
        Insert: {
          ativo?: boolean
          categoria_cnh?: string | null
          cnh?: string | null
          created_at?: string
          empresa_id: string
          filial_id?: string | null
          id?: string
          nome: string
          observacao?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
          validade_cnh?: string | null
          veiculo_id?: string | null
        }
        Update: {
          ativo?: boolean
          categoria_cnh?: string | null
          cnh?: string | null
          created_at?: string
          empresa_id?: string
          filial_id?: string | null
          id?: string
          nome?: string
          observacao?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
          validade_cnh?: string | null
          veiculo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motoristas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motoristas_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motoristas_veiculo_id_fkey"
            columns: ["veiculo_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe: {
        Row: {
          ambiente: string
          autorizada_em: string | null
          base_icms: number
          base_icms_st: number
          cancelada_em: string | null
          cfop: string | null
          chave: string | null
          cliente_id: string | null
          codigo_servico: string | null
          created_at: string
          deposito_id: string | null
          destinatario: Json | null
          emitente: Json | null
          emitida_em: string | null
          empresa_id: string | null
          filial_id: string | null
          id: string
          impostos_calculados_em: string | null
          iss_retido: boolean
          locacao_id: string | null
          mensagem: string | null
          modelo: string
          motivo_cancelamento: string | null
          municipio_prestacao: string | null
          natureza_operacao: string
          numero: number | null
          pdf_url: string | null
          pedido_id: string | null
          pendencias: string[]
          protocolo: string | null
          provider: string | null
          provider_id: string | null
          provider_status: string | null
          retorno: Json | null
          serie: number
          situacao: string
          tenant_id: string
          transmitida_em: string | null
          updated_at: string
          valor_cofins: number
          valor_desconto: number
          valor_frete: number
          valor_icms: number
          valor_icms_st: number
          valor_iss: number
          valor_pis: number
          valor_produtos: number
          valor_total: number
          xml_url: string | null
        }
        Insert: {
          ambiente?: string
          autorizada_em?: string | null
          base_icms?: number
          base_icms_st?: number
          cancelada_em?: string | null
          cfop?: string | null
          chave?: string | null
          cliente_id?: string | null
          codigo_servico?: string | null
          created_at?: string
          deposito_id?: string | null
          destinatario?: Json | null
          emitente?: Json | null
          emitida_em?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          impostos_calculados_em?: string | null
          iss_retido?: boolean
          locacao_id?: string | null
          mensagem?: string | null
          modelo?: string
          motivo_cancelamento?: string | null
          municipio_prestacao?: string | null
          natureza_operacao?: string
          numero?: number | null
          pdf_url?: string | null
          pedido_id?: string | null
          pendencias?: string[]
          protocolo?: string | null
          provider?: string | null
          provider_id?: string | null
          provider_status?: string | null
          retorno?: Json | null
          serie?: number
          situacao?: string
          tenant_id?: string
          transmitida_em?: string | null
          updated_at?: string
          valor_cofins?: number
          valor_desconto?: number
          valor_frete?: number
          valor_icms?: number
          valor_icms_st?: number
          valor_iss?: number
          valor_pis?: number
          valor_produtos?: number
          valor_total?: number
          xml_url?: string | null
        }
        Update: {
          ambiente?: string
          autorizada_em?: string | null
          base_icms?: number
          base_icms_st?: number
          cancelada_em?: string | null
          cfop?: string | null
          chave?: string | null
          cliente_id?: string | null
          codigo_servico?: string | null
          created_at?: string
          deposito_id?: string | null
          destinatario?: Json | null
          emitente?: Json | null
          emitida_em?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          impostos_calculados_em?: string | null
          iss_retido?: boolean
          locacao_id?: string | null
          mensagem?: string | null
          modelo?: string
          motivo_cancelamento?: string | null
          municipio_prestacao?: string | null
          natureza_operacao?: string
          numero?: number | null
          pdf_url?: string | null
          pedido_id?: string | null
          pendencias?: string[]
          protocolo?: string | null
          provider?: string | null
          provider_id?: string | null
          provider_status?: string | null
          retorno?: Json | null
          serie?: number
          situacao?: string
          tenant_id?: string
          transmitida_em?: string | null
          updated_at?: string
          valor_cofins?: number
          valor_desconto?: number
          valor_frete?: number
          valor_icms?: number
          valor_icms_st?: number
          valor_iss?: number
          valor_pis?: number
          valor_produtos?: number
          valor_total?: number
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_locacao_id_fkey"
            columns: ["locacao_id"]
            isOneToOne: false
            referencedRelation: "locacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_entrada_produtos: {
        Row: {
          codigo_barras: string | null
          codigo_fornecedor: string
          created_at: string
          fornecedor_id: string | null
          id: string
          produto_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          codigo_barras?: string | null
          codigo_fornecedor: string
          created_at?: string
          fornecedor_id?: string | null
          id?: string
          produto_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          codigo_barras?: string | null
          codigo_fornecedor?: string
          created_at?: string
          fornecedor_id?: string | null
          id?: string
          produto_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_entrada_produtos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_entrada_produtos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_entrada_produtos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_itens: {
        Row: {
          aliquota_cofins: number
          aliquota_icms: number
          aliquota_iss: number
          aliquota_pis: number
          base_icms: number
          base_icms_st: number
          cfop: string | null
          codigo: string | null
          created_at: string
          cst_cofins: string | null
          cst_csosn: string | null
          cst_pis: string | null
          custo_unitario: number
          desconto: number
          descricao: string
          id: string
          ncm: string | null
          nfe_id: string
          preco_unitario: number
          produto_id: string | null
          quantidade: number
          tenant_id: string
          total: number
          unidade: string | null
          valor_cofins: number
          valor_icms: number
          valor_icms_st: number
          valor_iss: number
          valor_pis: number
        }
        Insert: {
          aliquota_cofins?: number
          aliquota_icms?: number
          aliquota_iss?: number
          aliquota_pis?: number
          base_icms?: number
          base_icms_st?: number
          cfop?: string | null
          codigo?: string | null
          created_at?: string
          cst_cofins?: string | null
          cst_csosn?: string | null
          cst_pis?: string | null
          custo_unitario?: number
          desconto?: number
          descricao: string
          id?: string
          ncm?: string | null
          nfe_id: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
          tenant_id?: string
          total?: number
          unidade?: string | null
          valor_cofins?: number
          valor_icms?: number
          valor_icms_st?: number
          valor_iss?: number
          valor_pis?: number
        }
        Update: {
          aliquota_cofins?: number
          aliquota_icms?: number
          aliquota_iss?: number
          aliquota_pis?: number
          base_icms?: number
          base_icms_st?: number
          cfop?: string | null
          codigo?: string | null
          created_at?: string
          cst_cofins?: string | null
          cst_csosn?: string | null
          cst_pis?: string | null
          custo_unitario?: number
          desconto?: number
          descricao?: string
          id?: string
          ncm?: string | null
          nfe_id?: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
          tenant_id?: string
          total?: number
          unidade?: string | null
          valor_cofins?: number
          valor_icms?: number
          valor_icms_st?: number
          valor_iss?: number
          valor_pis?: number
        }
        Relationships: [
          {
            foreignKeyName: "nfe_itens_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_pedidos: {
        Row: {
          created_at: string
          id: string
          nfe_id: string
          pedido_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nfe_id: string
          pedido_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          nfe_id?: string
          pedido_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_pedidos_nfe_id_fkey"
            columns: ["nfe_id"]
            isOneToOne: false
            referencedRelation: "nfe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_pedidos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
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
          profissional_id: string | null
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
          profissional_id?: string | null
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
          profissional_id?: string | null
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
            foreignKeyName: "orcamentos_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "profissionais"
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
      os_itens: {
        Row: {
          created_at: string
          descricao: string
          id: string
          os_id: string
          preco_unitario: number
          produto_id: string | null
          quantidade: number
          tenant_id: string
          tipo: string
          total: number
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          os_id: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
          tenant_id: string
          tipo?: string
          total?: number
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          os_id?: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
          tenant_id?: string
          tipo?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "os_itens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "os_ordens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      os_ordens: {
        Row: {
          abertura: string
          acessorios: string | null
          cliente_id: string | null
          created_at: string
          defeito_relatado: string | null
          desconto: number
          diagnostico: string | null
          empresa_id: string | null
          entregue_em: string | null
          equipamento: string
          filial_id: string | null
          garantia_dias: number
          horas_trabalhadas: number
          id: string
          laudo: string | null
          marca: string | null
          modelo: string | null
          numero: number
          numero_serie: string | null
          observacoes: string | null
          previsao: string | null
          prioridade: string
          situacao: Database["public"]["Enums"]["os_situacao"]
          tecnico_id: string | null
          tecnico_nome: string | null
          tenant_id: string
          updated_at: string
          valor_pecas: number
          valor_servicos: number
          valor_total: number
        }
        Insert: {
          abertura?: string
          acessorios?: string | null
          cliente_id?: string | null
          created_at?: string
          defeito_relatado?: string | null
          desconto?: number
          diagnostico?: string | null
          empresa_id?: string | null
          entregue_em?: string | null
          equipamento: string
          filial_id?: string | null
          garantia_dias?: number
          horas_trabalhadas?: number
          id?: string
          laudo?: string | null
          marca?: string | null
          modelo?: string | null
          numero?: number
          numero_serie?: string | null
          observacoes?: string | null
          previsao?: string | null
          prioridade?: string
          situacao?: Database["public"]["Enums"]["os_situacao"]
          tecnico_id?: string | null
          tecnico_nome?: string | null
          tenant_id: string
          updated_at?: string
          valor_pecas?: number
          valor_servicos?: number
          valor_total?: number
        }
        Update: {
          abertura?: string
          acessorios?: string | null
          cliente_id?: string | null
          created_at?: string
          defeito_relatado?: string | null
          desconto?: number
          diagnostico?: string | null
          empresa_id?: string | null
          entregue_em?: string | null
          equipamento?: string
          filial_id?: string | null
          garantia_dias?: number
          horas_trabalhadas?: number
          id?: string
          laudo?: string | null
          marca?: string | null
          modelo?: string | null
          numero?: number
          numero_serie?: string | null
          observacoes?: string | null
          previsao?: string | null
          prioridade?: string
          situacao?: Database["public"]["Enums"]["os_situacao"]
          tecnico_id?: string | null
          tecnico_nome?: string | null
          tenant_id?: string
          updated_at?: string
          valor_pecas?: number
          valor_servicos?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "os_ordens_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
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
          custo_unitario: number
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
          custo_unitario?: number
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
          custo_unitario?: number
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
      pedido_orcamentos: {
        Row: {
          created_at: string
          id: string
          orcamento_id: string
          pedido_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          orcamento_id: string
          pedido_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          orcamento_id?: string
          pedido_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_orcamentos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_orcamentos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          autorizado_por: string | null
          caixa_id: string | null
          cancelado_por: string | null
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
          origem: string
          previsao_entrega: string | null
          profissional_id: string | null
          situacao: Database["public"]["Enums"]["pedido_situacao"]
          subtotal: number
          tef_autorizacao: string | null
          tef_bandeira: string | null
          tef_credenciadora: string | null
          tef_nsu: string | null
          tenant_id: string
          total: number
          updated_at: string
          vendedor_id: string | null
        }
        Insert: {
          autorizado_por?: string | null
          caixa_id?: string | null
          cancelado_por?: string | null
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
          origem?: string
          previsao_entrega?: string | null
          profissional_id?: string | null
          situacao?: Database["public"]["Enums"]["pedido_situacao"]
          subtotal?: number
          tef_autorizacao?: string | null
          tef_bandeira?: string | null
          tef_credenciadora?: string | null
          tef_nsu?: string | null
          tenant_id: string
          total?: number
          updated_at?: string
          vendedor_id?: string | null
        }
        Update: {
          autorizado_por?: string | null
          caixa_id?: string | null
          cancelado_por?: string | null
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
          origem?: string
          previsao_entrega?: string | null
          profissional_id?: string | null
          situacao?: Database["public"]["Enums"]["pedido_situacao"]
          subtotal?: number
          tef_autorizacao?: string | null
          tef_bandeira?: string | null
          tef_credenciadora?: string | null
          tef_nsu?: string | null
          tenant_id?: string
          total?: number
          updated_at?: string
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "pedidos_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "profissionais"
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
      premiacao_abatimentos: {
        Row: {
          conta_receber_id: string
          created_at: string
          data: string
          id: string
          observacao: string | null
          profissional_id: string
          tenant_id: string
          usuario_id: string | null
          valor: number
        }
        Insert: {
          conta_receber_id: string
          created_at?: string
          data?: string
          id?: string
          observacao?: string | null
          profissional_id: string
          tenant_id: string
          usuario_id?: string | null
          valor: number
        }
        Update: {
          conta_receber_id?: string
          created_at?: string
          data?: string
          id?: string
          observacao?: string | null
          profissional_id?: string
          tenant_id?: string
          usuario_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "premiacao_abatimentos_conta_receber_id_fkey"
            columns: ["conta_receber_id"]
            isOneToOne: false
            referencedRelation: "contas_receber"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premiacao_abatimentos_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "profissionais"
            referencedColumns: ["id"]
          },
        ]
      }
      premiacoes: {
        Row: {
          cliente_id: string | null
          created_at: string
          forma_pagamento: string | null
          id: string
          observacao: string | null
          pago_em: string | null
          pedido_id: string | null
          percentual: number
          profissional_id: string
          situacao: string
          tenant_id: string
          updated_at: string
          valor: number
          valor_base: number
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          forma_pagamento?: string | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          pedido_id?: string | null
          percentual?: number
          profissional_id: string
          situacao?: string
          tenant_id: string
          updated_at?: string
          valor?: number
          valor_base?: number
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          forma_pagamento?: string | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          pedido_id?: string | null
          percentual?: number
          profissional_id?: string
          situacao?: string
          tenant_id?: string
          updated_at?: string
          valor?: number
          valor_base?: number
        }
        Relationships: [
          {
            foreignKeyName: "premiacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premiacoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premiacoes_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "profissionais"
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
      produto_variacoes: {
        Row: {
          ativo: boolean
          codigo_barras: string | null
          cor: string | null
          created_at: string
          id: string
          preco_venda: number | null
          produto_id: string
          tamanho: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo_barras?: string | null
          cor?: string | null
          created_at?: string
          id?: string
          preco_venda?: number | null
          produto_id: string
          tamanho: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo_barras?: string | null
          cor?: string | null
          created_at?: string
          id?: string
          preco_venda?: number | null
          produto_id?: string
          tamanho?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_variacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_variacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          aliquota_icms: number
          altura: number | null
          ativo: boolean
          categoria_id: string | null
          cest: string | null
          cfop: string | null
          codigo_barras: string | null
          codigo_interno: string
          comprimento: number | null
          created_at: string
          cst_csosn: string | null
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
          origem_mercadoria: string | null
          peso: number | null
          preco_venda: number
          tenant_id: string
          unidade: string
          unidade_compra: string | null
          unidade_venda: string | null
          updated_at: string
        }
        Insert: {
          aliquota_icms?: number
          altura?: number | null
          ativo?: boolean
          categoria_id?: string | null
          cest?: string | null
          cfop?: string | null
          codigo_barras?: string | null
          codigo_interno: string
          comprimento?: number | null
          created_at?: string
          cst_csosn?: string | null
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
          origem_mercadoria?: string | null
          peso?: number | null
          preco_venda?: number
          tenant_id: string
          unidade?: string
          unidade_compra?: string | null
          unidade_venda?: string | null
          updated_at?: string
        }
        Update: {
          aliquota_icms?: number
          altura?: number | null
          ativo?: boolean
          categoria_id?: string | null
          cest?: string | null
          cfop?: string | null
          codigo_barras?: string | null
          codigo_interno?: string
          comprimento?: number | null
          created_at?: string
          cst_csosn?: string | null
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
          origem_mercadoria?: string | null
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
          cargo: string | null
          codigo: string | null
          created_at: string
          data_admissao: string | null
          data_demissao: string | null
          email: string | null
          empresa_id: string | null
          filial_id: string | null
          id: string
          nome: string
          pode_abrir_caixa: boolean
          pode_ver_fechamento: boolean
          telefone: string | null
          tenant_id: string | null
          updated_at: string
          vender_outras_lojas: boolean
        }
        Insert: {
          ativo?: boolean
          cargo?: string | null
          codigo?: string | null
          created_at?: string
          data_admissao?: string | null
          data_demissao?: string | null
          email?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id: string
          nome?: string
          pode_abrir_caixa?: boolean
          pode_ver_fechamento?: boolean
          telefone?: string | null
          tenant_id?: string | null
          updated_at?: string
          vender_outras_lojas?: boolean
        }
        Update: {
          ativo?: boolean
          cargo?: string | null
          codigo?: string | null
          created_at?: string
          data_admissao?: string | null
          data_demissao?: string | null
          email?: string | null
          empresa_id?: string | null
          filial_id?: string | null
          id?: string
          nome?: string
          pode_abrir_caixa?: boolean
          pode_ver_fechamento?: boolean
          telefone?: string | null
          tenant_id?: string | null
          updated_at?: string
          vender_outras_lojas?: boolean
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
      profissionais: {
        Row: {
          ativo: boolean
          chave_pix: string | null
          cliente_id: string | null
          cnpj: string | null
          codigo: string | null
          cpf: string | null
          created_at: string
          email: string | null
          empresa_id: string | null
          id: string
          nome: string
          observacoes: string | null
          percentual_premio: number
          telefone: string | null
          tenant_id: string
          tipo: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          ativo?: boolean
          chave_pix?: string | null
          cliente_id?: string | null
          cnpj?: string | null
          codigo?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          empresa_id?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          percentual_premio?: number
          telefone?: string | null
          tenant_id: string
          tipo?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          ativo?: boolean
          chave_pix?: string | null
          cliente_id?: string | null
          cnpj?: string | null
          codigo?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          empresa_id?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          percentual_premio?: number
          telefone?: string | null
          tenant_id?: string
          tipo?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profissionais_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profissionais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
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
      saas_clientes: {
        Row: {
          admin_criado_em: string | null
          admin_email: string | null
          admin_user_id: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          created_at: string
          dia_vencimento: number
          documento: string | null
          email: string | null
          endereco: string | null
          filiais_extras: number
          id: string
          implantacao_paga: boolean
          inicio: string
          nome: string
          numero: string | null
          observacoes: string | null
          plano_id: string | null
          prazo_meses: number
          responsavel: string | null
          situacao: string
          telefone: string | null
          tenant_id: string | null
          teste_ate: string | null
          uf: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          admin_criado_em?: string | null
          admin_email?: string | null
          admin_user_id?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          created_at?: string
          dia_vencimento?: number
          documento?: string | null
          email?: string | null
          endereco?: string | null
          filiais_extras?: number
          id?: string
          implantacao_paga?: boolean
          inicio?: string
          nome: string
          numero?: string | null
          observacoes?: string | null
          plano_id?: string | null
          prazo_meses?: number
          responsavel?: string | null
          situacao?: string
          telefone?: string | null
          tenant_id?: string | null
          teste_ate?: string | null
          uf?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          admin_criado_em?: string | null
          admin_email?: string | null
          admin_user_id?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          created_at?: string
          dia_vencimento?: number
          documento?: string | null
          email?: string | null
          endereco?: string | null
          filiais_extras?: number
          id?: string
          implantacao_paga?: boolean
          inicio?: string
          nome?: string
          numero?: string | null
          observacoes?: string | null
          plano_id?: string | null
          prazo_meses?: number
          responsavel?: string | null
          situacao?: string
          telefone?: string | null
          tenant_id?: string | null
          teste_ate?: string | null
          uf?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_clientes_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "saas_planos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_clientes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_config: {
        Row: {
          banco: string | null
          beneficiario: string
          chave_pix: string | null
          cidade: string
          documento: string | null
          email_cobranca: string | null
          id: boolean
          instrucoes: string | null
          updated_at: string
          whatsapp_cobranca: string | null
        }
        Insert: {
          banco?: string | null
          beneficiario?: string
          chave_pix?: string | null
          cidade?: string
          documento?: string | null
          email_cobranca?: string | null
          id?: boolean
          instrucoes?: string | null
          updated_at?: string
          whatsapp_cobranca?: string | null
        }
        Update: {
          banco?: string | null
          beneficiario?: string
          chave_pix?: string | null
          cidade?: string
          documento?: string | null
          email_cobranca?: string | null
          id?: boolean
          instrucoes?: string | null
          updated_at?: string
          whatsapp_cobranca?: string | null
        }
        Relationships: []
      }
      saas_contas_pagar: {
        Row: {
          categoria: string | null
          cliente_id: string | null
          created_at: string
          descricao: string
          forma_pagamento: string | null
          fornecedor: string | null
          id: string
          loja_id: string | null
          observacoes: string | null
          pago_em: string | null
          situacao: string
          updated_at: string
          valor: number
          valor_pago: number
          vencimento: string
        }
        Insert: {
          categoria?: string | null
          cliente_id?: string | null
          created_at?: string
          descricao: string
          forma_pagamento?: string | null
          fornecedor?: string | null
          id?: string
          loja_id?: string | null
          observacoes?: string | null
          pago_em?: string | null
          situacao?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento: string
        }
        Update: {
          categoria?: string | null
          cliente_id?: string | null
          created_at?: string
          descricao?: string
          forma_pagamento?: string | null
          fornecedor?: string | null
          id?: string
          loja_id?: string | null
          observacoes?: string | null
          pago_em?: string | null
          situacao?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_contas_pagar_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "saas_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_contas_pagar_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "saas_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_faturas: {
        Row: {
          boleto_linha_digitavel: string | null
          boleto_url: string | null
          cliente_id: string
          competencia: string | null
          created_at: string
          descricao: string
          enviado_canal: string | null
          enviado_em: string | null
          forma_cobranca: string | null
          forma_pagamento: string | null
          id: string
          observacao: string | null
          pago_em: string | null
          pix_copia_cola: string | null
          tipo: string
          updated_at: string
          valor: number
          valor_pago: number
          vencimento: string
        }
        Insert: {
          boleto_linha_digitavel?: string | null
          boleto_url?: string | null
          cliente_id: string
          competencia?: string | null
          created_at?: string
          descricao: string
          enviado_canal?: string | null
          enviado_em?: string | null
          forma_cobranca?: string | null
          forma_pagamento?: string | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          pix_copia_cola?: string | null
          tipo?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento: string
        }
        Update: {
          boleto_linha_digitavel?: string | null
          boleto_url?: string | null
          cliente_id?: string
          competencia?: string | null
          created_at?: string
          descricao?: string
          enviado_canal?: string | null
          enviado_em?: string | null
          forma_cobranca?: string | null
          forma_pagamento?: string | null
          id?: string
          observacao?: string | null
          pago_em?: string | null
          pix_copia_cola?: string | null
          tipo?: string
          updated_at?: string
          valor?: number
          valor_pago?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_faturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "saas_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_lojas: {
        Row: {
          abertura: string | null
          apelido: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          cliente_id: string
          complemento: string | null
          created_at: string
          documento: string | null
          email: string | null
          endereco: string | null
          id: string
          implantacao_paga: boolean
          nome: string
          numero: string | null
          observacoes: string | null
          responsavel: string | null
          situacao: string
          telefone: string | null
          tipo: string
          uf: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          abertura?: string | null
          apelido?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cliente_id: string
          complemento?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          implantacao_paga?: boolean
          nome: string
          numero?: string | null
          observacoes?: string | null
          responsavel?: string | null
          situacao?: string
          telefone?: string | null
          tipo?: string
          uf?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          abertura?: string | null
          apelido?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cliente_id?: string
          complemento?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          implantacao_paga?: boolean
          nome?: string
          numero?: string | null
          observacoes?: string | null
          responsavel?: string | null
          situacao?: string
          telefone?: string | null
          tipo?: string
          uf?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_lojas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "saas_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_operadores: {
        Row: {
          created_at: string
          nome: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          nome?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          nome?: string | null
          user_id?: string
        }
        Relationships: []
      }
      saas_planos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          dias_teste: number
          id: string
          nome: string
          ordem: number
          prazo_meses: number
          recursos: string[]
          resumo: string | null
          updated_at: string
          valor_filial_extra: number
          valor_implantacao: number
          valor_mensal: number
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          dias_teste?: number
          id?: string
          nome: string
          ordem?: number
          prazo_meses?: number
          recursos?: string[]
          resumo?: string | null
          updated_at?: string
          valor_filial_extra?: number
          valor_implantacao?: number
          valor_mensal?: number
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          dias_teste?: number
          id?: string
          nome?: string
          ordem?: number
          prazo_meses?: number
          recursos?: string[]
          resumo?: string | null
          updated_at?: string
          valor_filial_extra?: number
          valor_implantacao?: number
          valor_mensal?: number
        }
        Relationships: []
      }
      tecnicos: {
        Row: {
          admissao: string | null
          ativo: boolean
          cargo: string | null
          comissao_percentual: number
          created_at: string
          custo_hora: number
          demissao: string | null
          documento: string | null
          email: string | null
          empresa_id: string | null
          especialidade: string | null
          filial_id: string | null
          id: string
          nome: string
          observacoes: string | null
          telefone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admissao?: string | null
          ativo?: boolean
          cargo?: string | null
          comissao_percentual?: number
          created_at?: string
          custo_hora?: number
          demissao?: string | null
          documento?: string | null
          email?: string | null
          empresa_id?: string | null
          especialidade?: string | null
          filial_id?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          admissao?: string | null
          ativo?: boolean
          cargo?: string | null
          comissao_percentual?: number
          created_at?: string
          custo_hora?: number
          demissao?: string | null
          documento?: string | null
          email?: string | null
          empresa_id?: string | null
          especialidade?: string | null
          filial_id?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          telefone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tecnicos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tecnicos_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
        ]
      }
      tef_config: {
        Row: {
          ativo: boolean
          cnpj_credenciadora: string | null
          codigo_estabelecimento: string | null
          contrato: string | null
          created_at: string
          credenciadora: string
          exigir_nsu: boolean
          filial_id: string | null
          id: string
          modo: string
          observacoes: string | null
          parcelas_max: number
          parcelas_sem_juros: number
          ponte_url: string | null
          taxa_credito: number
          taxa_debito: number
          taxa_parcelado: number
          tenant_id: string
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cnpj_credenciadora?: string | null
          codigo_estabelecimento?: string | null
          contrato?: string | null
          created_at?: string
          credenciadora?: string
          exigir_nsu?: boolean
          filial_id?: string | null
          id?: string
          modo?: string
          observacoes?: string | null
          parcelas_max?: number
          parcelas_sem_juros?: number
          ponte_url?: string | null
          taxa_credito?: number
          taxa_debito?: number
          taxa_parcelado?: number
          tenant_id?: string
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cnpj_credenciadora?: string | null
          codigo_estabelecimento?: string | null
          contrato?: string | null
          created_at?: string
          credenciadora?: string
          exigir_nsu?: boolean
          filial_id?: string | null
          id?: string
          modo?: string
          observacoes?: string | null
          parcelas_max?: number
          parcelas_sem_juros?: number
          ponte_url?: string | null
          taxa_credito?: number
          taxa_debito?: number
          taxa_parcelado?: number
          tenant_id?: string
          terminal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tef_config_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
        ]
      }
      tef_transacoes: {
        Row: {
          autorizacao: string | null
          bandeira: string | null
          caixa_id: string | null
          created_at: string
          credenciadora: string | null
          filial_id: string | null
          forma: string | null
          id: string
          motivo: string | null
          nsu: string | null
          operador_id: string | null
          parcelas: number
          pedido_id: string | null
          status: string
          tenant_id: string
          valor: number
        }
        Insert: {
          autorizacao?: string | null
          bandeira?: string | null
          caixa_id?: string | null
          created_at?: string
          credenciadora?: string | null
          filial_id?: string | null
          forma?: string | null
          id?: string
          motivo?: string | null
          nsu?: string | null
          operador_id?: string | null
          parcelas?: number
          pedido_id?: string | null
          status: string
          tenant_id: string
          valor?: number
        }
        Update: {
          autorizacao?: string | null
          bandeira?: string | null
          caixa_id?: string | null
          created_at?: string
          credenciadora?: string | null
          filial_id?: string | null
          forma?: string | null
          id?: string
          motivo?: string | null
          nsu?: string | null
          operador_id?: string | null
          parcelas?: number
          pedido_id?: string | null
          status?: string
          tenant_id?: string
          valor?: number
        }
        Relationships: []
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
      transferencia_itens: {
        Row: {
          created_at: string
          custo_unitario: number
          id: string
          observacao: string | null
          produto_id: string
          quantidade: number
          quantidade_recebida: number | null
          tenant_id: string
          transferencia_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          id?: string
          observacao?: string | null
          produto_id: string
          quantidade: number
          quantidade_recebida?: number | null
          tenant_id: string
          transferencia_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          id?: string
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          quantidade_recebida?: number | null
          tenant_id?: string
          transferencia_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencia_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencia_itens_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "transferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      transferencias: {
        Row: {
          created_at: string
          deposito_destino_id: string
          deposito_origem_id: string
          empresa_destino_id: string | null
          empresa_origem_id: string | null
          enviado_em: string | null
          enviado_por: string | null
          filial_destino_id: string | null
          filial_origem_id: string | null
          id: string
          numero: number | null
          observacao: string | null
          recebido_em: string | null
          recebido_por: string | null
          situacao: string
          tenant_id: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          created_at?: string
          deposito_destino_id: string
          deposito_origem_id: string
          empresa_destino_id?: string | null
          empresa_origem_id?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          filial_destino_id?: string | null
          filial_origem_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          recebido_em?: string | null
          recebido_por?: string | null
          situacao?: string
          tenant_id: string
          updated_at?: string
          valor_total?: number
        }
        Update: {
          created_at?: string
          deposito_destino_id?: string
          deposito_origem_id?: string
          empresa_destino_id?: string | null
          empresa_origem_id?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          filial_destino_id?: string | null
          filial_origem_id?: string | null
          id?: string
          numero?: number | null
          observacao?: string | null
          recebido_em?: string | null
          recebido_por?: string | null
          situacao?: string
          tenant_id?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "transferencias_deposito_destino_id_fkey"
            columns: ["deposito_destino_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_deposito_origem_id_fkey"
            columns: ["deposito_origem_id"]
            isOneToOne: false
            referencedRelation: "depositos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_empresa_destino_id_fkey"
            columns: ["empresa_destino_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_empresa_origem_id_fkey"
            columns: ["empresa_origem_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_filial_destino_id_fkey"
            columns: ["filial_destino_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_filial_origem_id_fkey"
            columns: ["filial_origem_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
        ]
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
      veiculos: {
        Row: {
          ativo: boolean
          capacidade_kg: number | null
          capacidade_m3: number | null
          created_at: string
          descricao: string
          empresa_id: string
          filial_id: string | null
          id: string
          observacao: string | null
          placa: string
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          capacidade_kg?: number | null
          capacidade_m3?: number | null
          created_at?: string
          descricao: string
          empresa_id: string
          filial_id?: string | null
          id?: string
          observacao?: string | null
          placa: string
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          capacidade_kg?: number | null
          capacidade_m3?: number | null
          created_at?: string
          descricao?: string
          empresa_id?: string
          filial_id?: string | null
          id?: string
          observacao?: string | null
          placa?: string
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "veiculos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "veiculos_filial_id_fkey"
            columns: ["filial_id"]
            isOneToOne: false
            referencedRelation: "filiais"
            referencedColumns: ["id"]
          },
        ]
      }
      vendedor_comissao_regras: {
        Row: {
          ativo: boolean
          base: string
          created_at: string
          empresa_id: string | null
          id: string
          observacoes: string | null
          percentual: number
          tenant_id: string
          updated_at: string
          venda_minima: number
          vendedor_id: string
        }
        Insert: {
          ativo?: boolean
          base?: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          observacoes?: string | null
          percentual?: number
          tenant_id?: string
          updated_at?: string
          venda_minima?: number
          vendedor_id: string
        }
        Update: {
          ativo?: boolean
          base?: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          observacoes?: string | null
          percentual?: number
          tenant_id?: string
          updated_at?: string
          venda_minima?: number
          vendedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendedor_comissao_regras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendedor_comissao_regras_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_eventos: {
        Row: {
          erro: string | null
          event_id: string
          id: string
          payload: Json
          processado_em: string | null
          provedor: string
          recebido_em: string
          status: string
          tenant_id: string | null
          tentativas: number
        }
        Insert: {
          erro?: string | null
          event_id: string
          id?: string
          payload: Json
          processado_em?: string | null
          provedor: string
          recebido_em?: string
          status?: string
          tenant_id?: string | null
          tentativas?: number
        }
        Update: {
          erro?: string | null
          event_id?: string
          id?: string
          payload?: Json
          processado_em?: string | null
          provedor?: string
          recebido_em?: string
          status?: string
          tenant_id?: string | null
          tentativas?: number
        }
        Relationships: [
          {
            foreignKeyName: "webhook_eventos_tenant_id_fkey"
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
      assistencia_ordens_relatorio: {
        Args: { p_ate: string; p_de: string; p_filial_id?: string }
        Returns: {
          abertura: string
          cliente: string
          defeito_relatado: string
          desconto: number
          entregue_em: string
          equipamento: string
          filial: string
          filial_id: string
          horas_trabalhadas: number
          laudo: string
          marca: string
          modelo: string
          numero: number
          os_id: string
          prioridade: string
          situacao: string
          tecnico: string
          valor_pecas: number
          valor_servicos: number
          valor_total: number
        }[]
      }
      assistencia_por_filial: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          abertas: number
          canceladas: number
          codigo: string
          em_reparo: number
          encerradas: number
          filial: string
          filial_id: string
          pendentes: number
          ticket_medio: number
          ultima_abertura: string
          valor_pecas: number
          valor_servicos: number
          valor_total: number
        }[]
      }
      atualizar_custo_medio: {
        Args: {
          p_custo: number
          p_deposito_id: string
          p_produto_id: string
          p_qtd_entrada: number
        }
        Returns: number
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
      banco_conciliar: {
        Args: { p_conciliado?: boolean; p_mov_id: string }
        Returns: undefined
      }
      banco_conta_padrao: {
        Args: { p_filial?: string; p_tenant: string }
        Returns: string
      }
      banco_lancar: {
        Args: {
          p_categoria?: string
          p_conta_id: string
          p_data?: string
          p_descricao: string
          p_documento?: string
          p_tipo: string
          p_valor: number
        }
        Returns: string
      }
      banco_saldo: {
        Args: { p_ate?: string; p_conta_id: string }
        Returns: number
      }
      banco_transferir: {
        Args: {
          p_data?: string
          p_destino_id: string
          p_observacao?: string
          p_origem_id: string
          p_valor: number
        }
        Returns: string
      }
      caixa_lancar: {
        Args: {
          p_caixa_id: string
          p_deposito_id?: string
          p_descricao?: string
          p_forma?: Database["public"]["Enums"]["forma_pagamento"]
          p_pedido_id?: string
          p_tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
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
      comissionar_pedido_id: { Args: { p_pedido_id: string }; Returns: boolean }
      compra_aplicar_cotacao: {
        Args: { p_cotacao_id: string }
        Returns: undefined
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
      consumir_autorizacao: {
        Args: { p_acao: string; p_id: string }
        Returns: string
      }
      converter_orcamento_em_pedido: {
        Args: { p_deposito_id: string; p_orcamento_id: string }
        Returns: string
      }
      converter_orcamentos_em_pedido: {
        Args: { p_deposito_id: string; p_orcamento_ids: string[] }
        Returns: string
      }
      cotacao_registrar_itens: {
        Args: {
          p_condicao_pagamento?: string
          p_cotacao_id: string
          p_itens: Json
          p_observacao?: string
          p_prazo_entrega_dias?: number
        }
        Returns: number
      }
      criar_pedido_direto: {
        Args: {
          p_cliente_id: string
          p_condicao_pagamento?: string
          p_deposito_id: string
          p_desconto?: number
          p_frete?: number
          p_itens: Json
          p_obra_id?: string
          p_observacoes?: string
          p_previsao_entrega?: string
          p_profissional_id?: string
          p_vendedor_id?: string
        }
        Returns: string
      }
      current_motorista_id: { Args: never; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      decidir_autorizacao_credito: {
        Args: { p_aprovar: boolean; p_id: string; p_observacao?: string }
        Returns: undefined
      }
      devolucao_registrar: {
        Args: {
          p_abater_receber?: boolean
          p_deposito_id?: string
          p_itens: Json
          p_modo?: string
          p_motivo?: string
          p_pedido_id: string
        }
        Returns: string
      }
      eh_motorista_restrito: { Args: never; Returns: boolean }
      eh_saas_operador: { Args: never; Returns: boolean }
      entrega_concluir: {
        Args: {
          p_assinatura?: string
          p_documento?: string
          p_entrega_id: string
          p_foto_url?: string
          p_itens?: Json
          p_latitude?: number
          p_longitude?: number
          p_observacao?: string
          p_recebedor: string
        }
        Returns: undefined
      }
      entrega_iniciar_rota: {
        Args: { p_entrega_id: string }
        Returns: undefined
      }
      entrega_insucesso: {
        Args: { p_entrega_id: string; p_motivo: string; p_observacao?: string }
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
      frente_abrir_caixa: {
        Args: { p_filial_id: string; p_valor_abertura?: number }
        Returns: string
      }
      frente_caixa_atual: { Args: never; Returns: string }
      frente_cancelar_venda: {
        Args: { p_autorizacao: string; p_motivo: string; p_pedido_id: string }
        Returns: undefined
      }
      frente_movimento: {
        Args: {
          p_autorizacao?: string
          p_descricao: string
          p_tipo: Database["public"]["Enums"]["caixa_mov_tipo"]
          p_valor: number
        }
        Returns: string
      }
      frente_registrar_tef: {
        Args: {
          p_autorizacao: string
          p_bandeira: string
          p_credenciadora: string
          p_nsu: string
          p_pedido_id: string
        }
        Returns: undefined
      }
      frente_venda: {
        Args: {
          p_autorizacao?: string
          p_cliente_id?: string
          p_deposito_id: string
          p_desconto?: number
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
          p_itens: Json
          p_parcelas?: number
          p_primeiro_vencimento?: string
        }
        Returns: string
      }
      gerar_comissoes: { Args: never; Returns: number }
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
      gerar_faturas_assinatura: { Args: never; Returns: number }
      gerar_nfe: {
        Args: { p_natureza?: string; p_pedido_id: string }
        Returns: string
      }
      gerar_nfe_agrupada: {
        Args: { p_natureza?: string; p_pedido_ids: string[] }
        Returns: string
      }
      gerar_premiacoes: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      importar_nfe_entrada: {
        Args: {
          p_deposito_id: string
          p_fornecedor: Json
          p_gerar_conta?: boolean
          p_itens: Json
          p_nota: Json
          p_parcelas?: number
          p_vencimento?: string
        }
        Returns: Json
      }
      inventario_abrir: {
        Args: { p_deposito_id: string; p_descricao?: string }
        Returns: string
      }
      inventario_aplicar: { Args: { p_inventario_id: string }; Returns: number }
      inventario_cancelar: {
        Args: { p_inventario_id: string; p_motivo?: string }
        Returns: undefined
      }
      inventario_contar: {
        Args: { p_contada: number; p_item_id: string; p_observacao?: string }
        Returns: undefined
      }
      locacao_aprovar: { Args: { p_locacao_id: string }; Returns: undefined }
      locacao_balcao_registrar: {
        Args: {
          p_caixa_id?: string
          p_caucao?: number
          p_cliente_id: string
          p_dias?: number
          p_entregar?: boolean
          p_forma?: Database["public"]["Enums"]["forma_pagamento"]
          p_gerar_nfse?: boolean
          p_inicio?: string
          p_itens: Json
          p_obra_id?: string
          p_observacoes?: string
          p_parcelas?: number
          p_vencimento?: string
        }
        Returns: Json
      }
      locacao_devolver: {
        Args: {
          p_data?: string
          p_locacao_id: string
          p_multa?: number
          p_observacao?: string
        }
        Returns: number
      }
      locacao_entregar: {
        Args: { p_data?: string; p_locacao_id: string }
        Returns: undefined
      }
      locacao_faturar: {
        Args: {
          p_caixa_id?: string
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
          p_locacao_id: string
          p_parcelas?: number
          p_primeiro_vencimento?: string
        }
        Returns: string
      }
      locacao_gerar_nfe: { Args: { p_locacao_id: string }; Returns: string }
      locacao_gerar_nfse: { Args: { p_locacao_id: string }; Returns: string }
      nfe_calcular_impostos: {
        Args: {
          p_aliquota_cofins?: number
          p_aliquota_icms?: number
          p_aliquota_iss?: number
          p_aliquota_pis?: number
          p_aplicar_icms_em_todos?: boolean
          p_nfe_id: string
          p_reducao_base?: number
        }
        Returns: Json
      }
      nfe_preencher_destinatario: { Args: { p_nfe_id: string }; Returns: Json }
      onboarding_criar_espaco: { Args: { p_nome: string }; Returns: string }
      operador_definir_permissoes: {
        Args: { p_abrir: boolean; p_user_id: string; p_ver: boolean }
        Returns: undefined
      }
      painel_fiscal_loja: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          cofins: number
          entradas: number
          filial: string
          filial_id: string
          icms: number
          icms_st: number
          impostos: number
          iss: number
          notas: number
          pis: number
          saidas: number
          saldo_estoque: number
          valor_notas: number
        }[]
      }
      pdv_venda: {
        Args: {
          p_cliente_id?: string
          p_deposito_id: string
          p_desconto?: number
          p_forma?: Database["public"]["Enums"]["forma_pagamento"]
          p_itens: Json
          p_observacao?: string
          p_parcelas?: number
          p_primeiro_vencimento?: string
        }
        Returns: string
      }
      pedido_avancar_status: {
        Args: {
          p_observacao?: string
          p_pedido_id: string
          p_situacao: Database["public"]["Enums"]["pedido_situacao"]
        }
        Returns: undefined
      }
      pedido_checkout: {
        Args: {
          p_forma?: Database["public"]["Enums"]["forma_pagamento"]
          p_observacao?: string
          p_parcelas?: number
          p_pedido_id: string
          p_primeiro_vencimento?: string
          p_valor: number
        }
        Returns: Json
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
      planejar_entrega: {
        Args: {
          p_itens: Json
          p_motorista_id?: string
          p_observacao?: string
          p_pedido_id: string
          p_previsao?: string
          p_sequencia?: number
          p_veiculo_id?: string
        }
        Returns: string
      }
      premiacao_abater_conta: {
        Args: {
          p_conta_id: string
          p_observacao?: string
          p_profissional_id: string
          p_valor: number
        }
        Returns: string
      }
      profissional_converter_em_cliente: {
        Args: { p_profissional_id: string }
        Returns: string
      }
      profissional_saldo_credito: {
        Args: { p_profissional_id: string }
        Returns: number
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
          p_custo?: number
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
      relatorio_fechamento_operador: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          aberto_em: string
          abertura: number
          caixa_id: string
          cancelamentos: number
          cartao_credito: number
          cartao_debito: number
          diferenca: number
          dinheiro: number
          esperado: number
          fechado_em: string
          informado: number
          numero: number
          operador: string
          operador_id: string
          outras: number
          pix: number
          qtd_cancelamentos: number
          qtd_vendas: number
          sangrias: number
          situacao: string
          suprimentos: number
          vendas: number
        }[]
      }
      saas_assistencia_por_cliente: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          abertas: number
          canceladas: number
          cliente: string
          cliente_id: string
          em_reparo: number
          encerradas: number
          pendentes: number
          plano: string
          tenant_id: string
          ticket_medio: number
          ultima_abertura: string
          valor_pecas: number
          valor_servicos: number
          valor_total: number
        }[]
      }
      saas_baixar_fatura: {
        Args: {
          p_data?: string
          p_fatura_id: string
          p_forma?: string
          p_valor: number
        }
        Returns: undefined
      }
      saas_custo_por_tecnico: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          cargo: string
          cliente: string
          cliente_id: string
          comissao: number
          comissao_percentual: number
          custo_hora: number
          custo_mao_obra: number
          custo_total: number
          encerradas: number
          especialidade: string
          horas: number
          ordens: number
          tecnico: string
          tecnico_id: string
          tenant_id: string
          ultima_ordem: string
          valor_pecas: number
          valor_servicos: number
        }[]
      }
      saas_fiscal_por_periodo: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          cliente: string
          cliente_id: string
          cofins: number
          entradas: number
          icms: number
          icms_st: number
          impostos: number
          iss: number
          iss_servico: number
          notas: number
          notas_servico: number
          notas_venda: number
          pis: number
          plano: string
          saidas: number
          saldo_estoque: number
          tenant_id: string
          valor_notas: number
          valor_notas_servico: number
          valor_notas_venda: number
        }[]
      }
      saas_gerar_faturas: { Args: never; Returns: number }
      saas_marcar_enviada: {
        Args: { p_canal?: string; p_fatura_id: string }
        Returns: undefined
      }
      saas_notas_por_cliente: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          autorizadas: number
          canceladas: number
          cliente: string
          cliente_id: string
          impostos: number
          notas: number
          plano: string
          rascunhos: number
          tenant_id: string
          ultima_emissao: string
          valor_total: number
        }[]
      }
      saas_registrar_cobranca: {
        Args: {
          p_boleto_url?: string
          p_cliente_id: string
          p_competencia?: string
          p_descricao: string
          p_forma?: string
          p_linha_digitavel?: string
          p_observacao?: string
          p_pix?: string
          p_tipo?: string
          p_valor: number
          p_vencimento: string
        }
        Returns: string
      }
      saas_sincronizar_filiais: {
        Args: { p_cliente_id: string }
        Returns: number
      }
      saas_tempo_real_por_cliente: {
        Args: { p_ate: string; p_de: string }
        Returns: {
          cliente: string
          cliente_id: string
          impostos: number
          locacoes: number
          locacoes_abertas: number
          notas: number
          notas_autorizadas: number
          notas_servico: number
          os_abertas: number
          os_custo: number
          os_pendentes: number
          pedidos: number
          plano: string
          situacao: string
          tenant_id: string
          ultima_locacao: string
          ultima_nota: string
          ultima_os: string
          ultima_venda: string
          valor_locacoes: number
          valor_notas: number
          valor_notas_servico: number
          valor_vendas: number
        }[]
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
      tef_registrar_negada: {
        Args: {
          p_bandeira: string
          p_credenciadora: string
          p_filial_id: string
          p_forma: string
          p_motivo: string
          p_parcelas: number
          p_valor: number
        }
        Returns: string
      }
      transferencia_cancelar: {
        Args: { p_id: string; p_motivo?: string }
        Returns: undefined
      }
      transferencia_criar: {
        Args: {
          p_deposito_destino_id: string
          p_deposito_origem_id: string
          p_itens: Json
          p_observacao?: string
        }
        Returns: string
      }
      transferencia_enviar: { Args: { p_id: string }; Returns: undefined }
      transferencia_receber: {
        Args: { p_id: string; p_itens?: Json; p_observacao?: string }
        Returns: undefined
      }
      webhook_concluir: {
        Args: {
          p_erro?: string
          p_event_id: string
          p_provedor: string
          p_status: string
          p_tentativa: number
        }
        Returns: boolean
      }
      webhook_registrar: {
        Args: {
          p_event_id: string
          p_payload?: Json
          p_provedor: string
          p_tenant_id?: string
        }
        Returns: Json
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
      locacao_situacao: "reservada" | "em_andamento" | "devolvida" | "cancelada"
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
      os_situacao:
        | "aberta"
        | "em_analise"
        | "orcamento"
        | "aprovada"
        | "em_reparo"
        | "pronta"
        | "entregue"
        | "cancelada"
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
      locacao_situacao: ["reservada", "em_andamento", "devolvida", "cancelada"],
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
      os_situacao: [
        "aberta",
        "em_analise",
        "orcamento",
        "aprovada",
        "em_reparo",
        "pronta",
        "entregue",
        "cancelada",
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
