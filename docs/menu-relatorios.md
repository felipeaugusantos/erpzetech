# Menu de relatórios

Análise das telas do menu da loja para separar **relatórios** (só consultam e analisam) de **rotinas** (registram ou
alteram dados). Os relatórios saíram dos módulos e foram para o grupo **Relatórios**, dividido por módulo. As rotas
(endereços das telas) não mudaram: links salvos, favoritos e atalhos continuam funcionando.

## Critério

Relatório é a tela cuja função principal é ler e analisar: totais, saldos, histórico, margem, painel de indicadores,
exportação em PDF. Rotina é a que lança, aprova, conta, cancela ou configura algo. Tela com as duas coisas ficou onde o
uso principal está.

## O que foi para Relatórios

| Seção | Tela | Antes estava em |
|---|---|---|
| Gerencial | Relatório do sócio | Visão geral |
| Gerencial | Painel da filial extra | Administração |
| Gerencial | Auditoria | Administração |
| Comercial | Lucro e margem | Financeiro |
| Comercial | Comissões (relatório) | Comercial |
| Estoque | Estoque por depósito | Estoque |
| Estoque | Giro e curva ABC | Estoque |
| Estoque | Movimentações (histórico) | Estoque |
| Estoque | Movimento por tamanho | Estoque |
| Financeiro | Extrato a receber | Financeiro |
| Financeiro | Fluxo de caixa | Financeiro |
| Financeiro | Fechamento por operador | Financeiro |
| Fiscal | Balanço fiscal | Financeiro |
| Fiscal | Painel fiscal por loja | Financeiro |
| Assistência técnica | Assistência por loja | Assistência técnica |
| Assistência técnica | Relatório em PDF | Assistência técnica |
| Locação | Painel de locação | Locação de equipamentos |
| Locação | Relatório em PDF | Locação de equipamentos |

Regras de exibição que continuam valendo: os relatórios de assistência e de locação só aparecem se o módulo estiver
liberado pelo CNAE; "Movimento por tamanho" só aparece para quem faz personalização.

## O que ficou nas rotinas (e por quê)

| Tela | Motivo |
|---|---|
| Entradas e saídas (estoque) | registra entradas e saídas |
| Balanço de estoque | é a contagem e o ajuste de inventário |
| Sugestão de reposição | gera pedidos de compra |
| Conferência e lotes sem internet | ferramentas de uso offline |
| Contas a receber, contas a pagar, caixa | lançam e baixam |
| Notas fiscais, pendências fiscais, simulação de nota | emitem ou tratam notas |
| Crédito de clientes | concede e autoriza limite |
| Painel da maquininha (TEF) | também registra transação |
| Histórico da obra | consulta feita dentro do fluxo da obra e da entrega |
| Custo por par | calculadora de custo |

## Observações

- O "Giro e curva ABC" tem um botão que gera compra a partir da análise; o uso principal é a análise.
- O grupo "Ze Tech" (equipe da Ze Tech) é outro menu e não mudou; seus relatórios (fiscal e de assinatura) ficam lá.
- Restaurante, Compras e Logística ainda não têm relatórios próprios; quando tiverem, entram em uma seção nova do grupo.
- O menu não esconde telas por perfil (só garçom, cozinha e motorista têm menu próprio); a permissão de cada tela
  continua sendo a do banco.
- `tests/menu.test.ts` garante que cada tela aparece uma vez só, que todo link aponta para uma rota que existe e que
  relatórios e rotinas não se misturam de novo.
