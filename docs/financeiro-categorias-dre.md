# Categorias financeiras e DRE

Migração `20270111000000_financeiro_categorias_dre.sql`. Telas: `/financeiro-categorias` (cadastro) e `/dre` (relatório).
Quem usa: administrador, gestor e financeiro (o banco confere; a tela mostra "acesso restrito" aos demais).

## Categorias
- Tabela `financeiro_categorias` (por empresa): nome, tipo (`receita` ou `despesa`), **grupo do DRE** e ativa. Nasce vazia.
  Só por função (`financeiro_categoria_salvar`); nunca se apaga, só se desativa. Nome repetido (sem diferenciar maiúsculas) é recusado.
- "Criar categorias padrão" (`financeiro_categorias_padrao`) só funciona em empresa sem nenhuma categoria.
- "Importar dos lançamentos antigos" (`financeiro_categorias_importar_texto`) cria categorias a partir do texto livre de
  `contas_pagar.categoria` e liga os títulos. "Mercadorias" (o que o recebimento de compra grava) vira
  "Compra de mercadorias (estoque)", **fora do DRE**.
- `contas_pagar.categoria_id` e `contas_receber.categoria_id`: um gatilho confere que a categoria é da mesma empresa, do tipo
  certo (despesa em conta a pagar, receita em conta a receber) e ativa. O texto antigo `categoria` continua (recebe o nome).
- `conta_pagar_parcelar` e `conta_receber_parcelar` aceitam `p_categoria_id`; títulos já lançados trocam a categoria pelo botão
  "Categoria" nas telas de contas.

## Grupos e linhas do DRE
| Tipo | Grupo | Onde aparece |
|---|---|---|
| receita | operacional | Receita bruta (outras receitas) |
| receita | financeira | Resultado financeiro |
| despesa | deducao | Receita líquida (impostos sobre vendas) |
| despesa | custo | Lucro bruto (custos diretos, além do CMV) |
| despesa | operacional | Resultado operacional |
| despesa | financeira | Resultado financeiro |
| despesa | impostos_lucro | Resultado líquido |
| ambos | fora_dre | não entra (estoque, investimento, retirada de sócio) |

## De onde vêm os números (`financeiro_dre(de, até, filial)`)
- **Vendas**: pedidos que já saíram de rascunho/aguardando pagamento e não foram cancelados, pela data do pedido (fuso de Brasília).
- **CMV**: quantidade × custo gravado nos itens desses pedidos.
- **Devoluções**: `devolucoes.valor_total` pela data da devolução.
- **Outras receitas e despesas**: títulos não cancelados pelo **vencimento** e pela categoria. Título gerado por pedido não entra
  de novo (já está em vendas). Compra de mercadoria **sem categoria** não vira despesa (o custo vem do CMV). Sem categoria, o
  lançamento aparece como "Sem categoria" (operacional) e a tela avisa.
- Respeita o acesso por filial (`pode_filial`). Período de no máximo 5 anos.

## Limites conhecidos
- É gerencial por vencimento, não regime de caixa nem contabilidade. Falta data de competência no título.
- Receita que não passa por pedido só entra se tiver título a receber. Não conferi se hotelaria e conta do restaurante geram pedido: confirme com dados reais antes de confiar no total de vendas desses ramos.
- Devolução não estorna o custo (CMV) da mercadoria devolvida.
