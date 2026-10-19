# Menu para empresas de alimentação

**Quando vale:** o ramo de atividade da empresa é "Restaurante e lanchonete" **ou** o CNAE principal começa com 56 (restaurantes, lanchonetes, bares, ambulantes, catering). CNAE 56 apenas como secundário não esconde nada — a empresa mista continua vendo tudo.

## O que continua

Restaurante (PDV do restaurante, Delivery, Cozinha, Cardápio e mesas), Frente de caixa, PDV, Pedidos, Clientes, Produtos (insumos e itens), Estoque, Balanço, Transferência entre lojas, Compras (fornecedores, cotações, pedidos, XML da NF-e), Financeiro e Fiscal (incl. NFC-e), Relatórios e Administração.

## O que some

| Grupo                  | Telas escondidas                                                                | Motivo                                     |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| Comercial              | Clientes e obras, Obras, Histórico da obra, Profissionais e prêmios, Orçamentos | Construção                                 |
| Comercial              | Personalização, Produção, Custo por par                                         | Fábrica sob medida                         |
| Comercial / Relatórios | Vendedores, Comissões (tela e relatório)                                        | Salão não usa vendedor comissionado        |
| Estoque                | Lotes e tonalidades, Ajuste de lotes, Lotes sem internet, Movimento por tamanho | Piso, tinta e grade de tamanho             |
| Compras                | Importar CT-e de frete                                                          | Sem frota/frete de carga                   |
| Logística              | Grupo inteiro (Entregas, Rota, Motorista, Veículos, Frota)                      | O delivery do restaurante tem tela própria |

Assistência técnica e Locação seguem a regra de CNAE já existente.

## Pontos para o dono do produto decidir

- Esconder vendedores/comissões pode atrapalhar quem paga comissão de garçom; se for o caso, basta tirar `/vendedores`, `/comissoes` e `/relatorio-comissoes` da lista.
- A lista fica em `src/lib/ramo-alimentacao.ts`; a regra é só visual — as telas continuam acessíveis por link e o banco não muda.
