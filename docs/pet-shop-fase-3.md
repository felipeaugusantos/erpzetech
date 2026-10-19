# Módulo Pet shop — Fase 3 (clínica: prontuário e vacinas)

Continuação de `docs/pet-shop-fase-1.md` (seção 9, "Clínica veterinária") e de `docs/pet-shop-fase-2.md`. As Fases 1 e 2 estão na `main`. Este documento é o escopo próprio da clínica que a Fase 1 prometeu antes de qualquer código.

## Objetivo

Dar à clínica veterinária o que ela usa todo dia: **consulta com prontuário** e **vacinas e vermífugos com data de reforço**, ligados ao que o módulo já tem (tutor, pet, agenda, caixa, estoque por lote, contatos). Quem só tem pet shop não vê nada disso.

## O que fica dentro e o que fica fora

| Dentro (esta fase)                                                     | Fora (fase própria, depois)                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Consulta e prontuário (anamnese, exame, diagnóstico, conduta, adendos) | Receituário e medicamento controlado (exige assinatura/CRMV)   |
| Vacinas e vermífugos: catálogo, aplicação com lote, reforço e cartão   | Internação, exames laboratoriais e de imagem, cirurgia         |
| Aviso de reforço pelo WhatsApp (link pronto, como o PR 5 da Fase 2)    | Envio automático (depende da integração oficial do WhatsApp)   |
| Cobrança da consulta/vacina pelo caixa e comissão do veterinário       | Telemedicina, assinatura digital de documentos, anexos pesados |

## Regras que valem para a fase inteira

- **Liberação própria.** Além do módulo `petshop`, a clínica só aparece com CNAE `7500` (atividades veterinárias) ou ramo "Clínica" no cadastro da empresa. Pet shop sem clínica não ganha menu, tabela legível nem função de prontuário. Regra em `src/lib/cnae-regras.ts` (novo módulo `clinica`) **e também no banco**: a função `clinica_liberada()` (mesma regra, lida do cadastro da empresa) é exigida em **toda política das tabelas clínicas e em toda função** de prontuário, vacina e cartão, para que chamar a API direto não contorne o menu.
- **Quem escreve no prontuário é o veterinário.** Perfil novo **Veterinário**, com CRMV e UF no cadastro do profissional (`pet_profissionais.crmv`, `crmv_uf`; função "veterinário" já existe). Registro sem CRMV preenchido é recusado pelo banco. Administrador e gestor **não** escrevem em nome do veterinário.
- **Quem lê (decisão 1).** **Somente o perfil Veterinário** lê o texto clínico. Administrador e gestor **não** leem (quem é dono e também veterinário recebe os dois perfis). Recepção e vendedor só sabem o **dia e a hora** em que o pet passou pela clínica, que já aparece na agenda. Profissional de banho vê apenas o aviso de alergia que já aparece na agenda.
- **Prontuário não se apaga nem se reescreve.** Cada atendimento clínico, depois de **fechado**, fica imutável; correção é **adendo** datado e assinado pelo mesmo veterinário (ou outro, com identificação). O banco recusa `UPDATE` e `DELETE` direto; o histórico guarda quem escreveu e quando.
- **Dado pessoal e de saúde animal.** O texto clínico é do pet, mas junto ao tutor é dado pessoal (LGPD): acesso restrito pelas regras acima, auditoria de leitura do prontuário, e nada de texto clínico em notificação, WhatsApp ou relatório que a recepção veja.
- **Prazo de guarda do prontuário** e exigências do conselho (CFMV/CRMV da UF) **a confirmar com o responsável técnico da clínica antes do PR 2**. Até lá, o sistema simplesmente nunca apaga.
- **Estoque.** Vacina e vermífugo são produtos com controle de **lote e validade** (a base de lotes já existe). A aplicação baixa 1 dose do lote escolhido; lote vencido ou zerado é recusado.

## Ordem das entregas

| PR  | Entrega                                                                                                                  | Dinheiro? | Depende de fora?                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------- |
| 1   | **Base da clínica**: módulo `clinica`, perfil Veterinário, CRMV no cadastro do profissional, isolamento do texto clínico | não       | confirmar regra de guarda e acesso com o RT                   |
| 2   | **Consulta e prontuário**: agendar consulta, atendimento clínico, fechar, adendo, histórico do pet                       | não       | PR 1                                                          |
| 3   | **Vacinas e vermífugos**: catálogo, aplicação com lote, próxima dose, cartão de vacinação para imprimir                  | estoque   | PR 1                                                          |
| 4   | **Reforços**: lista de reforços vencendo com "Chamar no WhatsApp" e "Já falei" (reaproveita o PR 5 da Fase 2)            | não       | PR 3                                                          |
| 5   | **Cobrança clínica**: consulta e vacina cobradas no caixa, NFS-e em rascunho, comissão do veterinário                    | sim       | contador: nota de consulta e de vacina (serviço x mercadoria) |

## PR 1 — Base da clínica (entregue)

> Como foi feito: o perfil Veterinário entra no mesmo isolamento do Profissional (não lê loja, caixa nem restaurante). A leitura dos pets, da agenda e do texto clínico será dada **só a esse perfil** nas tabelas do PR 2, por política própria. Administrador e gestor que também são veterinários precisam receber o perfil Veterinário.

- Módulo `clinica` em `useModulosCnae()` (CNAE `7500` ou ramo "Clínica"). Grupo de menu **Clínica**, separado de Pet shop.
- `clinica_liberada()` no banco (CNAE `7500` nos CNAEs da empresa ou ramo "Clínica"): já barra o cadastro de profissional com função veterinário em empresa sem clínica e será exigida por todas as políticas e funções dos PRs seguintes.
- Perfil `veterinario` no `app_role` (arquivo de migration próprio, como `garcom` e `profissional`). Quem tem só esse perfil usa a clínica, a agenda e a própria lista de pets; o isolamento segue o desenho do perfil Profissional (a função de isolamento passa a conhecê-lo; nada da loja, do caixa ou do financeiro).
- `pet_profissionais.crmv` e `crmv_uf`: obrigatórios para quem tem função "veterinário" e vínculo com conta; telas de cadastro e de vínculo avisam.
- Categorias de serviço novas: `consulta`, `vacina` e `exame` (hoje há banho, tosa, estética e outro). Elas aparecem na agenda como qualquer serviço, com preço por porte/raça como já existe.

## PR 2 — Consulta e prontuário (entregue)

> Como foi feito: as tabelas `pet_atendimentos_clinicos`, `pet_atendimento_adendos` e `clinica_acessos` **não têm leitura nem escrita direta** para ninguém; tudo passa por funções que exigem o perfil Veterinário, a clínica liberada e um cadastro de veterinário ativo com CRMV. O veterinário não ganhou leitura das tabelas do pet shop: pets, tutor e agenda chegam só pelas funções (`clinica_pacientes`, `clinica_historico`, `pet_minha_agenda`). Fechar é irreversível (gatilho no banco); o adendo identifica quem escreveu. A auditoria de acessos (sem texto clínico) é lida por administrador e gestor. Fica para depois: anexos, sinais vitais em gráfico e correção do peso do cadastro do pet.

- **Agendar**: a recepção agenda a consulta como qualquer serviço (agenda do veterinário, sem sobreposição).
- **Atendimento clínico** (`pet_atendimentos_clinicos`): nasce quando o veterinário abre a consulta. Campos: queixa, anamnese, peso (kg), temperatura, frequência cardíaca/respiratória, exame físico, diagnóstico (texto livre), conduta, retorno sugerido (data), observações. Sinais vitais ficam em colunas próprias (dá para fazer gráfico de peso depois).
- **Fechar** o atendimento o torna imutável. **Adendo** (`pet_atendimento_adendos`): texto, autor, data; nunca altera o original.
- **Histórico do pet**: linha do tempo de consultas, vacinas e peso, visível a veterinário, administrador e gestor.
- Alergia e observação do cadastro do pet continuam a ser o aviso que o banho vê; o veterinário pode atualizar `pets.alergias` por uma função própria (a recepção segue sem editar texto clínico).
- Sem anexos nesta fase: foto e laudo ficam para a fase de exames.

## PR 3 — Vacinas e vermífugos

- **Catálogo** (`pet_vacinas_catalogo`): nome, tipo (`vacina` ou `vermifugo`), espécie, número de doses da série inicial, intervalo entre doses da série, **intervalo de reforço em dias**, idade mínima para a primeira dose, produto vinculado (**só para baixar o lote do estoque; não é cobrado**). A clínica edita; o sistema **sugere** valores iniciais (ex.: múltipla/V10 e antirrábica com reforço anual; vermífugo a cada 90 dias) marcados como "sugestão — conferir com o veterinário responsável", nunca como regra do sistema.
- **Aplicação** (`pet_vacinacoes`): ligada ao **atendimento agendado** do serviço de categoria `vacina` (a recepção agenda o serviço; a aplicação só existe dentro dele), pet, item do catálogo, data, **lote e validade** (do estoque), dose (1ª, 2ª, reforço), veterinário (com CRMV), local da aplicação, observação, **próxima dose** calculada (editável). Baixa 1 dose do lote escolhido; a aplicação já feita não se apaga: erro vira **cancelamento com motivo** (devolve a dose ao lote).
- **Vacina aplicada fora** (outra clínica): registro histórico sem baixa de estoque, marcado "aplicada em outro local", com quem informou. Entra no cartão com essa marca.
- **Cartão de vacinação**: impressão (A5/A4) com pet, tutor, vacinas e vermífugos aplicados (data, produto, lote, validade, veterinário/CRMV) e próximas doses. É documento do pet, sem texto clínico do prontuário.
- Regras de segurança do dado: lote vencido, sem saldo ou de outro depósito é recusado; vacina com idade mínima não atendida avisa (não bloqueia: decisão do veterinário).

## PR 4 — Reforços

- Tela **Reforços** (grupo Clínica) para a recepção: vacinas e vermífugos com próxima dose nos próximos N dias (padrão 15) e **atrasados**, por pet e tutor, com telefone e **"Chamar no WhatsApp"** (mensagem editável: pet, vacina e data) e **"Já falei"**. Mesma mecânica de `pet_contatos` (uma vez por dose).
- A lista traz só **nome da vacina e data**; nada do prontuário.
- Sem envio automático; o automático entra junto com a integração oficial do WhatsApp.

## PR 5 — Cobrança clínica

- Consulta e vacina são **serviços da agenda** com preço congelado (por porte/raça como os demais). **O item cobrável da vacina é o serviço** (o preço já inclui a dose); o produto do catálogo só baixa o lote e nunca vai para a venda, então não há cobrança em duplicidade e a validação de `pet_agenda_retirar` da Fase 1 segue como está. A cobrança segue o fluxo da Fase 1: retirar → caixa com os itens preenchidos e NFS-e em rascunho; o **tratamento fiscal da vacina** (serviço ou mercadoria aplicada) fica a confirmar com o contador e, se mudar, muda a emissão, não o item cobrado.
- Comissão do veterinário calculada como a dos demais profissionais (percentual do cadastro), só sobre serviço cobrado.

## Decisões tomadas

| #   | Pergunta                                                    | Decisão                                                                                        |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | A recepção lê o resumo clínico?                             | **Não.** Só o veterinário lê; a recepção sabe apenas o dia e a hora do atendimento.            |
| 2   | Auxiliar aplica vacina sob responsabilidade do veterinário? | Sim, registrando o auxiliar como aplicador e o veterinário como responsável (sugestão aceita). |
| 3   | Prazo de guarda do prontuário e exigência do CRMV da UF     | **Em aberto** com o responsável técnico; até lá o sistema nunca apaga.                         |
| 4   | Animais de grande porte                                     | Só cães, gatos e outros pequenos (sugestão aceita); grande porte fica de fora.                 |
| 5   | Vacina aplicada fora entra no cartão?                       | Sim, marcada "aplicada em outro local" (sugestão aceita).                                      |
| 6   | A recepção imprime o cartão de vacinação?                   | Sim; o cartão não traz texto do prontuário (sugestão aceita).                                  |

Sem resposta ainda, e que não trava o PR 1: tratamento fiscal da vacina (mercadoria ou serviço) com o contador, que só importa no PR 5.

## Fora do escopo desta fase

Receituário e controlados, internação, exames, anexos, telemedicina, assinatura digital, prontuário compartilhado entre clínicas e envio automático de lembretes.
