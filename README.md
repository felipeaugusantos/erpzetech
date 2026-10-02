# ERP Ze Tech

Crie um sistema SaaS completo para gestão de lojas de materiais de construção.

O sistema deve ser moderno, responsivo, multiempresa (multi-tenant), preparado para crescer e atender desde pequenas lojas até redes com múltiplas filiais e depósitos.

Nome provisório do sistema: Enzova Build.

1. Objetivo do sistema

O sistema deve controlar toda a operação comercial e operacional de uma loja de materiais de construção, incluindo:

clientes;

produtos;

fornecedores;

orçamentos;

pedidos;

vendas;

estoque;

depósitos;

compras;

entregas;

logística;

financeiro;

dashboards;

usuários;

permissões;

auditoria.

O principal fluxo do sistema deverá ser:

Cliente → Orçamento → Aprovação → Pedido → Reserva de Estoque → Separação → Conferência → Entrega → Financeiro.

O sistema deve priorizar facilidade de uso para atendentes de balcão, vendedores, estoquistas, responsáveis por compras, motoristas e gestores.

2. Arquitetura SaaS

O sistema deve funcionar no modelo multi-tenant.

Cada empresa deve possuir seu próprio ambiente lógico, sem visualizar dados de outras empresas.

Toda entidade operacional deve estar vinculada a:

tenant_id;

empresa_id;

filial_id, quando aplicável.

Criar estrutura preparada para:

múltiplas empresas;

múltiplas filiais;

múltiplos depósitos;

múltiplos usuários;

múltiplos caixas.

Implementar autenticação segura.

Perfis iniciais:

Administrador;

Gestor;

Vendedor;

Caixa;

Estoquista;

Comprador;

Financeiro;

Logística;

Motorista.

As permissões devem ser configuráveis.

3. Dashboard principal

Criar dashboard moderno e objetivo.

Mostrar:

faturamento do dia;

faturamento do mês;

total vendido;

quantidade de pedidos;

quantidade de orçamentos;

ticket médio;

margem estimada;

contas a receber;

contas vencidas;

contas a pagar;

produtos com baixo estoque;

produtos sem estoque;

produtos com estoque parado;

entregas pendentes;

entregas do dia;

pedidos aguardando separação.

Exibir gráficos de:

vendas por período;

vendas por vendedor;

vendas por categoria;

produtos mais vendidos;

margem por produto;

evolução do faturamento.

Adicionar filtros por:

período;

filial;

vendedor;

categoria;

forma de pagamento.

4. Cadastro de clientes

Criar cadastro de clientes Pessoa Física e Pessoa Jurídica.

Campos:

nome / razão social;

nome fantasia;

CPF;

CNPJ;

inscrição estadual;

telefone;

WhatsApp;

e-mail;

CEP;

endereço;

número;

complemento;

bairro;

cidade;

estado.

Criar área financeira do cliente com:

limite de crédito;

saldo utilizado;

saldo disponível;

situação financeira;

contas vencidas;

prazo padrão;

desconto máximo permitido.

Criar histórico completo do cliente:

orçamentos;

pedidos;

vendas;

entregas;

pagamentos;

contatos;

obras vinculadas.

5. Cadastro de obras

O cliente poderá possuir uma ou mais obras.

Campos:

nome da obra;

cliente;

endereço;

responsável;

telefone;

observações;

data de início;

previsão de término;

situação.

Status possíveis:

Planejamento;

Em andamento;

Pausada;

Concluída;

Cancelada.

Orçamentos, pedidos e entregas poderão ser vinculados a uma obra.

6. Cadastro de produtos

Este módulo é crítico.

Criar cadastro completo de produtos.

Campos:

código interno;

código de barras;

descrição;

descrição resumida;

categoria;

subcategoria;

marca;

fabricante;

fornecedor principal;

NCM;

unidade;

unidade de compra;

unidade de venda;

custo;

preço de venda;

margem;

estoque mínimo;

estoque máximo;

localização no depósito;

peso;

altura;

largura;

comprimento;

ativo/inativo.

Permitir fotos do produto.

7. Conversão de unidades

O sistema deverá permitir produtos vendidos em unidades diferentes das compradas.

Exemplos:

Cabo elétrico:

Compra:
1 rolo = 100 metros.

Venda:
metro.

Porcelanato:

Compra:
1 caixa = 2,50 m².

Venda:
caixa ou m².

Cimento:

Compra:
palete.

1 palete = 50 sacos.

Venda:
saco.

Criar estrutura de conversão de unidades.

Cada produto poderá possuir:

unidade principal;

unidade de compra;

unidade de venda;

fator de conversão.

Exemplo:

Produto: Cabo 2,5 mm

1 rolo = 100 metros.

Se o estoque possuir:

7 rolos + 43 metros

o sistema deverá representar corretamente o estoque disponível.

8. Categorias de produtos

Criar exemplos iniciais:

cimento;

areia;

pedra;

tijolos;

blocos;

pisos;

revestimentos;

argamassa;

tintas;

hidráulica;

elétrica;

ferramentas;

ferragens;

madeira;

telhas;

portas;

janelas;

louças;

metais;

iluminação.

As categorias deverão ser configuráveis.

9. Estoque

Criar módulo completo de estoque.

Permitir:

entrada;

saída;

ajuste;

inventário;

transferência entre depósitos;

transferência entre filiais;

reserva;

liberação de reserva.

Mostrar:

Estoque físico.

Estoque reservado.

Estoque disponível.

Exemplo:

Estoque físico: 100.

Reservado: 30.

Disponível: 70.

Criar histórico de movimentações.

Toda movimentação deverá registrar:

produto;

quantidade;

origem;

tipo;

usuário;

data;

hora;

documento relacionado;

motivo.

10. Múltiplos depósitos

Permitir criar múltiplos depósitos.

Exemplo:

Depósito Principal.

Depósito Loja.

Depósito Externo.

Mostrar estoque separado por depósito.

Permitir transferência entre depósitos.

11. Orçamentos

Criar módulo de orçamento rápido para utilização no balcão.

Permitir localizar cliente por:

nome;

CPF;

CNPJ;

telefone.

Adicionar produtos por:

código;

descrição;

código de barras.

Campos do orçamento:

cliente;

obra;

vendedor;

data;

validade;

produtos;

quantidade;

unidade;

preço;

desconto;

frete;

observações.

Mostrar:

Subtotal.

Desconto.

Frete.

Total.

Permitir gerar orçamento em PDF.

Permitir compartilhar orçamento pelo WhatsApp.

Status:

Rascunho;

Enviado;

Em negociação;

Aprovado;

Rejeitado;

Expirado.

12. Conversão de orçamento para pedido

Quando o cliente aprovar um orçamento:

Converter orçamento em pedido sem redigitar informações.

Fluxo:

Orçamento aprovado → Pedido.

Ao converter:

manter cliente;

obra;

produtos;

preços;

descontos;

vendedor;

observações.

Criar reserva automática do estoque quando configurado.

13. Pedidos

Criar tela de pedidos.

Status:

Aguardando pagamento;

Aprovado;

Separação;

Separado;

Conferência;

Pronto para entrega;

Em rota;

Entregue;

Concluído;

Cancelado.

Mostrar timeline completa do pedido.

Exemplo:

Pedido criado às 08:15.

Pagamento aprovado às 08:32.

Separação iniciada às 09:05.

Separação concluída às 09:40.

Carga realizada às 10:10.

Saiu para entrega às 10:25.

Entregue às 11:03.

14. Entregas parciais

O sistema deverá permitir entrega parcial de pedidos.

Exemplo:

Cliente comprou:

100 sacos de cimento.

3.000 tijolos.

10 m³ de areia.

Primeira entrega:

30 sacos.

1.000 tijolos.

Segunda entrega:

30 sacos.

1.000 tijolos.

Terceira entrega:

40 sacos.

1.000 tijolos.

10 m³ de areia.

Mostrar no pedido:

Quantidade comprada.

Quantidade entregue.

Quantidade reservada.

Quantidade pendente.

Não considerar pedido totalmente entregue enquanto houver produtos pendentes.

15. Separação de pedidos

Criar painel específico para estoque.

Exibir:

Pedidos aguardando separação.

Para cada pedido mostrar:

número;

cliente;

produtos;

localização do produto;

quantidade;

depósito.

O estoquista deve conseguir marcar cada item como separado.

Fluxo:

Aguardando separação → Separando → Separado → Conferência.

16. Conferência

Criar etapa de conferência antes da carga.

Permitir:

conferir quantidade;

código de barras;

produtos;

divergências.

Registrar usuário responsável pela conferência.

Não permitir expedição se houver divergência não resolvida.

17. Logística e entregas

Criar módulo de logística.

Cadastro de veículos:

placa;

modelo;

tipo;

capacidade de peso;

capacidade de volume;

situação.

Cadastro de motoristas:

nome;

telefone;

documento;

situação.

Criar planejamento de entregas.

Tela:

Entregas de hoje.

Mostrar:

pedido;

cliente;

endereço;

obra;

telefone;

motorista;

veículo;

horário;

peso;

volume.

Permitir organizar sequência de entregas.

18. Aplicação para motorista

Criar interface mobile simplificada para motorista.

Mostrar:

entregas do dia;

sequência;

cliente;

endereço;

telefone;

itens;

observações.

Botões:

Iniciar rota;

Cheguei;

Iniciar entrega;

Entregue;

Não entregue.

Permitir registrar:

foto;

nome de quem recebeu;

assinatura;

data;

horário;

localização GPS futuramente.

Registrar motivo de insucesso:

cliente ausente;

endereço incorreto;

obra fechada;

material recusado;

outros.

19. Fornecedores

Cadastro:

razão social;

nome fantasia;

CNPJ;

contato;

telefone;

WhatsApp;

e-mail;

endereço;

prazo de entrega;

condição de pagamento.

Mostrar histórico de compras.

20. Compras

Criar módulo de compras.

Fluxo:

Necessidade de compra → Cotação → Pedido de compra → Recebimento → Entrada no estoque.

Criar solicitação de compra automática com base em estoque mínimo.

Exemplo:

Produto:

Cimento CP-II.

Estoque atual: 80.

Estoque mínimo: 100.

Sugestão de compra: 120.

Criar pedido de compra.

Status:

Rascunho;

Cotação;

Aprovado;

Pedido enviado;

Parcialmente recebido;

Recebido;

Cancelado.

21. Recebimento de mercadorias

Ao receber produtos:

Selecionar pedido de compra.

Informar quantidade recebida.

Permitir recebimento parcial.

Registrar divergências:

quantidade diferente;

produto errado;

produto danificado.

Após confirmação:

Atualizar estoque.

Atualizar custo.

Registrar movimentação.

22. Financeiro

Criar financeiro básico.

Módulos:

contas a pagar;

contas a receber;

fluxo de caixa;

caixa;

despesas;

receitas.

Status:

Aberto;

Pago;

Parcial;

Vencido;

Cancelado.

Formas de pagamento:

dinheiro;

PIX;

cartão de crédito;

cartão de débito;

boleto;

transferência;

crediário.

Permitir parcelamento.

Exemplo:

Venda de R$ 3.000.

Entrada: R$ 500.

Restante: 5 parcelas de R$ 500.

23. Controle de crédito

Permitir definir limite por cliente.

Exemplo:

Limite total: R$ 10.000.

Utilizado: R$ 7.000.

Disponível: R$ 3.000.

Ao tentar vender acima do limite:

Mostrar alerta.

Permitir autorização por gestor.

Registrar usuário que autorizou.

24. PDV

Criar tela de venda rápida.

Interface simples.

Permitir:

leitor de código de barras;

busca rápida;

cliente;

vendedor;

desconto;

formas de pagamento.

Mostrar:

Itens.

Subtotal.

Desconto.

Total.

Troco.

Finalizar venda.

Inicialmente não implementar integração fiscal real.

Criar estrutura preparada para integração futura com NFC-e ou provedor fiscal externo.

25. Caixa

Criar:

Abertura de caixa.

Entradas.

Saídas.

Sangria.

Suprimento.

Fechamento.

Mostrar diferença entre:

Valor esperado.

Valor informado.

Diferença.

Registrar responsável.

26. Relatórios

Criar relatórios:

Vendas:

por período;

por vendedor;

por cliente;

por produto;

por categoria.

Estoque:

estoque atual;

estoque mínimo;

estoque zerado;

estoque parado;

giro;

inventário.

Financeiro:

contas a receber;

contas vencidas;

contas a pagar;

fluxo de caixa.

Logística:

entregas realizadas;

entregas pendentes;

entregas não realizadas;

entregas por motorista.

Compras:

compras por fornecedor;

produtos mais comprados;

custo médio.

27. Curva ABC

Criar classificação automática ABC.

Considerar:

faturamento;

quantidade vendida;

margem.

Exibir:

Produtos A.

Produtos B.

Produtos C.

Permitir filtrar período.

28. Inteligência de estoque

Criar dashboard com:

Risco de ruptura.

Excesso de estoque.

Estoque parado.

Baixo giro.

Sugestão de compra.

Exemplo:

Produto:
Cimento CP-II.

Estoque atual: 120.

Venda média diária: 38.

Cobertura estimada: 3,1 dias.

Prazo médio fornecedor: 5 dias.

Exibir alerta:

"Risco de ruptura antes da próxima reposição."

Não utilizar IA externa inicialmente.

As sugestões podem ser calculadas através de regras.

29. Auditoria

Toda operação importante deverá possuir histórico.

Registrar:

usuário;

data;

hora;

operação;

valor anterior;

valor novo.

Auditar principalmente:

alteração de preço;

alteração de custo;

desconto;

limite de crédito;

cancelamento;

estoque;

financeiro.

30. Notificações

Criar central de notificações.

Alertas:

estoque baixo;

produto sem estoque;

conta vencida;

cliente acima do limite;

pedido atrasado;

entrega atrasada;

orçamento expirando;

compra pendente;

divergência de estoque.

31. Busca global

Adicionar busca no topo.

Permitir pesquisar:

cliente;

CPF;

CNPJ;

pedido;

orçamento;

produto;

código de barras;

fornecedor.

32. Interface

Criar layout profissional de ERP SaaS.

Menu lateral.

Topo com:

empresa;

filial;

usuário;

notificações;

busca.

Menu:

Dashboard.

Comercial:

Clientes.

Obras.

Orçamentos.

Pedidos.

PDV.

Estoque:

Produtos.

Estoque.

Movimentações.

Inventário.

Depósitos.

Compras:

Fornecedores.

Cotações.

Pedidos de compra.

Recebimentos.

Logística:

Entregas.

Rotas.

Veículos.

Motoristas.

Financeiro:

Contas a receber.

Contas a pagar.

Caixa.

Fluxo de caixa.

Relatórios.

Configurações.

33. UX

Evitar telas excessivamente complexas.

O sistema será utilizado por pessoas com diferentes níveis de conhecimento tecnológico.

Priorizar:

botões claros;

textos objetivos;

poucos cliques;

atalhos;

filtros;

tabelas organizadas;

busca rápida;

responsividade.

Mostrar estados vazios adequados.

Exemplo:

"Nenhum pedido encontrado."

Adicionar botão:

"Novo pedido."

34. Banco de dados

Criar estrutura relacional normalizada.

Principais tabelas:

tenants

empresas

filiais

usuarios

roles

permissoes

clientes

enderecos

obras

categorias

produtos

produto_unidades

produto_conversoes

depositos

estoques

estoque_movimentacoes

fornecedores

orcamentos

orcamento_itens

pedidos

pedido_itens

reservas_estoque

separacoes

conferencias

entregas

entrega_itens

veiculos

motoristas

rotas

compras

compra_itens

recebimentos

contas_receber

contas_pagar

caixas

caixa_movimentacoes

auditoria

notificacoes

Todos os registros que pertençam a uma empresa devem conter tenant_id.

Criar foreign keys corretamente.

Evitar exclusão física de dados importantes.

Utilizar preferencialmente:

deleted_at

ou:

ativo = true/false.

35. Regras importantes

Nunca permitir estoque negativo sem configuração explícita.

Nunca excluir movimentações de estoque.

Nunca excluir operações financeiras concluídas.

Utilizar cancelamento ou estorno.

Registrar histórico de alterações.

Não permitir que usuário de um tenant visualize dados de outro tenant.

Não confiar apenas na interface para segurança.

As regras de autorização devem ser aplicadas também no backend/banco.

36. MVP

Não tente implementar tudo de uma vez.

Construir inicialmente a FASE 1.

FASE 1:

Autenticação.

Multi-tenant.

Empresas.

Filiais.

Usuários.

Perfis e permissões.

Clientes.

Obras.

Categorias.

Produtos.

Conversão de unidades.

Depósitos.

Estoque.

Movimentação de estoque.

Orçamentos.

Conversão orçamento → pedido.

Pedidos.

Reserva de estoque.

Separação.

Entrega.

Dashboard básico.

Não implementar ainda:

emissão fiscal;

NFC-e;

NF-e;

SPED;

TEF;

integração bancária;

IA;

marketplace;

roteirização automática.

Apenas deixar arquitetura preparada.

37. Dados de demonstração

Criar uma empresa fictícia:

Constrular Materiais para Construção.

Filial:

Loja Centro.

Cadastrar aproximadamente 30 produtos de demonstração.

Exemplos:

Cimento CP-II 50 kg.

Areia Média.

Areia Fina.

Pedra Brita 1.

Tijolo Cerâmico.

Bloco de Concreto.

Argamassa AC2.

Argamassa AC3.

Porcelanato 60x60.

Piso Cerâmico.

Tinta Acrílica 18L.

Cabo Flexível 2,5 mm.

Cabo Flexível 4 mm.

Tubo PVC 100 mm.

Tubo PVC 50 mm.

Joelho PVC.

Registro.

Torneira.

Chuveiro.

Telha Fibrocimento.

Criar clientes fictícios.

Criar fornecedores fictícios.

Criar alguns orçamentos.

Criar alguns pedidos.

Criar estoque inicial.

Assim será possível validar o sistema imediatamente.

38. Desenvolvimento por etapas

Antes de começar qualquer nova fase:

analisar o que já foi implementado;

verificar banco existente;

não duplicar tabelas;

não recriar funcionalidades existentes;

preservar funcionalidades funcionando;

não alterar regras existentes sem necessidade.

Sempre priorizar qualidade estrutural em vez de quantidade de funcionalidades.

39. Primeiro objetivo

Comece implementando somente:

estrutura visual;

autenticação;

multiempresa;

usuários;

permissões;

dashboard;

clientes;

obras;

produtos;

categorias;

unidades;

depósitos;

estoque.

Após concluir essa etapa, apresente o que foi criado e aguarde novas instruções antes de implementar Comercial, Compras, Logística e Financeiro.

O sistema deve parecer um produto SaaS profissional desde a primeira versão, e não apenas um CRUD simples.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://erpzetech.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7261ba96-702d-4ece-8839-2f7bf3972a3a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
