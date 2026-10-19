# Módulo Pet shop — Fase 1 (loja + banho e tosa com agenda)

Documento de escopo e modelo de dados, para aprovação antes de implementar. Nada deste documento está construído.

**Decisões já tomadas (seção 10):** o público inclui clínica veterinária; só a recepção agenda; o preço varia por porte, raça e pelagem; não há cobrança de sinal; o módulo só é liberado para CNAE de veterinária e pet shop.

## 1. Objetivo

Dar ao pet shop de bairro o que ele usa todo dia: cadastro de **tutor e pet**, **agenda de banho e tosa** por profissional, **cobrança de serviço junto com produto** no caixa e **comissão do profissional**. A clínica veterinária faz parte do módulo, mas entra depois da Fase 1 (seção 9); hospedagem também. O cliente **não** agenda sozinho: só a recepção agenda.

## 2. Quem usa e como o módulo aparece

- **Liberação:** igual ao restaurante, mas **somente** por CNAE de veterinária e pet shop (ou pelo ramo "Pet shop" escolhido no cadastro da empresa, como o restaurante). Prefixos propostos, a confirmar com a contabilidade: `7500` (atividades veterinárias), `4789004` (comércio varejista de animais vivos e artigos para animais de estimação) e `9609208` (higiene e embelezamento de animais domésticos). Prefixo mais curto como `4789` ou `9609` fica de fora de propósito: pegaria outras atividades. Regra em `src/lib/cnae-regras.ts` (novo módulo `petshop`), usada por `useModulosCnae()`.
- **Menu:** novo grupo "Pet shop" (Agenda, Pets e tutores, Serviços, Profissionais) e item em Relatórios ("Serviços por profissional"). Segue a regra de menu enxuto já existente: o ramo pet shop esconde obras, personalização, lotes de piso e logística de frota (a avaliar o táxi dog na Fase 3).
- **Perfis:** administrador, gestor, vendedor/caixa (agendar e cobrar) e o profissional (ver a própria agenda). Garçom e cozinha não enxergam nada (política `salao_restrito`, como nas demais tabelas).

## 3. O que reaproveita

| Já existe                                           | Uso no pet shop                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `clientes`                                          | O **tutor** é um cliente comum (CPF, telefone, limite de crédito) |
| `produtos`, estoque, lote e validade                | Ração, petiscos, acessórios e medicamentos                        |
| Frente de caixa, caixa por operador, TEF            | Cobrança de produto e serviço na mesma venda                      |
| NFC-e (produto) e NFS-e (serviço)                   | Fiscal da venda; serviço sai por NFS-e quando configurada         |
| `calcularConta`-style de arredondamento em centavos | Preço do serviço e comissão                                       |

## 4. O que é novo (modelo de dados)

Todas as tabelas têm `tenant_id` (padrão `current_tenant_id()`), RLS por empresa, política restritiva `salao_restrito` e escrita só por funções (`SECURITY DEFINER` com `exige_nao_salao()` e `exige_papel`), como as demais.

### `pets`

`id, tenant_id, cliente_id (tutor), nome, especie (cão/gato/outro), raca, porte (mini/pequeno/médio/grande/gigante), sexo, pelagem (curta/média/longa/dupla/crespa/sem pelo), peso_kg, nascimento, castrado, alergias, observacoes, foto_path, ativo`.
Um tutor tem vários pets; um pet tem um tutor. Pet não é apagado (inativa).

### `pet_servicos`

`id, tenant_id, nome, categoria (banho/tosa/estética/outro), duracao_min, produto_id` — o serviço **é um produto do tipo serviço**, para entrar na frente de caixa e na nota sem criar outro fluxo de venda.

### `pet_servico_precos`

`servico_id, porte, raca, pelagem, preco` — cada critério é opcional (vazio = vale para qualquer). Um preço pode valer só para o porte, só para uma raça, só para uma pelagem ou para a combinação.

**Qual preço vale** (regra única, em `src/lib/pet.ts` e repetida no banco): entre os preços cujos critérios batem com o pet, vence o **mais específico**, na ordem de peso: raça (4) > pelagem (2) > porte (1); a soma dos critérios preenchidos decide, e empate exato é recusado ao cadastrar (índice único sobre a combinação dos três). Exemplo: banho de _poodle_ de pelagem longa → vale a linha "poodle + longa" se existir, senão "poodle", senão "longa", senão a do porte. Nenhum preço bate = serviço não oferecido para aquele pet; só gestor ou administrador informa um preço avulso, e isso fica registrado no agendamento.

### `pet_profissionais`

`id, tenant_id, filial_id, nome, funcao (banhista/tosador/groomer), comissao_percentual, ativo`. Tabela própria, e não a de `tecnicos` da assistência: aquela é liberada pelo módulo de assistência e carrega custo por hora; misturar amarraria os dois módulos.

### `pet_agendamentos`

`id, tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao (agendado/confirmado/em_atendimento/pronto/retirado/cancelado/faltou), observacoes, taxi_dog (bool, só marca na Fase 1), venda_id (preenche ao cobrar), criado_por` — criado sempre por um usuário da recepção, nunca por link público.

### `pet_agendamento_itens`

`agendamento_id, servico_id, preco_aplicado, duracao_min, preco_avulso (bool)` (preço **congelado** na hora de agendar; reajuste posterior não muda o que foi combinado).

**Regras no banco**

- Profissional não pode ter dois agendamentos sobrepostos (índice de exclusão por intervalo `tstzrange`, ignorando cancelado e faltou).
- Mudança de situação só pelo caminho válido: agendado → confirmado → em atendimento → pronto → retirado; cancelar e faltar a partir de agendado/confirmado.
- Cancelamento e falta registram motivo. Não há cobrança de sinal nem multa automática.
- Agendamento "retirado" gera a **venda** (uma única vez, chave de idempotência pelo `agendamento_id`) pela rotina da frente de caixa existente, somando serviços + produtos extras escolhidos.

### Comissão

Ao retirar/cobrar, grava `pet_comissoes (profissional_id, agendamento_id, base, percentual, valor, situacao a_aprovar/aprovada/paga)`, com o mesmo fluxo de aprovação e pagamento das comissões de vendedores. Pet cancelado ou venda cancelada cancela a comissão.

## 5. Telas

1. **Agenda** (`/pet-agenda`): visão do dia por profissional (colunas) e da semana, usada pela recepção; arrastar não entra na Fase 1 — o horário se escolhe no formulário. O preço do serviço aparece já calculado pelo porte, raça e pelagem do pet. Cores por situação; botão "Pronto" avisa a recepção; "Retirar e cobrar" abre a frente de caixa com os itens.
2. **Pets e tutores** (`/pets`): busca por pet, tutor ou telefone; ficha com histórico de atendimentos e observações.
3. **Serviços e preços** (`/pet-servicos`): serviços, duração e tabela de preço por porte, raça e pelagem, com uma simulação "quanto custa para este pet".
4. **Profissionais** (`/pet-profissionais`): cadastro e percentual de comissão.
5. **Relatório "Serviços por profissional"**: quantidade, faturamento e comissão por período.

## 6. Fiscal

- Produto vendido segue NFC-e como hoje.
- Serviço (banho e tosa) é **NFS-e** — depende de inscrição municipal, código do serviço e ISS configurados (item pendente da Rodada 4 do roadmap). Até lá o serviço fica na venda sem nota de serviço; a tela de pendências fiscais já lista isso.

## 7. Segurança e testes

- Funções do módulo com `exige_nao_salao()` e papel mínimo; smoke de CI (bloco novo) cobre permissão por perfil, isolamento entre empresas, sobreposição de horário, transições inválidas, cobrança uma única vez e comissão.
- Testes unitários da regra de preço por porte, raça e pelagem (mais específico vence, empate, nenhum preço), duração, sobreposição e comissão (funções puras em `src/lib/pet.ts`).
- O `smoke.sql` já falha se uma tabela nova ficar sem a política do salão — o módulo herda essa proteção.

## 8. Entregas sugeridas (PRs pequenos)

1. Banco + liberação por CNAE/ramo + menu (sem telas): tabelas, funções, testes de segurança.
2. Pets e tutores + serviços e preços + profissionais.
3. Agenda (criar, mover, mudar situação) com a regra de sobreposição.
4. Cobrança pela frente de caixa + comissão + relatório.
   Cada PR passa pelo mesmo CI e fica em produção antes do próximo.

## 9. Fora da Fase 1

- **Fase 2:** pacotes e assinatura de banhos; lembretes (vacina, vermífugo, retorno de banho, recompra de ração por consumo) — dependem da integração com WhatsApp; venda a granel com conversão kg/saco; aniversário do pet.
- **Clínica veterinária (no escopo do módulo, em fase própria):** prontuário e consulta, vacinas e vermífugos com data de reforço, receituário e controle de medicamento controlado (exige o registro do veterinário no CRMV), internação e exames. É a parte de maior risco regulatório e ganha documento de escopo próprio antes de ser construída.
- **Fase 3:** hospedagem/creche; táxi dog com motorista e rota.
- **Fora de escopo por decisão:** agendamento online pelo cliente e cobrança de sinal.

## 10. Decisões

| #   | Pergunta                  | Decisão                                                                                                  |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | O público inclui clínica? | **Sim.** A clínica entra no módulo; a Fase 1 segue loja + banho e tosa e a clínica ganha escopo próprio. |
| 2   | Quem agenda?              | **Só a recepção.** Sem página pública.                                                                   |
| 3   | Preço por porte basta?    | **Não:** por porte, raça e pelagem (seção 4).                                                            |
| 4   | Cobrar sinal?             | **Não.**                                                                                                 |
| 5   | CNAE?                     | **Somente veterinária e pet shop** (seção 2).                                                            |

## 11. Pendências menores

- Confirmar os subcódigos de CNAE com a contabilidade antes de implementar.
- Lista inicial de raças e pelagens: começar curta (as mais comuns) e permitir cadastrar novas.
