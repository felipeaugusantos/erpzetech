# Módulo Hotelaria — Fase 1 (recepção, reservas, mapa e conta do hóspede)

Documento de escopo e modelo de dados, para aprovação antes de implementar. Nada deste documento está construído.

Origem: análise do sistema contra a lista de um PMS hoteleiro. Hoje não existe nenhuma entidade de hospedagem; o que existe e será reaproveitado está na seção 3.

## 1. Objetivo

Entregar o núcleo de um PMS para hotel e pousada de uma ou mais propriedades: **cadastro de acomodações (UH) e tarifas**, **reservas com disponibilidade sem overbooking**, **mapa de ocupação**, **check-in e check-out** com ficha do hóspede, **conta do hóspede (folio)** com diárias e consumos, **recebimento no caixa** e **NFS-e de hospedagem em rascunho**.

Fica fora da Fase 1 (seção 9): governança completa, lançamento do restaurante no quarto, ADR/RevPAR, CRM e fidelidade, motor de reservas público, channel manager e FNRH Digital (envio ao Ministério do Turismo).

## 2. Quem usa e como o módulo aparece

- **Propriedade = filial.** Cada hotel é uma `filiais`; a rede de hotéis é a empresa/tenant. Isso entrega "vários hotéis" sem tabela nova: tudo leva `filial_id` e as telas filtram por `pode_filial()`.
- **Liberação:** igual aos demais módulos: liberação explícita (`empresa_modulos_liberados`), escolha manual sem CNPJ (`modulos_sem_cnpj`), ramo "Hotelaria" ou CNAE. Prefixos propostos, a confirmar com a contabilidade: `5510` (hotéis, apart-hotéis, motéis) e `5590` (albergues, camping, pensões, outros alojamentos). Regra em `src/lib/cnae-regras.ts` (novo módulo `hotelaria`), usada por `useModulosCnae()` em `src/lib/cnae.ts`; função de banco `hotelaria_liberada()` espelha a regra, como `lava_rapido_liberado()`.
- **Menu:** novo grupo "Hotelaria" no `AppShell` (Recepção, Mapa de ocupação, Reservas, Hóspedes, Acomodações, Tarifas, Configurações do hotel). O ramo hotelaria esconde obras, personalização, lotes de piso e frota.
- **Perfis:** administrador e gestor configuram e dão desconto/estorno; vendedor e caixa operam a recepção (reservar, check-in/out, receber), como no Pet shop. Garçom e cozinha não enxergam nada (política `salao_restrito`). Papel próprio `recepcionista` e `governanta` fica para a Fase 2 (precisa de `ALTER TYPE app_role`, em migration separada, como `garcom` e `producao`).

## 3. O que reaproveita

| Já existe | Uso na hotelaria |
| --- | --- |
| `filiais`, `pode_filial()`, RLS por tenant | Hotel = filial; rede = tenant |
| `clientes` | Pagador/faturamento (CPF/CNPJ, endereço) para NFS-e |
| `caixas` + `caixa_lancar()` | Recebimento de sinal e de check-out, igual a `restaurante_fechar_comanda` |
| `fiscal_config` + `nfe`/`nfe_itens` modelo `nfse` | NFS-e de hospedagem em rascunho, adaptando `_lr_nfse_rascunho` |
| `auditoria` | Estornos, descontos, cancelamentos |
| `webhook.ts` / chave idempotente | Base para canais na Fase 4; as RPCs já nascem idempotentes |
| `salao.tsx`, `lava-patio.tsx`, `painel-locacao.tsx` | Referência visual do mapa e do painel do dia |
| `exige_nao_salao()`, `exige_papel()` | Mesma porta de entrada de toda RPC |

## 4. Modelo de dados

Prefixo `hs_` (hospedagem). Todas as tabelas: `tenant_id` com padrão `current_tenant_id()`, RLS de leitura por empresa, política restritiva `salao_restrito`, `touch_updated_at`, **sem escrita direta** (só por funções `SECURITY DEFINER`), igual ao Lava-Rápido. Chaves compostas `(id, tenant_id)` onde uma tabela aponta para outra, como em `restaurante_salao`.

### 4.1 Cadastros

- **`hs_config`** (uma por filial): `filial_id` único, `checkin_hora` (padrão 14:00), `checkout_hora` (12:00), `taxa_turismo_por_hospede_noite numeric` (0 = não cobra), `cobra_diaria_no_checkout_tardio boolean`, `exige_documento_checkin boolean` (padrão true), `fuso text`.
- **`hs_tipos_uh`**: `id, filial_id, nome, descricao, capacidade_adultos, capacidade_criancas, comodidades text[], ativo`. Ex.: Standard casal, Luxo, Suíte família.
- **`hs_uhs`** (a unidade física): `id, filial_id, tipo_id, numero text, andar, situacao_limpeza` (`limpo` | `sujo` | `inspecionado`; Fase 1 só alterna sujo/limpo), `interditada boolean, motivo_interdicao, ativo`. Único `(filial_id, numero)`.
- **`hs_tarifas`**: `id, tipo_id, nome, vigencia_de, vigencia_ate, dias_semana smallint[]` (0–6; vazio = todos), `valor_diaria`, `valor_adulto_extra`, `valor_crianca`, `minimo_noites`, `prioridade smallint`. Regra de preço (função `_hs_tarifa(tipo, data)`): entre as tarifas cuja vigência e dia da semana cobrem a noite, vence a de maior `prioridade`; empate vence a de menor vigência; sem tarifa a reserva é recusada ("sem tarifa para a noite de dd/mm"). Nada de preço implícito.
- **`hs_hospedes`**: a pessoa, com os campos da FNRH. `id, nome, documento_tipo` (cpf | rg | cnh | passaporte | outro), `documento_numero, nacionalidade, data_nascimento, sexo, profissao, telefone, email, cidade_residencia, estado_residencia, pais_residencia, procedencia, destino, motivo_viagem, meio_transporte, observacoes, cliente_id` (opcional, vínculo com `clientes`). Único `(tenant_id, documento_tipo, documento_numero)` quando preenchido. Estrangeiro sem CPF é suportado: o faturamento é que exige CPF/CNPJ, não o hóspede.

### 4.2 Reservas e calendário

- **`hs_reservas`**: `id, tenant_id, filial_id, numero bigint` (sequência por tenant, igual a `comandas`), `titular_id` (→ `hs_hospedes`), `pagador_cliente_id` (→ `clientes`, opcional até o check-out), `origem` (`balcao` | `telefone` | `whatsapp` | `email` | `outro`; a Fase 3/4 acrescenta motor e canais), `situacao` (`pendente` | `confirmada` | `hospedada` | `finalizada` | `cancelada` | `no_show`), `observacoes, motivo_cancelamento, chave_idempotencia uuid` único por tenant, `criada_por`. Situação da reserva é derivada das UHs, mas gravada para listar rápido e travada pelas funções.
- **`hs_reserva_uhs`**: uma linha por quarto reservado (reserva de 2 quartos = 2 linhas). `id, reserva_id, tipo_id, uh_id` (nulo até atribuir), `entrada date, saida date` (CHECK `saida > entrada`), `adultos, criancas, situacao` (`reservada` | `hospedada` | `finalizada` | `cancelada` | `no_show`), `checkin_em timestamptz, checkout_em timestamptz, valor_acordado_total numeric` (nulo = tarifa; preenchido = negociado, exige gestão).
- **`hs_diarias`**: foto do preço de cada noite no momento da reserva: `reserva_uh_id, data, valor, tarifa_id, lancada boolean`. Mudar a tarifa depois **não** muda reserva já feita. Única `(reserva_uh_id, data)`.
- **`hs_ocupacoes`**: **o calendário único e a trava de overbooking.** `uh_id, periodo daterange` (`[entrada, saida)`), `origem` (`reserva` | `bloqueio`), `reserva_uh_id` ou `motivo`. `EXCLUDE USING gist (uh_id WITH =, periodo WITH &&)`: o banco recusa duas ocupações da mesma UH que se cruzam, mesmo com duas recepcionistas clicando juntas. Exige `CREATE EXTENSION btree_gist`. Reserva sem UH atribuída **não** entra aqui; ela consome estoque do tipo (4.4). Bloqueio (manutenção, uso interno) também mora aqui, por isso uma única tabela.
- **`hs_reserva_hospedes`**: acompanhantes do quarto: `reserva_uh_id, hospede_id, principal boolean`. Crianças entram sem documento.

### 4.3 Conta do hóspede (folio)

- **`hs_folios`**: `id, reserva_id, titulo, principal boolean, situacao` (`aberto` | `fechado`), `fechado_em, caixa_id`. Todo check-in cria o folio principal; a recepção pode abrir folios extras (ex.: "Empresa paga diárias, hóspede paga extras").
- **`hs_lancamentos`**: o razão da conta. `id, folio_id, reserva_uh_id, data_competencia date, tipo` (`diaria` | `taxa_turismo` | `consumo` | `servico` | `ajuste`), `descricao, quantidade, valor_unitario, total` (**sinal único**: estorno é outra linha com `estorna_id`, nunca UPDATE do valor), `situacao` (`lancado` | `cancelado`), `motivo_cancelamento, cancelado_por, origem_ref text` (reservado: `comanda:<id>` na Fase 2), `produto_id` (opcional, para consumos de estoque). Único parcial `(reserva_uh_id, data_competencia, tipo)` para `diaria` e `taxa_turismo`, o que torna o lançamento da noite **idempotente**.
- **`hs_pagamentos`**: `id, folio_id, forma forma_pagamento, valor, tipo` (`sinal` | `pagamento` | `devolucao`), `caixa_id, usuario_id, chave_idempotencia`. Todo valor passa por `caixa_lancar()`. Crediário não é aceito (igual à comanda). Cartão: a Fase 1 registra a forma e o valor; pré-autorização/caução no TEF fica fora (seção 9).
- **Saldo** do folio = soma(`lancado`) − soma(pagamentos `sinal` + `pagamento`) + soma(`devolucao`). Calculado por função `hs_folio_saldo(folio_id)` e pelo espelho em `src/lib/hotelaria.ts`, igual ao par `lava_rapido`/`lava-rapido.ts`, conferido por teste.

### 4.4 Disponibilidade

Para um tipo e um período, disponíveis = UHs ativas e não interditadas do tipo **menos** UHs ocupadas/bloqueadas em `hs_ocupacoes` no período **menos** reservas do tipo ainda sem UH atribuída. A função `hs_disponibilidade` calcula; a atribuição de UH (`hs_reserva_uh_atribuir`) é o ponto que grava em `hs_ocupacoes` e dispara a trava. Reserva criada pelo balcão já tenta atribuir a UH; reservas vindas de canais (Fase 4) poderão ficar sem UH até o dia.

## 5. Funções (RPCs)

Todas `SECURITY DEFINER`, `SET search_path TO public`, começam por `exige_nao_salao()` → `exige_papel(...)` → `_hs_exige_liberado()` → `pode_filial()`, com `REVOKE ... FROM PUBLIC, anon` e `GRANT ... TO authenticated`. As que mexem em calendário ou dinheiro pegam `pg_advisory_xact_lock(hashtextextended('hs_uh:' || uh_id, 0))` (calendário) ou do folio (dinheiro) e aceitam **chave idempotente**: repetir a chamada após resposta perdida devolve o mesmo resultado, como `lr_ordem_retirar`.

### 5.1 Cadastros (administrador, gestor)

| Função | O que faz |
| --- | --- |
| `hs_config_salvar(p_filial, p_dados jsonb)` | Horários e taxa de turismo da filial |
| `hs_tipo_uh_salvar(p_dados)` | Cria/edita tipo; inativar não apaga |
| `hs_uh_salvar(p_dados)` | Cria/edita UH; não deixa mudar o tipo de UH com reserva futura |
| `hs_uh_interditar(p_uh, p_de, p_ate, p_motivo)` | Bloqueio em `hs_ocupacoes`; recusa se houver reserva no período (a gestão remaneja antes) |
| `hs_tarifa_salvar(p_dados)` / `hs_tarifa_remover(p_id)` | Tarifa com vigência; remover não altera `hs_diarias` já gravadas |
| `hs_hospede_salvar(p_dados)` | (também vendedor e caixa) valida documento por tipo (CPF com dígito verificador) e duplicidade |

### 5.2 Reservas (administrador, gestor, vendedor, caixa)

| Função | O que faz |
| --- | --- |
| `hs_cotar(p_filial, p_tipo, p_entrada, p_saida, p_adultos, p_criancas)` | STABLE. Devolve noite a noite e total; erra se faltar tarifa ou `minimo_noites` |
| `hs_disponibilidade(p_filial, p_entrada, p_saida)` | STABLE. Por tipo: total, ocupadas, bloqueadas, sem-UH, disponíveis e preço total |
| `hs_reserva_criar(p_dados jsonb, p_chave uuid)` | Titular, 1..N quartos (tipo + datas + pessoas), UH opcional, sinal opcional. Grava reserva, `hs_reserva_uhs`, `hs_diarias`, `hs_ocupacoes`. Atômica: se um quarto falha, nada grava |
| `hs_reserva_alterar(p_id, p_dados)` | Muda datas, pessoas ou tipo; recota diárias **só das noites ainda não lançadas**; refaz ocupação; recusa se a nova janela não tem vaga |
| `hs_reserva_uh_atribuir(p_reserva_uh, p_uh)` | Atribui/troca a UH (upgrade, troca de quarto); a exclusão do banco é a última barreira |
| `hs_reserva_cancelar(p_id, p_motivo, p_devolver_sinal boolean)` | Libera ocupação. Sinal: se `p_devolver_sinal` é falso fica como receita retida e exige gestão e motivo. Não cancela hospedada (usa check-out antecipado) |
| `hs_reserva_no_show(p_reserva_uh)` | Só depois da data de entrada; libera a UH; cobrança da 1ª diária é decisão da gestão (lança `ajuste`) |

**Como ficou na migration 2 (`20261210000000_hotelaria_reservas.sql`), onde difere do plano acima:**

- **Quarto da reserva:** `hs_reserva_alterar` cuida só dos dados da reserva (titular, pagador, origem, observações). Datas, pessoas e valor acordado mudam no quarto, em `hs_reserva_uh_alterar`. Cancelar existe por reserva (`hs_reserva_cancelar`) e por quarto (`hs_reserva_uh_cancelar`), para reserva de vários quartos.
- **Decisão 6 aplicada:** a reserva do balcão escolhe a acomodação na hora (`uh_id` obrigatório em `hs_reserva_criar`); a coluna segue aceitando nulo para os canais da Fase 4. Por isso `hs_uhs_livres` (acomodações livres no período) entrou para alimentar a escolha.
- **Tarifa:** nova coluna `pessoas_incluidas` (padrão 2). Noite = diária + adultos além do incluído × extra + crianças × valor da criança. O mínimo de noites é o da tarifa da noite de chegada.
- **Alterar mantém o preço:** mudar só as datas preserva o preço das noites que continuam e cota as novas; mudar as pessoas recota todas; valor acordado só pela gestão.
- **Sinal:** fica para a migration 3 (depende da conta do hóspede). `hs_reserva_cancelar` já aceita `p_devolver_sinal`, mas só a migration 3 passa a tratá-lo.
- **Interdição por período:** `hs_uh_interditar` (início, data de volta, motivo) e `hs_bloqueio_remover`, só da gestão. `hs_uh_salvar` recusa mudar o tipo, inativar ou interditar acomodação com reserva a partir de hoje.
- **Calendário:** um bloqueio de lock por hotel (`hs_cal:<filial>`) serializa quem mexe no calendário; a restrição `EXCLUDE` do banco segue como última barreira.
- **Não comparecimento:** a partir do dia da entrada; no próprio dia só a gestão.
- **Hoje** é calculado no fuso do hotel (`hs_config.fuso`, padrão Brasília).

### 5.3 Estadia e conta (administrador, gestor, vendedor, caixa)

| Função | O que faz |
| --- | --- |
| `hs_checkin(p_reserva_uh, p_hospedes jsonb, p_chave uuid)` | Exige UH atribuída, não interditada e `limpo`/`inspecionado`; titular com documento (se `exige_documento_checkin`); acompanhantes; cria folio principal; situação → `hospedada`; devolve dados da ficha. Check-in antes da data prevista só para a gestão |
| `hs_lancar(p_folio, p_dados jsonb)` | Consumo/serviço/ajuste manual. Desconto e ajuste negativo só gestão |
| `hs_lancamento_cancelar(p_id, p_motivo)` | Cria o estorno (linha de sinal oposto + `auditoria`). Diária lançada só a gestão |
| `hs_folio_abrir(p_reserva, p_titulo)` / `hs_lancamento_transferir(p_ids[], p_folio_destino)` | Separar contas e transferir lançamentos entre folios da mesma reserva; trilha em `auditoria` |
| `hs_pagamento_registrar(p_folio, p_forma, p_valor, p_caixa, p_tipo, p_chave)` | Entra no caixa por `caixa_lancar`; filial do caixa = filial da reserva |
| `hs_auditoria_noturna(p_filial, p_data)` | "Fechar o dia": para cada hospedada, lança a diária e a taxa de turismo da noite (idempotente pelo índice único), marca no-shows pendentes para decisão e devolve o resumo. Fase 1 é botão; a Fase 2 pode agendar por cron |
| `hs_estadia_estender(p_reserva_uh, p_nova_saida)` / `hs_estadia_encurtar(...)` | Estender checa vaga e cota as novas noites; encurtar cancela as noites futuras não lançadas |
| `hs_checkout(p_reserva_uh, p_pagamentos jsonb, p_caixa, p_chave)` | Lança as noites pendentes até hoje, exige saldo zerado pelos pagamentos informados (ou saldo zero), fecha o folio, `hospedada` → `finalizada`, UH → `sujo`, cria `_hs_nfse_rascunho` e devolve `{nfe_id, total}`. Repetir devolve o mesmo resultado |
| `hs_uh_situacao(p_uh, p_para)` | Recepção marca UH como `limpo`/`inspecionado`; é a ponte até a governança da Fase 2 |

Não existe "desfazer check-out" na Fase 1: com a NFS-e criada isso vira decisão fiscal; o erro se corrige por estorno e novo lançamento. Fica como pergunta na seção 10.

### 5.4 Leitura (STABLE, só leitura)

| Função | O que devolve |
| --- | --- |
| `hs_mapa(p_filial, p_de, p_ate)` | Grade UH × dia (até 31 dias): célula livre, reservada, hospedada, bloqueada, e a reserva dona |
| `hs_painel_dia(p_filial, p_data)` | Chegadas, saídas, hospedados, ocupação do dia (UHs ocupadas ÷ UHs vendáveis), UHs sujas e saldos em aberto |
| `hs_folio_resumo(p_folio)` | Lançamentos ativos, pagamentos e saldo |

## 6. Fiscal e financeiro

- **NFS-e de hospedagem:** `_hs_nfse_rascunho` adapta `_lr_nfse_rascunho` (mesma busca de `fiscal_config` por filial e por empresa, mesmas pendências: CPF/CNPJ do pagador, inscrição municipal, código do serviço, alíquota de ISS, certificado). Natureza: "Prestação de serviço — hospedagem" (LC 116, item 9.01; código municipal vem da configuração, não é fixado no código). Itens da nota = diárias e serviços do folio; **consumos com produto** (frigobar, loja) ficam fora da NFS-e da Fase 1 porque são mercadoria (NFC-e), e o desconto do folio é rateado proporcionalmente, como no Lava-Rápido (`lava_nfse_desconto`).
- **Pagador sem CPF/CNPJ:** o check-out funciona, a nota fica em rascunho com a pendência "CPF/CNPJ do pagador", como já acontece no Lava.
- **Sinal:** recebido no caixa no ato (`tipo = 'sinal'`), abatido no check-out. Cancelamento sem devolução fica como receita retida e entra na NFS-e só por decisão da gestão (pergunta 10.3).
- **Financeiro:** o dinheiro vira `caixa_movimentos` pelo caixa; contas a receber de empresa/faturado fica fora da Fase 1 (folio `fechado` com saldo pendente é recusado).

## 7. Telas

Rotas em `src/routes/_authenticated/`, TanStack Router, mesmo padrão das telas `lava-*`; lógica pura em `src/lib/hotelaria*.ts` (testável no Node, sem React).

| Rota | Conteúdo |
| --- | --- |
| `hotel-recepcao` | Painel do dia: chegadas, hospedados, saídas, UHs sujas; botões Check-in, Ver conta, Check-out; botão **Fechar o dia** |
| `hotel-mapa` | Grade UH × dias com cor por situação; clicar numa célula livre abre a nova reserva já com UH e datas; clicar numa reserva abre a conta; filtro por hotel, tipo e período |
| `hotel-reservas` | Lista com filtros (situação, datas, hóspede, número); diálogo **Nova reserva** com cotação ao vivo e aviso de falta de vaga |
| `hotel-estadia.$id` | Conta do hóspede: lançamentos, pagamentos, saldo, hóspedes do quarto, **ficha de hospedagem** (impressão em PDF com os campos da FNRH), trocar de quarto, estender/encurtar, check-out e link para a NFS-e |
| `hotel-hospedes` | Cadastro e histórico de estadias do hóspede |
| `hotel-acomodacoes` | Tipos de UH e UHs, interdições |
| `hotel-tarifas` | Tarifas por tipo, vigência, dia da semana e prioridade; simulador de preço de uma estadia |
| `hotel-configuracoes` | Horários, taxa de turismo e regras por hotel |

Todas as telas mostram só os hotéis que o usuário acessa (`pode_filial`). Erro do banco aparece como mensagem em português, nunca em silêncio.

## 8. Ordem de entrega e testes

**Migrations** (próxima numeração livre: após `20261208000000`):

1. `20261209000000_hotelaria_base.sql`: módulo (constraints de `empresas.modulos_sem_cnpj` e `empresa_modulos_liberados`), `hotelaria_liberada()`, `hs_config`, `hs_tipos_uh`, `hs_uhs`, `hs_tarifas`, `hs_hospedes` e funções de cadastro.
2. `20261210000000_hotelaria_reservas.sql`: `btree_gist`, `hs_reservas`, `hs_reserva_uhs`, `hs_diarias`, `hs_ocupacoes`, `hs_reserva_hospedes`, cotação, disponibilidade, criar/alterar/atribuir/cancelar/no-show.
3. `20261211000000_hotelaria_estadia.sql`: folio, lançamentos, pagamentos, check-in, lançar, estorno, transferência, auditoria noturna, estender/encurtar.
4. `20261212000000_hotelaria_checkout_nfse.sql`: `hs_checkout`, `_hs_nfse_rascunho`, `hs_uh_situacao`.
5. `20261213000000_hotelaria_leitura.sql`: `hs_mapa`, `hs_painel_dia`, `hs_folio_resumo`.

**Código:** `cnae-regras.ts` (módulo e prefixos), `cnae.ts`, `ramo.ts` (ramo "Hotelaria"), `AppShell.tsx` (grupo e visibilidade), telas da seção 7.

**Testes** (`node --test`, padrão `tests/lava-rapido.test.ts`): `tests/hotelaria.test.ts` cobrindo noites e cotação, escolha de tarifa por prioridade/dia da semana, sobreposição de períodos `[)`, saldo do folio (inclui estorno e sinal), regras de check-in e a paridade com a regra de CNAE.

**CI do banco** (`supabase/ci/smoke.sql`, seções 89 em diante, atrás da última existente 88), incluindo o que realmente importa nesta fase:

- duas reservas da mesma UH em períodos que se cruzam: a segunda é **recusada pelo banco**; períodos encostados (saída de um = entrada do outro) são aceitos;
- cancelar libera a UH; alterar datas respeita vaga;
- tenant A não lê nem escreve no tenant B; garçom e cozinha não leem nada; papel sem permissão é recusado;
- check-in sem documento, com UH suja ou interditada: recusado;
- `hs_auditoria_noturna` rodada duas vezes não duplica diária;
- check-out repetido com a mesma chave devolve o mesmo resultado e não duplica caixa nem NFS-e;
- estorno nunca altera lançamento; desconto sem gestão: recusado;
- caixa de outra filial: recusado;
- cotação sem tarifa: recusada.

Telas não serão exercitadas no navegador sem sessão real; o fechamento do roadmap dirá isso, como nas fases anteriores.

## 9. Fora da Fase 1

- **Fase 2:** governança (status completo, escala, checklist, perdidos e achados, manutenção da UH), papéis `recepcionista`/`governanta`, **lançar comanda do restaurante no quarto** (usa `origem_ref`), café da manhã incluso/pensão, ADR/RevPAR/pickup/forecast, relatório do auditor noturno, arrastar-e-soltar no mapa, operação offline da recepção, FNRH Digital.
- **Fase 3:** CRM e fidelidade de hóspede, motor de reservas público (aproveita `$empresa.tsx`), iCal, WhatsApp de confirmação/pré-check-in (reaproveita `whatsapp-despacho`).
- **Fase 4:** channel manager (Booking, Expedia, Airbnb), tarifário por canal, rede multi-hotel consolidada, TEF com pré-autorização/caução, faturamento para empresa (contas a receber), reserva de grupo e bloqueio de cotas.

## 10. Decisões pendentes (preciso da sua resposta antes de implementar)

1. **Taxa de turismo e ISS:** a taxa entra na base da NFS-e ou é cobrada à parte (repasse ao município)? Varia por cidade; proposta: ficar fora da base da nota e configurável por hotel.
2. **Diária cobrada quando:** pela auditoria noturna (noite a noite, como hotel de verdade) ou todas no check-in? A proposta é noturna, o que exige alguém rodar **Fechar o dia** (ou o cron da Fase 2). Alternativa simples: lançar tudo na reserva e ajustar no check-out.
3. **Cancelamento e no-show:** regra de multa fixa (ex.: 1ª diária) automática ou sempre decisão manual da gestão? Proposta: manual na Fase 1.
4. **Desfazer check-out:** aceitar que não exista (correção por estorno) ou permitir à gestão enquanto a NFS-e for rascunho?
5. **Papéis:** usar `vendedor`/`caixa` como recepção na Fase 1 (proposta) ou já criar `recepcionista`?
6. **UH sem atribuição:** reserva do balcão exige escolher a UH na hora (proposta, mais simples) ou permite "vaga do tipo" desde já?
7. **Quartos e produto:** diária cria `produtos` (como o serviço do Lava-Rápido, para entrar na nota e nos relatórios) ou fica só em `hs_lancamentos`? Proposta: só `hs_lancamentos`, sem poluir o cadastro de produtos.
8. **CNAE:** confirmar com a contabilidade os prefixos `5510` e `5590`.
