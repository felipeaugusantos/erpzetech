# Ajustes de venda: cliente por digitação, venda fracionada, novo pedido e códigos

## 1. Escolher cliente digitando o nome

Hoje o cliente é escolhido numa lista suspensa. Vou criar um campo único de busca: você começa a digitar o nome (ou CPF/CNPJ/telefone) e as opções aparecem filtradas, com teclado e toque no celular.

Onde passa a valer:
- PDV de venda rápida (com a opção "Consumidor final" sempre no topo)
- Novo orçamento
- Novo pedido
- Cadastro de obras (Obras e Clientes e obras)

## 2. Venda fracionada

No PDV e no orçamento/pedido a quantidade aceita casas decimais com vírgula, por exemplo `0,500` de areia (m³) ou `2,75` m² de porcelanato:
- Campo de quantidade aceita vírgula e até 3 casas
- Os botões + e − somam/subtraem 1, mas a digitação livre continua valendo
- A unidade do produto aparece ao lado da quantidade
- Total, estoque e conferência de saldo passam a usar o valor fracionado exato

## 3. Botão "Criar pedido" na tela de Pedidos

Hoje o pedido só nasce de um orçamento aprovado. Vou incluir na tela de Pedidos o botão **Novo pedido**, com formulário próprio: cliente (por digitação), obra, depósito, previsão de entrega, condição de pagamento, itens com quantidade/preço/desconto, frete e desconto geral. Ao salvar, o pedido é criado já com a reserva de estoque no depósito escolhido — o mesmo comportamento do pedido vindo de orçamento.

## 4. Código do vendedor e código do profissional

Dois campos novos no orçamento e no pedido, preenchidos pelo código:
- **Código do vendedor** — ao digitar, o sistema mostra o nome do vendedor encontrado
- **Código do profissional** — idem, e a premiação por indicação passa a considerar o profissional informado no pedido

Os códigos passam a existir no cadastro de usuários (vendedores) e no cadastro de profissionais, com sugestão automática de código sequencial para quem ainda não tem. Ao aprovar um orçamento, os dois códigos seguem para o pedido.

## Detalhes técnicos

- Novo componente `src/components/app/ClienteCombobox.tsx` (Command + Popover do shadcn), usado em `pdv.tsx`, `orcamentos.tsx`, novo formulário de pedido, `obras.tsx` e `clientes-obras.tsx`.
- Migração: coluna `codigo text` em `profiles` e `profissionais` (índice único por tenant), coluna `profissional_id uuid` em `orcamentos` e `pedidos` (FK para `profissionais`), backfill de códigos sequenciais nos registros existentes, GRANTs preservados.
- Nova RPC `criar_pedido_direto(...)` (SECURITY DEFINER, roles administrador/gestor/vendedor) espelhando a lógica de `converter_orcamento_em_pedido`: insere pedido + itens, congela `custo_unitario` pelo custo médio do depósito, reserva estoque e grava histórico.
- `converter_orcamento_em_pedido` passa a copiar `vendedor_id` e `profissional_id`; trigger `premiar_pedido()` passa a usar `pedidos.profissional_id` quando informado, com fallback no `clientes.profissional_id`.
- Quantidades: parsing com vírgula → ponto, `step="0.001"`, arredondamento em 3 casas nos cálculos de total e na checagem de disponível.
