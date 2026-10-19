# Módulo Pet shop — Fase 1 (loja + banho e tosa com agenda)

Documento de escopo e modelo de dados, para aprovação antes de implementar. Nada deste documento está construído.

## 1. Objetivo

Dar ao pet shop de bairro o que ele usa todo dia: cadastro de **tutor e pet**, **agenda de banho e tosa** por profissional, **cobrança de serviço junto com produto** no caixa e **comissão do profissional**. A clínica veterinária, a hospedagem e o agendamento online pelo cliente ficam fora (seção 9).

## 2. Quem usa e como o módulo aparece

- **Liberação:** igual ao restaurante — ramo de atividade "Pet shop" **ou** CNAE com os prefixos `4789`, `9609` ou `7500` (a confirmar os subcódigos com a contabilidade). Regra em `src/lib/cnae-regras.ts` (novo módulo `petshop`), usada por `useModulosCnae()`.
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

`id, tenant_id, cliente_id (tutor), nome, especie (cão/gato/outro), raca, porte (mini/pequeno/médio/grande/gigante), sexo, pelagem, peso_kg, nascimento, castrado, alergias, observacoes, foto_path, ativo`.
Um tutor tem vários pets; um pet tem um tutor. Pet não é apagado (inativa).

### `pet_servicos`

`id, tenant_id, nome, categoria (banho/tosa/estética/outro), duracao_min, produto_id` — o serviço **é um produto do tipo serviço**, para entrar na frente de caixa e na nota sem criar outro fluxo de venda.

### `pet_servico_precos`

`servico_id, porte, preco` (um preço por porte; opcional `raca` para exceções, como pelagem longa). Preço sem porte cadastrado = serviço não oferecido para aquele porte.

### `pet_profissionais`

`id, tenant_id, filial_id, nome, funcao (banhista/tosador/groomer), comissao_percentual, ativo`. Tabela própria, e não a de `tecnicos` da assistência: aquela é liberada pelo módulo de assistência e carrega custo por hora; misturar amarraria os dois módulos.

### `pet_agendamentos`

`id, tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao (agendado/confirmado/em_atendimento/pronto/retirado/cancelado/faltou), observacoes, taxi_dog (bool, só marca na Fase 1), venda_id (preenche ao cobrar), criado_por`.

### `pet_agendamento_itens`

`agendamento_id, servico_id, preco_aplicado, duracao_min` (preço **congelado** na hora de agendar; reajuste posterior não muda o que foi combinado).

**Regras no banco**

- Profissional não pode ter dois agendamentos sobrepostos (índice de exclusão por intervalo `tstzrange`, ignorando cancelado e faltou).
- Mudança de situação só pelo caminho válido: agendado → confirmado → em atendimento → pronto → retirado; cancelar e faltar a partir de agendado/confirmado.
- Cancelar com menos de X horas pode registrar motivo (X por empresa, padrão sem regra).
- Agendamento "retirado" gera a **venda** (uma única vez, chave de idempotência pelo `agendamento_id`) pela rotina da frente de caixa existente, somando serviços + produtos extras escolhidos.

### Comissão

Ao retirar/cobrar, grava `pet_comissoes (profissional_id, agendamento_id, base, percentual, valor, situacao a_aprovar/aprovada/paga)`, com o mesmo fluxo de aprovação e pagamento das comissões de vendedores. Pet cancelado ou venda cancelada cancela a comissão.

## 5. Telas

1. **Agenda** (`/pet-agenda`): visão do dia por profissional (colunas) e da semana; arrastar não entra na Fase 1 — o horário se escolhe no formulário. Cores por situação; botão "Pronto" avisa a recepção; "Retirar e cobrar" abre a frente de caixa com os itens.
2. **Pets e tutores** (`/pets`): busca por pet, tutor ou telefone; ficha com histórico de atendimentos e observações.
3. **Serviços e preços** (`/pet-servicos`): serviços, duração e tabela de preço por porte.
4. **Profissionais** (`/pet-profissionais`): cadastro e percentual de comissão.
5. **Relatório "Serviços por profissional"**: quantidade, faturamento e comissão por período.

## 6. Fiscal

- Produto vendido segue NFC-e como hoje.
- Serviço (banho e tosa) é **NFS-e** — depende de inscrição municipal, código do serviço e ISS configurados (item pendente da Rodada 4 do roadmap). Até lá o serviço fica na venda sem nota de serviço; a tela de pendências fiscais já lista isso.

## 7. Segurança e testes

- Funções do módulo com `exige_nao_salao()` e papel mínimo; smoke de CI (bloco novo) cobre permissão por perfil, isolamento entre empresas, sobreposição de horário, transições inválidas, cobrança uma única vez e comissão.
- Testes unitários da regra de preço por porte, duração, sobreposição e comissão (funções puras em `src/lib/pet.ts`).
- O `smoke.sql` já falha se uma tabela nova ficar sem a política do salão — o módulo herda essa proteção.

## 8. Entregas sugeridas (PRs pequenos)

1. Banco + liberação por CNAE/ramo + menu (sem telas): tabelas, funções, testes de segurança.
2. Pets e tutores + serviços e preços + profissionais.
3. Agenda (criar, mover, mudar situação) com a regra de sobreposição.
4. Cobrança pela frente de caixa + comissão + relatório.
   Cada PR passa pelo mesmo CI e fica em produção antes do próximo.

## 9. Fora da Fase 1

- **Fase 2:** pacotes e assinatura de banhos; lembretes (vacina, vermífugo, retorno de banho, recompra de ração por consumo) — dependem da integração com WhatsApp; venda a granel com conversão kg/saco; aniversário do pet.
- **Fase 3:** hospedagem/creche; táxi dog com motorista e rota; clínica veterinária (prontuário, vacinas, receituário — exige CRMV e controle de medicamento controlado).
- **Agendamento online pelo cliente:** página pública com proteção contra abuso (mesmo padrão do formulário de contato com Turnstile e limite de envios). Decisão pendente (pergunta 2).

## 10. Decisões pendentes

1. O público inclui clínica veterinária ou só loja + banho e tosa? (Muda a Fase 3, não a Fase 1.)
2. O cliente agenda sozinho (link/WhatsApp) ou só a recepção agenda?
3. Serviço por porte basta, ou precisa de preço por raça/pelagem já na Fase 1?
4. Cobrança antecipada/sinal para evitar falta? (Hoje sem regra; exigiria Pix/boleto automático, ainda pendente no roadmap.)
5. Subcódigos de CNAE a liberar, depois de conferir com a contabilidade.
