# Fase 0 — Diagnóstico e estabilização

Data: 14/10/2026 · Base analisada: `main` no commit `006037c`, mais a correção do CI.

**Objetivo da fase:** reduzir risco antes de expandir o produto. **Entrega:** mapa dos fluxos e riscos priorizados, com a correção de cada um planejada.

## 1. Resumo

O isolamento **entre empresas** é sólido no que é leitura e escrita direta: todas as 94 tabelas têm RLS, nenhuma política de dados da loja deixa de filtrar por empresa, e as chamadas que recebem o id de um pedido, produto, cliente ou caixa de outra empresa são recusadas.

O ponto fraco é o isolamento **entre papéis dentro da mesma empresa**. As telas escondem o que cada papel não deve ver, mas o banco aceita a operação de quase qualquer papel. Das 114 funções que o usuário pode chamar, só 48 conferem papel dentro delas (as outras 66 conferem apenas a empresa, e algumas delegam a outra função). Num banco montado a partir das migrations, um usuário **motorista** consegue aprovar e cancelar pedidos, emitir NF-e, gerar contas a receber, abrir caixa e dar entrada de estoque, e consegue alterar direto o preço dos itens de um pedido, o total e a situação do pedido, apagar contas a receber e alterar itens de nota fiscal. Um **vendedor** consegue marcar uma nota como autorizada. No servidor, a trava que deveria exigir papel fiscal para transmitir, consultar e baixar notas existe no código mas nunca é chamada.

| # | Risco | Prioridade |
|---|---|---|
| R1 | Papéis só valem na interface: operações críticas aceitam qualquer papel | P0 |
| R2 | Nota fiscal: qualquer papel transmite nota à Sefaz, o vendedor marca a nota como autorizada, qualquer papel altera itens da nota e qualquer usuário vê as empresas e certificados do emissor | P0 |
| R3 | `comissionar_pedido_id` grava comissão em pedido de outra empresa | P0 |
| R4 | Venda guardada sem internet pode ser enviada duas vezes (`frente_venda` não é idempotente) | P0 |
| R5 | Caixa, pedido e filial aceitam referências de outra empresa | P1 |
| R6 | Criar o administrador de um cliente da Ze Tech não desfaz o que já criou se falhar | P1 |
| R7 | Trocar os perfis de um usuário pode deixá-lo sem nenhum perfil | P1 |
| R8 | Salvar a empresa ignora erro ao gravar o regime tributário da configuração fiscal | P1 |
| R9 | Duas fontes de migrations; as do Lovable ficaram fora do CI até agora | P1 |
| R10 | Outras gravações em etapas sem desfazer (filial extra, orçamento, separação, compra) — feito | P2 |
| R11 | Peças da ordem de serviço não baixam estoque — feito | P2 |
| R12 | Auditoria cobre 7 tabelas; faltam financeiro, fiscal, empresa e papéis — feito | P2 |
| R13 | Acesso é por empresa, não por filial (decidido: por filial; feito) | P2 |
| R14 | Formulário público de contato sem limite de envios — feito | P3 |

## 2. Como foi feito e o que não foi

- **Banco:** montei um Postgres vazio com todas as migrations (as 96 de `supabase/migrations` mais as de `drizzle/migrations` que não têm par, na ordem certa) e consultei o catálogo (tabelas, políticas, funções, permissões). É o mesmo banco que o CI usa.
- **Papéis e empresas:** criei um usuário por papel e executei, como cada um, as operações listadas. O script está em `docs/fase-0/verificacao-papeis-e-tenant.sql` e pode ser rodado de novo para conferir cada correção.
- **Código:** li as funções de servidor (`*.functions.ts`), as gravações em etapas das telas e a parte offline.
- **Não verificado:** o banco de produção (pode ter diferenças em relação às migrations), a comunicação real com a Sefaz e o emissor fiscal, o armazenamento do certificado, as configurações de autenticação do Supabase e o comportamento das telas no navegador.

## 3. Mapa dos fluxos por módulo

Menu e módulos: Comercial, Estoque, Compras, Logística, Financeiro, Administração (todos os ramos), mais Restaurante, Assistência técnica e Locação (liberados pelo ramo ou pelo CNAE da empresa, `src/lib/cnae.ts`). São 101 telas autenticadas.

### Varejo e obra (materiais de construção, outros ramos de produto)

| Fluxo | Telas | Funções do banco | Tabelas principais |
|---|---|---|---|
| Orçamento → pedido | `/orcamentos`, `/pedidos` | `converter_orcamento_em_pedido`, `criar_pedido_direto`, `recalcular_orcamento` | `orcamentos`, `orcamento_itens`, `pedidos`, `pedido_itens` |
| Pedido: aprovação, separação, conferência | `/pedidos/$id` | `pedido_avancar_status` | `pedidos`, `pedido_itens`, `pedido_historico` |
| Retirada e entrega parcial | `/pedidos/$id`, `/entregas`, `/motorista` | `pedido_registrar_saida`, `planejar_entrega`, `entrega_concluir`, `entrega_agendar`, `pedido_registrar_ocorrencia` | `entregas`, `entrega_itens`, `entrega_tentativas`, `pedido_ocorrencias` |
| Venda de balcão | `/pdv`, `/frente-caixa` | `frente_venda`, `frente_cancelar_venda`, `frente_registrar_tef` | `pedidos`, `caixa_movimentos`, `tef_transacoes` |
| Caixa | `/caixa`, `/fechamento-operador` | `abrir_caixa`, `caixa_lancar`, `fechar_caixa` | `caixas`, `caixa_movimentos` |
| Devolução | `/devolucoes` | funções de devolução | `devolucoes`, `devolucao_itens` |
| Comissão | `/comissoes` | `comissionar_pedido_id` | `comissoes`, `vendedor_comissao_regras` |
| Obra | `/obras`, `/obra-historico` | (leitura) | `obras` |

### Estoque, compras e logística

| Fluxo | Telas | Funções | Tabelas |
|---|---|---|---|
| Movimentação de estoque | `/estoque`, `/estoque-movimentos`, `/transferencias`, `/inventarios` | `registrar_movimentacao`, `inventario_aplicar` | `estoques`, `estoque_movimentacoes`, `depositos` |
| Lotes e tonalidades | `/estoque-lotes`, `/ajuste-lotes`, `/lotes-offline` | funções de lote | `estoque_lotes`, `estoque_lote_movimentos` |
| Compras | `/compras`, `/cotacoes`, `/nfe-entrada` | `compra_avancar_status`, `receber_compra`, `compra_escolher_cotacao` | `compras`, `compra_itens`, `compra_recebimentos` |
| Rota e motorista | `/rota`, `/entregas-motorista`, `/frota-mapa` | `entrega_iniciar_rota`, `motorista_enviar_posicao` | `motoristas`, `veiculos`, `entregas` |

### Financeiro e fiscal

| Fluxo | Telas | Funções / servidor | Tabelas |
|---|---|---|---|
| Contas a receber e a pagar | `/contas-receber`, `/contas-pagar` | `gerar_contas_receber`, `pedido_checkout` | `contas_receber`, `contas_pagar`, `financeiro_baixas` |
| Nota fiscal | `/nfe` | `gerar_nfe`, `gerar_nfe_agrupada` (banco); `transmitirNfe`, `consultarNfe`, `cancelarNfeSefaz` (servidor) | `nfe`, `nfe_itens`, `fiscal_config` |
| Banco | `/contas-bancarias`, `/banco-movimentos` | — | `contas_bancarias`, `banco_movimentos` |

### Restaurante

| Fluxo | Telas | Funções | Tabelas |
|---|---|---|---|
| Salão, comanda e cozinha | `/salao`, `/cozinha` | `restaurante_abrir_comanda`, `lancar_item`, `enviar_cozinha`, `atualizar_item` | `comandas`, `comanda_itens`, `mesas` |
| Conta e baixa parcial | `/salao` | `restaurante_fechar_comanda`, `restaurante_receber_parcial` | `comanda_pagamentos` |
| Delivery | `/delivery` | `restaurante_abrir_delivery`, `restaurante_delivery_avancar` | `comandas` (tipo delivery), `restaurante_zonas_entrega` |
| Cardápio e ficha técnica | `/cardapio` | `restaurante_movimentar_insumos` | `cardapio_*`, `restaurante_config` |

### Assistência técnica e Locação

| Módulo | Telas | Funções | Tabelas |
|---|---|---|---|
| Assistência | `/assistencia`, `/tecnicos`, `/relatorio-assistencia` | `os_recalcular` (gatilho) | `os_ordens`, `os_itens`, `tecnicos` |
| Locação | `/locacao-balcao`, `/locacoes`, `/painel-locacao` | `locacao_balcao_registrar`, `locacao_gerar_nfse` | `locacoes`, `locacao_itens`, `locacao_equipamentos` |

### Gestão SaaS (equipe Ze Tech)

Telas `ze-tech-*` e funções `saas_*` (10 funções, todas conferem `eh_saas_operador()`), mais `criarAdminCliente` no servidor. Tabelas `saas_*` sem coluna `tenant_id`, protegidas só por `eh_saas_operador()`.

## 4. O que os módulos compartilham

- **Identidade e empresa:** `tenants`, `profiles`, `user_roles`, `empresas`, `filiais`, e as funções `current_tenant_id()`, `has_role()` (que considera a empresa do perfil) e `eh_saas_operador()`.
- **Estoque:** `produtos`, `estoques`, `depositos` e `registrar_movimentacao`, usados por varejo e pelo restaurante (ficha técnica). A locação tem estoque próprio de equipamentos. A assistência baixa as peças da OS do estoque desde a migration `20261015000002` (R11).
- **Caixa:** `caixa_lancar` é chamada pelo caixa do varejo e pela conta do restaurante (`restaurante_fechar_comanda`, `restaurante_receber_parcial`).
- **Financeiro e fiscal:** `contas_receber` e as notas (`nfe`, `fiscal_config`) são usadas por varejo e locação (nota de serviço).
- **Isolamento do salão:** `eh_salao_restrito()` e a trava `exige_nao_salao()` em toda função chamável (CI confere).
- **Código da tela:** `AppShell` (menu e módulos), `useSessionData`, `format.ts`, e os módulos de leitura de código de barras e impressão.
- **Auditoria:** gatilho `auditar_campos` em 7 tabelas (`produtos`, `estoques`, `pedidos`, `pedido_itens`, `orcamentos`, `orcamento_itens`, `cardapio_itens`) e, desde a migration `20261015000003` (R12), `auditar_mudanca` em contas a receber e a pagar, comissões, notas e itens de nota, empresas, filiais, configuração fiscal e papéis.  A tela `/auditoria` (Administração › Auditoria) consulta os registros.

## 5. Autorização, empresa e filial

### 5.1 Isolamento entre empresas — conforme

- 94 tabelas, todas com RLS; 310 políticas. Só as tabelas da Ze Tech (`saas_*`, `contatos`) e o formulário público de contato não filtram por empresa, como esperado.
- Funções de escrita recusam pedido, produto, cliente, caixa e nota de outra empresa (verificado): `pedido_avancar_status`, `gerar_nfe_agrupada`, `gerar_contas_receber`, `caixa_lancar`, `fechar_caixa`, `registrar_movimentacao`, `criar_pedido_direto` com cliente ou produto de outra empresa.
- Exceções encontradas: R3, R5 e, na camada de servidor, `statusEmissor` (R2).
- Nenhuma função é executável pelo visitante anônimo; `onboarding_criar_espaco` e a criação de usuário dependem de verificação própria.

### 5.2 Papéis — não conforme (R1)

Resultado verificado (`PERMITIDO` para **todos** os papéis: vendedor, caixa, estoquista, comprador, financeiro, logística, motorista, gestor e administrador; só o garçom é barrado, pela trava do salão):

| Operação | Função |
|---|---|
| Aprovar e cancelar pedido | `pedido_avancar_status` |
| Emitir NF-e | `gerar_nfe_agrupada` (via `gerar_nfe`) |
| Gerar contas a receber | `gerar_contas_receber` |
| Abrir caixa | `abrir_caixa` |
| Entrada de estoque | `registrar_movimentacao` |

Escrita direta nas tabelas, como motorista, vendedor e estoquista (1 linha alterada em todos): preço e total de item de pedido; total e situação do pedido, inclusive pular direto para `concluido`; apagar conta a receber; alterar quantidade em item de NF-e; alterar preço de produto.

Causa: as políticas de `pedidos`, `pedido_itens`, `contas_receber`, `produtos` (update), `nfe_itens`, `empresas`, `filiais`, `entregas`, `motoristas` e `role_permissoes` só conferem a empresa; e as funções de operação conferem a empresa e a trava do salão, mas não o papel. A tela `/usuarios` (matriz `role_permissoes`) é só de interface: qualquer papel consegue editar a própria matriz.

O que já está certo: `user_roles` (ninguém se dá um papel), `fiscal_config` (só administrador, gestor e financeiro), `cancelarNfeSefaz` (exige administrador ou gestor) e a criação de usuário e de login de motorista (exigem administrador ou gestor).

### 5.3 Fiscal — não conforme (R2)

- **Transmitir, consultar e baixar arquivos da nota sem papel.** Em `src/lib/nfe-fiscal.functions.ts`, `exigirPapelFiscal` (administrador, gestor ou financeiro) só roda quando `carregarNota` recebe o `userId`, e as quatro chamadas (`transmitirNfe`, `consultarNfe`, `cancelarNfeSefaz`, `arquivosNfe`) não passam. Resultado: qualquer usuário logado da empresa transmite uma nota à Sefaz, consulta e baixa os arquivos. Só o cancelamento tem verificação própria, no código da função (administrador ou gestor). A empresa continua protegida, porque a nota é lida com o cliente do próprio usuário (RLS).
- **`statusEmissor` mostra dados de outras empresas.** Qualquer usuário logado recebe a lista de **todas** as empresas e certificados (CNPJ, razão social, validade) da conta do emissor fiscal, que é compartilhada entre os clientes da Ze Tech. Não há verificação de papel nem filtro pela empresa de quem chama.
- **Nota alterável no banco.** `tenant_update_nfe` permite `vendedor`, e não há gatilho que proteja `situacao`, a chave e o protocolo; o vendedor marcou uma nota como `autorizada` (1 linha). `nfe_itens` aceita insert e update de qualquer papel.
- **`gerar_nfe_agrupada` ignora as políticas.** Roda como dono do banco: a regra "só administrador, gestor e financeiro" das políticas de `nfe` vale só para quem grava direto na tabela.
- **Dados do emitente.** `empresas` e `filiais` (CNPJ, inscrição estadual, regime) podem ser inseridas e alteradas por qualquer papel; a política que exige administrador no INSERT de empresa é anulada pela outra, que só confere a empresa.

### 5.4 Empresa e filial

- A política de acesso é por empresa, não por filial: nenhuma das 310 políticas menciona filial (R13). Usuário com `filial_id` enxerga e opera todas as filiais da empresa. Se a intenção é restringir por filial, hoje isso não existe; precisa ser decisão de produto.
- `abrir_caixa`, `criar_pedido_direto` aceitam filial, obra, vendedor e profissional sem conferir que são da empresa (R5): foi possível abrir caixa na filial de outra empresa e criar pedido com obra e vendedor de outra empresa.
- `validaFilial` (cadastro de usuário) confere empresa e filial corretamente.

## 6. Gravações em etapas que podem deixar dados incompletos

| Onde | Passos | Falha no meio | Risco |
|---|---|---|---|
| `criarAdminCliente` (SaaS) | cria empresa → cria usuário → perfil → papel → vínculo no cliente | nada é desfeito: empresa órfã e e-mail preso; repetir cria outra empresa | R6 |
| `atualizarUsuario` | atualiza perfil → apaga papéis → insere papéis | se o insert falhar, o usuário fica **sem papel** e não entra | R7 |
| `empresa.tsx` | grava empresa → vincula perfil → grava `fiscal_config` | erro do `fiscal_config` é ignorado: regime tributário diverge do cadastro e a nota sai com o regime antigo | R8 |
| `filial-extra.tsx` | filial → depósito → configuração fiscal | filial sem depósito ou sem configuração fiscal |R10 (feito) |
| `orcamentos.tsx` | orçamento → itens → recalcular | orçamento vazio ou sem total |R10 (feito) |
| `pedidos.$id.tsx` (separação) | atualiza um item por vez em laço | só parte dos itens fica salva |R10 (feito) |
| `compras.$id.tsx` | altera item → recalcular compra | total desatualizado até a próxima ação (o recálculo é repetível) |R10 (feito) |
| `criarUsuario`, `criarLoginMotorista` | várias etapas | **já desfazem** a conta criada (correção do P0 do Lovable) | — |

As operações de dinheiro e estoque (venda, saída, caixa, comanda, delivery) estão em funções do banco e são atômicas.

## 7. Trabalho sem internet

| Fluxo | Como guarda | Como envia | Se o banco recusar | Idempotente? |
|---|---|---|---|---|
| Frente de caixa | fila no navegador (`fc-fila-<usuário>`) | `frente_venda`, ao voltar a conexão | a venda fica na lista "Vendas (F7)" com o erro; o operador escolhe "Tentar de novo" ou "Descartar" (com confirmação) | **Não** (R4) |
| Salão e delivery | `zt-comandas-offline` no navegador | `restaurante_sincronizar_offline` na reconexão (hook `useSincronizacaoOffline`) | a comanda fica marcada "Recusada" com o erro; nunca é descartada sozinha | Sim, por `offline_id` único |
| Conferência sem internet | cópia (retrato) de estoque e caixa | só leitura | — | — |
| Lotes sem internet | cópia de lotes | só leitura | — | — |
| Páginas | service worker (`public/sw.js`) guarda `/frente-caixa`, `/salao`, `/delivery`, `/conferencia-offline` e os arquivos do sistema; só GET; não guarda chamadas ao servidor | — | — | — |
| Cache de consultas | persistido no navegador; mutações com `networkMode: "always"` | — | — | — |

Não funcionam sem internet: pedidos, compras, financeiro, notas fiscais, entregas e a tela do motorista (a fila offline da logística está no roadmap, P3).

Tratamento de erro: o envio separa "erro de rede" (a operação continua na fila) de "recusa do banco" (fica guardada com a mensagem). A separação é feita por um texto (`/fetch|network|failed/i`); uma mensagem do banco com essas palavras seria tratada como rede e tentada para sempre, sem aviso. Operação recusada nunca é descartada sem o operador decidir, como diz o `AGENTS.md`.

**R4 em detalhe:** `frente_venda` não recebe uma chave do cliente. Se o pedido chega ao banco, grava, e a resposta se perde (conexão que cai no meio, que é o caso de uso offline), a venda continua na fila e é enviada de novo: duplica a venda, a saída de estoque e a entrada no caixa. O mesmo vale para duas abas do mesmo usuário (a fila é do navegador e o controle de envio é por aba). O restaurante já resolve isso com `offline_id`.

## 8. Riscos priorizados e correção planejada

Convenção: **P0** corrige antes de qualquer expansão; **P1** corrige na estabilização; **P2** planeja na próxima fase; **P3** acompanha.

| # | Prioridade | Risco | Evidência | Correção planejada | Teste que passa a existir |
|---|---|---|---|---|---|
| R1 | P0 | Papéis só valem na interface | `docs/fase-0/verificacao-papeis-e-tenant.sql`, bloco 1 e 3 | 1) Definir a tabela de papéis por operação (ver 9). 2) Função `exige_papel(text[])` na primeira linha de cada função crítica (aprovar, cancelar, emitir nota, contas a receber, caixa, estoque, entrega). 3) Trocar as políticas `ALL` por tenant de `pedidos`, `pedido_itens`, `contas_receber`, `produtos`, `empresas`, `filiais`, `role_permissoes` por políticas com papel; mudanças de preço, total e situação só por função. 4) Tirar a escrita direta do cliente onde houver função. | Cada linha PERMITIDO indevida do script vira caso em `smoke.sql`; o smoke falha se uma função crítica nova não tiver `exige_papel` |
| R2 | P0 | Nota fiscal sem proteção de papel nem de estado | `src/lib/nfe-fiscal.functions.ts` (`exigirPapelFiscal` nunca chamada; `statusEmissor` sem checagem); bloco 3 do script (vendedor autoriza nota; todos alteram `nfe_itens`) | Passar o `userId` em `carregarNota` nas quatro funções (e testar); `statusEmissor` só para administrador e restrito à empresa de quem chama (CNPJ do cadastro); gatilho em `nfe` que bloqueia mudança de `situacao`, `chave`, `protocolo` para quem não é o servidor (`service_role`); `nfe_itens` e `nfe` só por função com papel fiscal; `gerar_nfe*` com `exige_papel(administrador, gestor, financeiro)`; `empresas`/`filiais` só administrador e gestor | Teste do servidor: vendedor e motorista recebem recusa ao transmitir, consultar e baixar; `statusEmissor` não lista outra empresa; nota autorizada fica imutável |
| R3 | P0 | Comissão cruzada entre empresas | bloco 2 (empresa B ganhou comissão criada por usuário da A) | `REVOKE EXECUTE` de `comissionar_pedido_id` para `authenticated` (só os gatilhos e funções internas a chamam) e filtro `tenant_id` no corpo | Chamada direta recusada; comissão de pedido da própria empresa segue gerada pelo fluxo |
| R4 | P0 | Venda offline duplicada | `src/routes/_authenticated/frente-caixa.tsx` (fila) e assinatura de `frente_venda` | Parâmetro `p_chave uuid` em `frente_venda`, índice único por empresa em `pedidos`; a tela gera a chave ao finalizar a venda (antes de entrar na fila); reenvio com a mesma chave devolve a venda já gravada. Controle de envio entre abas (lock) | Mesma chave duas vezes grava uma venda, um movimento de caixa e uma saída de estoque |
| R5 | P1 | Referências de outra empresa | bloco 2 (`abrir_caixa`, obra e vendedor em `criar_pedido_direto`) | Conferir filial, obra, vendedor e profissional contra `current_tenant_id()` nessas funções; avaliar chave estrangeira composta (`tenant_id`, `id`) nas tabelas de cabeçalho | Casos do bloco 2 passam a ser recusados |
| R6 | P1 | `criarAdminCliente` sem desfazer | `src/lib/cliente-admin.functions.ts` | Mesmo padrão de `criarUsuario`: guardar o que criou e desfazer (empresa nova e usuário) se qualquer etapa falhar | Teste de servidor simulando falha em cada etapa |
| R7 | P1 | Papéis trocados sem atomicidade | `src/lib/usuario-admin.functions.ts` | Função do banco `usuario_definir_papeis(user, papeis[])` que troca todos de uma vez (uma transação), com a conferência de administrador | Falha no insert mantém os papéis antigos |
| R8 | P1 | `fiscal_config` ignora erro | `src/routes/_authenticated/empresa.tsx` | Conferir o erro e mover "salvar empresa" para uma função do banco (empresa, vínculo e configuração fiscal juntos) | Falha na configuração fiscal desfaz a gravação |
| R9 | P1 | Duas fontes de migrations | `supabase/migrations` (96) e `drizzle/migrations` (25); o Lovable grava só na segunda | Já feito: o CI aplica as duas, na ordem. A fazer: documentar a regra (qual pasta cada pessoa usa), e criar a checagem de nome de política restritiva do salão para qualquer nome (feito neste PR). | CI já falha se tabela ou função nova sair sem proteção |
| R10 | P2 | Outras gravações em etapas | seção 6 | Funções do banco para filial extra, orçamento (com itens) e separação (todos os itens de uma vez); gatilho para o total da compra. Feito na migration `20261014000004_r10_gravacoes_em_etapas.sql` | — |
| R11 | P2 | Peça da OS sem baixa de estoque | nenhuma função ou gatilho de assistência chama `registrar_movimentacao` | Regra adotada: baixa ao aprovar a OS, devolução ao cancelar ou voltar para orçamento. Feito na migration `20261015000002_os_baixa_estoque.sql` | Peça aplicada baixa o estoque uma vez |
| R12 | P2 | Auditoria curta | gatilho em 7 tabelas | Estender a auditoria a `contas_receber`, `contas_pagar`, `nfe`, `nfe_itens`, `empresas`, `filiais`, `fiscal_config`, `comissoes`, `user_roles`. Feito com `auditar_mudanca` na migration `20261015000003_auditoria_ampliada.sql` | Alteração e exclusão geram linha em `auditoria` |
| R13 | P2 | Acesso por empresa, não por filial | nenhuma política cita filial | Decidido pelo dono: acesso por filial. Feito na migration `20261014000003_acesso_por_filial.sql` | — |
| R14 | P3 | Formulário de contato sem limite | política `contatos_insert_publico` | Limite por origem/horário e verificação anti-robô. Feito na migration `20261015000004_contato_limite_envios.sql` (sem CAPTCHA com chave) | — |

## 9. Papéis por operação (proposta para decidir antes de corrigir o R1)

| Operação | Papéis |
|---|---|
| Criar pedido e orçamento | administrador, gestor, vendedor, caixa |
| Aprovar pedido | administrador, gestor |
| Separar e conferir | administrador, gestor, estoquista |
| Planejar entrega e rota | administrador, gestor, logística |
| Concluir entrega | administrador, gestor, logística, motorista (só a própria) |
| Cancelar pedido | administrador, gestor |
| Gerar contas a receber | administrador, gestor, financeiro, caixa |
| Emitir e transmitir nota | administrador, gestor, financeiro, vendedor, caixa (vendedor e caixa incluídos pelo dono para o balcão) |
| Cancelar nota | administrador, gestor |
| Abrir e fechar caixa | administrador, gestor, caixa |
| Ajuste de estoque e inventário | administrador, gestor, estoquista |
| Preço e custo de produto | administrador, gestor |
| Dados fiscais da empresa e filial | administrador |

É uma proposta: o produto hoje não define isso em lugar nenhum, e o desenho da correção depende de quem pode fazer o quê em cada loja. Confirme ou ajuste antes de a correção começar.

## 10. Critério para avançar

- [ ] Tabela de papéis por operação aprovada (seção 9).
- [ ] R1 a R4 corrigidos e cobertos por teste no CI.
- [ ] R5 a R8 corrigidos ou com data marcada.
- [ ] `docs/fase-0/verificacao-papeis-e-tenant.sql` sem nenhum PERMITIDO indevido.
- [ ] CI verde na `main` (Lint, Testes unitários, Typecheck e build, Migrations e segurança).

## 11. Andamento das correções

| # | Situação | O que foi feito | O que falta |
|---|---|---|---|
| R1 | Feito | Tabela da seção 9 aprovada e aplicada no banco (migration `20261014000001_fase0_papeis.sql`): conferência de papel nas funções (`exige_papel`), escrita direta fechada ou restrita por papel nas tabelas; bloco 23 do `smoke.sql` testa cada papel contra cada operação | Os itens fora da tabela (ver abaixo) |
| R2 | Feito | Servidor: `userId` conferido em transmitir, consultar, baixar arquivos e cancelar (`src/lib/nfe-escopo.ts`, com testes); `statusEmissor` só para papel fiscal e só com as empresas do cliente; o retorno da Sefaz é gravado com a chave de serviço. Banco: gatilho `nfe_protege_estado`; emitir nota e recalcular impostos só administrador, gestor e financeiro; `nfe` e `nfe_itens` só para esses papéis; `empresas` e `filiais` só administrador | — |
| R3 | Feito | `REVOKE EXECUTE` de `comissionar_pedido_id`; o fluxo do pedido entregue segue gerando a comissão (teste no bloco 22 do `smoke.sql`) | — |
| R4 | Feito | `frente_venda` recebe `p_chave`; o banco guarda a chave por empresa e devolve a venda já gravada; a tela gera a chave antes de a venda entrar na fila | Aviso na tela quando o reenvio devolver uma venda que já existia (hoje é silencioso) |
| R5 | Feito | `abrir_caixa` confere a filial; `criar_pedido_direto` confere obra, vendedor e profissional | Chave estrangeira composta (`tenant_id`, `id`), a avaliar |
| R6 | Feito | `criarAdminCliente` desfaz empresa e usuário se uma etapa falhar (`src/lib/desfazer.ts`, com testes) | — |
| R7 | Feito | `usuario_definir_papeis`: troca todos os papéis numa transação | — |
| R10 | Feito | Quatro fluxos viraram uma transação só: `filial_extra_criar` (filial + depósito + configuração fiscal; só administrador), `orcamento_salvar` (cabeçalho + itens + total calculado no banco, com cliente, obra, vendedor, profissional e produtos conferidos na empresa), `separacao_salvar` e `conferencia_salvar` (todos os itens ou nenhum; administrador, gestor e estoquista); o total da compra passa a acompanhar os itens por gatilho. As telas chamam as funções. Achado no caminho: a restrição antiga `fiscal_config (tenant_id, empresa_id)` impedia a configuração fiscal da filial extra e foi removida (os índices parciais já fazem a regra certa). Bloco 25 do `smoke.sql` | — |
| R11 | Feito | `os_ordens.deposito_id` (de onde saem as peças) e gatilhos: a partir de "aprovada" (aprovada, em reparo, pronta, entregue) as peças com produto são baixadas do depósito; cancelar ou voltar para aberta, em análise ou orçamento devolve; peça incluída, alterada ou removida depois da aprovação acompanha na hora; cada item guarda o que foi baixado (`baixa_*`, que o usuário não altera), então a baixa não se repete. Sem depósito ou sem saldo a aprovação é recusada com a mensagem. As OS que já existiam ficaram fora (`controla_estoque = false`). A tela de OS ganhou o campo "Depósito das peças". Bloco 27 do `smoke.sql` | Decisão do dono sobre a regra (aprovar x concluir); peças digitadas sem produto não baixam |
| R12 | Feito | `auditar_mudanca`: registra quem, quando, o que mudou (antes e depois) e exclusões em `contas_receber`, `contas_pagar`, `comissoes`, `nfe`, `nfe_itens`; também inclusões em `empresas`, `filiais`, `fiscal_config` e `user_roles`. Segredos (`nfse_token`, `nfse_usuario`) entram mascarados (`***`); o contador de numeração da nota (`proximo_numero`) fica fora, porque muda a cada emissão. Alteração do servidor entra com usuário em branco; apagar uma empresa em cascata não é barrado pela auditoria. Bloco 28 do `smoke.sql` | Ampliar a outras tabelas se quiser |
| R14 | Feito | A gravação direta em `contatos` foi fechada; o formulário chama `contato_enviar`: campo escondido preenchido não grava (finge sucesso), envio antes de 3 s é recusado, valida tamanho, e-mail e WhatsApp, limita 5 envios por hora por origem (hash do IP, o IP não é guardado) e 100 por hora no total, e o mesmo contato em 10 minutos conta como um. Bloco 29 do `smoke.sql` | CAPTCHA com chave (Turnstile/hCaptcha): fecha o que ainda passa por chamada direta à API; precisa de uma chave da empresa |
| R13 | Feito | Decisão do dono: acesso por filial. `pode_filial` e `filial_irrestrita`; política restritiva `filial_restrita` em `pedidos`, `caixas`, `depositos`, `contas_receber`, `contas_pagar`, `nfe`, `orcamentos`, `compras`, `devolucoes` e, por herança, `pedido_itens`, `pedido_historico`, `entregas`, `entrega_itens`, `caixa_movimentos`, `estoques`, `estoque_movimentacoes`; gatilho `filial_protege` para gravações dentro das funções (venda, caixa, nota, entrega, estoque). Administrador, gestor e usuário sem filial no perfil veem todas as filiais; linha sem filial é de todos. Bloco 24 do `smoke.sql` | Tabelas com `filial_id` que ficaram de fora (ver abaixo); telas com filtro de filial para a gestão, se quiser |
| R8 | Feito | `empresa.tsx` passa a conferir o erro da configuração fiscal | Mover "salvar empresa" para uma função do banco (uma transação) |
| R9 | Feito | CI aplica as duas pastas de migrations; checagem do salão por política restritiva, qualquer nome | Regra escrita de qual pasta cada pessoa usa |


### Papéis aplicados (seção 9 aprovada)

| Operação | Como é imposto | Papéis |
|---|---|---|
| Criar pedido | `criar_pedido_direto` (já conferia) | administrador, gestor, vendedor, caixa |
| Criar e alterar orçamento | política de `orcamentos` e `orcamento_itens`; `converter_orcamentos_em_pedido` | administrador, gestor, vendedor, caixa |
| Aprovar, cancelar e concluir pedido | `pedido_avancar_status` (papel pelo destino) | administrador, gestor |
| Separar e conferir | `pedido_avancar_status` (separação até pronto); gravação de `quantidade_separada`, `quantidade_conferida` e `divergencia` | administrador, gestor, estoquista |
| Planejar entrega e rota; agendar | `planejar_entrega`, `entrega_agendar`; `pedido_avancar_status` para em rota e entregue | administrador, gestor, logística |
| Concluir entrega | `entrega_concluir`, `entrega_insucesso`, `entrega_iniciar_rota` | administrador, gestor, logística; motorista só da própria entrega |
| Receber pagamento do pedido | `pedido_checkout` | administrador, gestor, financeiro, caixa |
| Gerar contas a receber; lançar e baixar títulos | `gerar_contas_receber`; política de `contas_receber` (ninguém apaga) | administrador, gestor, financeiro, caixa |
| Emitir nota; recalcular impostos | `gerar_nfe`, `gerar_nfe_agrupada`, `nfe_calcular_impostos` | administrador, gestor, financeiro, vendedor, caixa (ampliado em 14/10 pelo dono, para a nota do balcão) |
| Escrever direto em `nfe` e `nfe_itens` | políticas de `nfe` e `nfe_itens` | administrador, gestor, financeiro (vendedor e caixa só pelas funções de emissão) |
| Transmitir e consultar nota | servidor (`nfe-escopo`) | administrador, gestor, financeiro, vendedor, caixa |
| Cancelar nota | servidor | administrador, gestor |
| Abrir e fechar caixa | `abrir_caixa`, `fechar_caixa` (a frente de caixa mantém a permissão por operador, `pode_abrir_caixa`) | administrador, gestor, caixa |
| Entrada e ajuste de estoque; inventário | `registrar_movimentacao`, `inventario_aplicar` | administrador, gestor, estoquista |
| Preço e custo de produto | gatilho `preco_protege` em `produtos` e `produto_variacoes` | administrador, gestor |
| Dados da empresa e da filial | política de `empresas` e `filiais` | administrador |
| Matriz de permissões do menu | política de `role_permissoes` | administrador |

As vendas, o PDV e a frente de caixa continuam baixando estoque, reservando e gerando parcelas por dentro: as funções que fazem isso passaram a ter uma versão interna (`*_interno`), sem acesso do usuário, e a versão pública confere o papel.

### Fora da tabela aprovada: decisões que tomei e itens que ficaram como estavam

- **Confirmado pelo dono**: o motorista só inicia a rota, registra sucesso (conclui) ou insucesso da entrega vinculada ao seu cadastro de motorista (`motoristas.user_id`); nada além disso. Já era assim no banco.
- **Decisões**: receber pagamento do pedido, lançar e baixar contas a receber e escrever em `orcamento_itens` seguem os papéis da linha mais próxima da tabela. Confirme ou ajuste.
- **Acesso por filial (R13), o que decidi**: exceção para administrador, gestor e quem não tem filial no perfil (matriz); linha sem filial fica visível a todos. Não aplicado a `clientes`, `contas_bancarias`, `locacoes`, `os_ordens`, `tecnicos`, `veiculos`, `motoristas`, `fiscal_config`, `tef_*`, `mesas` e `comandas` (cadastros compartilhados ou módulos à parte). Transferência entre depósitos de filiais diferentes só pela gestão. Quem já tem filial no perfil passa a ver só a própria filial depois da migration.
- **Ficaram como estavam** (a tabela não diz): `pedido_registrar_saida` (retirada no balcão e entrega registrada) e `pedido_registrar_ocorrencia`; transferência entre depósitos, devolução e recebimento de compra; `caixa_lancar` (lançamento manual no caixa); `fiscal_config` (administrador, gestor e financeiro); custo médio em `estoques`; comissões.
- **Efeito nas telas**: quem perdeu acesso vê o erro da função como aviso. Nenhuma tela foi escondida ou reorganizada. Os casos que mais devem aparecer: o botão de emitir NF-e logo após a venda no PDV (`/pdv`) agora só funciona para administrador, gestor e financeiro, então vendedor e caixa recebem recusa ao emitir a nota do balcão; o vendedor que agendava entrega ou recebia o pagamento pela tela do pedido também recebe recusa. Se o balcão precisa emitir nota, é só incluir vendedor e caixa na linha "emitir e transmitir nota" da tabela, e a mudança é uma linha por função.
