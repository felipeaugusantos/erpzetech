# Módulo Pet shop — Fase 2 (retenção)

Continuação de `docs/pet-shop-fase-1.md`. A Fase 1 (cadastros, agenda e cobrança) está na `main`.

## Objetivo

Fazer o tutor voltar: contato na hora certa, pacote de banhos pago adiantado, venda de ração fracionada e agenda própria do profissional. Entregue em PRs pequenos, do mais seguro ao mais delicado.

## Ordem das entregas

| PR  | Entrega                                                                                                                        | Dinheiro? | Depende de fora?                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------- |
| 5   | **Contatos com o tutor**: aniversário do pet e retorno de banho, com link do WhatsApp pronto e registro de quem já foi chamado | não       | não                                                  |
| 6   | **Pacotes de banho**: venda de pacote (ex.: 4 banhos) e uso de cada banho na cobrança                                          | sim       | não                                                  |
| 7   | **Venda a granel**: abrir o saco (15 kg) e vender por kg, com a baixa certa nos dois produtos                                  | estoque   | não                                                  |
| 8   | **Agenda própria do profissional**: login do profissional vinculado ao cadastro, vendo só a agenda dele                        | não       | não                                                  |
| —   | **Lembretes automáticos** (envio sem ninguém clicar)                                                                           | não       | integração oficial com o WhatsApp (ainda não existe) |
| —   | **Vacina e vermífugo**                                                                                                         | não       | prontuário da clínica (escopo próprio)               |
| —   | **Recompra de ração por consumo**                                                                                              | não       | PR 7 + histórico de compra por pet                   |

## PR 5 — Contatos com o tutor (esta entrega)

- Tela **Contatos** (grupo Pet shop), para a recepção, com duas listas:
  - **Aniversário**: pets que fazem aniversário nos próximos N dias (padrão 7).
  - **Retorno de banho**: pets cujo último atendimento retirado foi há N dias ou mais (padrão 30) e que não têm novo atendimento marcado.
- Cada linha mostra pet, tutor e telefone, com **"Chamar no WhatsApp"** (abre a conversa com a mensagem pronta, editável e guardada no navegador) e **"Já falei"** (telefone ou outro canal). Os dois registram o contato.
- Quem já foi contatado naquela ocasião some da lista (uma vez por aniversário; uma vez por último atendimento).
- Sem envio automático: o clique é da recepção. O envio automático fica para quando houver a integração oficial.
- Banco: tabela `pet_contatos` (escrita só por função), `pet_contatos_pendentes` e `pet_contato_registrar`. Fuso de São Paulo para "hoje".

## PR 6 — Pacotes de banho (decisões propostas)

- Pacote = serviço vendido adiantado (ex.: 4 banhos por R$ 200), com validade (padrão 90 dias).
- Vendido na frente de caixa como produto sem estoque; gera crédito de usos para **um pet**.
- Na cobrança, "usar pacote" lança o serviço com valor zero na venda e consome um uso; a NFS-e e a comissão seguem o valor proporcional do pacote (decisão fiscal a confirmar com a contabilidade).
- Pacote vencido ou cancelado não pode ser usado; reembolso proporcional é manual.
- **Perguntas para antes do PR 6:** o pacote vale para qualquer pet do tutor ou para um só? Banho avulso cobrado a mais quando o pacote acaba? Prazo padrão?

## PR 7 — Venda a granel (decisões propostas)

- Dois produtos ligados: o **saco** (15 kg, comprado) e o **granel** (vendido por kg).
- Operação "abrir saco": baixa 1 saco e dá entrada de 15 kg no granel, pelo custo proporcional; nada de fração escondida em casas decimais.
- **Pergunta:** o fator (kg por saco) fica no produto ou é informado ao abrir?

## PR 8 — Agenda própria do profissional

- Coluna `pet_profissionais.profile_id` (única) ligando o cadastro à conta; o profissional vê só a própria agenda (política de leitura pelo vínculo) e avança as situações dos atendimentos dele.
- Exige perfil novo ou regra para esse papel; o desenho segue o isolamento do salão.

## Fora do escopo desta fase

Campanhas em massa, envio automático, prontuário/vacinas e o cálculo de recompra de ração.
