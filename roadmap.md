# Roadmap

- [x] Liberar todos os módulos para empresa-modelo, incluindo Personalização e Obras, preservando cadastro fiscal e permissões; liberações conferidas no banco, 22 testes passaram e Obras/Personalização abriram com sessão autenticada.

- [x] Tela Módulos sem CNPJ no menu Administração, com caixinhas e prévia das opções; 17 testes passaram e tela autenticada conferida sem erros, sem alterar a empresa real. Salvamento em negócio sem CNPJ não exercitado nesta verificação.

- [x] Seleção de módulos sem CNPJ: campo salvo na empresa, regra central e clínica alinhadas, 13 testes passaram; caixinhas e ocultação com CNPJ conferidas na sessão autenticada, sem salvar alterações na empresa real.

- [x] Redefinir senha do administrador em Editar cliente assinante: cinco testes de proteção passaram e campos/confirmar/cancelar conferidos com conta autenticada; nenhuma senha real alterada na verificação.

- [x] Corrigir a leitura do PDF com dois DACTEs: quatro testes passaram e a tela reconheceu 727506 e 727538 com suas respectivas chaves; vínculo existente conferido por consulta, sem lançar novo frete.

- [x] Detalhes das notas já importadas: botão Ver nota com fornecedor, chave, produtos, recebimento e valores; conferido com a nota nº 16670, sem alterar dados.

- [x] Corrigir visibilidade e reenvio de comandas offline recusadas; 6 testes passaram e recuperação online conferida com conta autenticada e respostas de recusa/sucesso simuladas, sem movimentar dinheiro real.

- [x] Painel Ze Tech: quantidade de notas emitidas por cliente (`/ze-tech-notas` + RPC `saas_notas_por_cliente`)
- [x] Painel fiscal por loja: entradas, saídas, saldo e impostos por período (`/painel-fiscal` + RPC `painel_fiscal_loja`)
- [x] Módulo Assistência técnica: ordens de serviço com peças e mão de obra (`/assistencia`)
- [x] Módulo Locação de equipamentos: equipamentos e contratos (`/locacao-equipamentos`, `/locacoes`)
- [x] Menus novos no AppShell (Assistência técnica, Locação, Painel fiscal, Notas emitidas)

## Rodada 2

- [x] Tela de clientes da Ze Tech com histórico de cobranças, filiais e situação (`/ze-tech-clientes`)
- [x] Impostos da nota calculados pela filial emitente (interna/interestadual pela UF)
- [x] Contas a pagar no painel Ze Tech (`/ze-tech-contas-pagar`, tabela `saas_contas_pagar`)
- [x] Botões de baixar a nota em PDF e XML (`src/lib/nfe-arquivos.ts`)
- [x] Painel Ze Tech de assistência técnica (`/ze-tech-assistencia` + RPC `saas_assistencia_por_cliente`)
- [x] Cadastro de técnicos (`/tecnicos`, tabela `tecnicos`, `os_ordens.tecnico_id`)
- [x] Assistência técnica por loja (`/assistencia-lojas` + RPC `assistencia_por_filial`)
- [x] Tempo real das lojas no painel Ze Tech (`/ze-tech-tempo-real` + RPC `saas_tempo_real_por_cliente`)

## Rodada 3

- [x] Painel Ze Tech de custo por técnico (`/ze-tech-tecnicos` + RPC `saas_custo_por_tecnico`, horas em `os_ordens.horas_trabalhadas`)
- [x] Relatório de assistência por loja com exportação em PDF (`/relatorio-assistencia` + RPC `assistencia_ordens_relatorio`)
- [x] Módulos de assistência e locação liberados pelo CNAE principal/secundários (`src/lib/cnae.ts`, `empresas.cnae_secundarios`)

## Rodada 4 — Balcão de locação e NFS-e (concluída)

- [x] Balcão de locação (/locacao-balcao): vários equipamentos, período, pagamento à vista ou parcelado
- [x] Tabela locacao_itens e RPC locacao_balcao_registrar
- [x] Nota fiscal de serviço (NFS-e) da locação: RPC locacao_gerar_nfse, modelo/código do serviço/ISS na nfe
- [ ] Configurar inscrição municipal, código do serviço e alíquota de ISS reais para a NFS-e sair pronta

## Rodada 5 — Frente de caixa

- [x] Frente de caixa em tela cheia com atalhos (`/frente-caixa`)
- [x] Sugestão de produtos por IA a partir de texto livre
- [x] Caixa por operador, troca de operador, senha do gestor (cancelar, desconto acima do limite, sangria)
- [x] Relatório de fechamento por operador (`/fechamento-operador`)

## Rodada 6 — Segurança, qualidade e paridade com ERPs de mercado

Origem: auditoria de segurança e comparativo com ERPs de mercado (Bling, Tiny/Olist, Omie, Conta Azul, TOTVS, Linx, Sankhya). O comparativo vem de conhecimento geral dos produtos; confirmar antes de investir. O que consta como ausente é o que não foi encontrado no código.

### Segurança e qualidade (concluído)

- [x] Cadastro público deixa de dar administrador do primeiro tenant; perfil nasce sem tenant e sem papel
- [x] Onboarding de quem se cadastra sozinho (`/boas-vindas` + RPC `onboarding_criar_espaco`)
- [x] `has_role` considera o tenant do perfil; papéis sem tenant herdam o do perfil
- [x] `recalcular_*` e `banco_conta_padrao` sem acesso entre tenants; `anon` fora das funções SECURITY DEFINER
- [x] `caixas`, `caixa_movimentos`, `auditoria` e `estoque_movimentacoes` sem escrita direta pelo cliente
- [x] CI no GitHub Actions: migrations com testes de segurança (`supabase/ci`), typecheck, build e lint bloqueante
- [x] Lint limpo (0 erros)

### Prioridade alta — recebimento e fiscal no balcão

- [ ] NFC-e no PDV e na frente de caixa (hoje só NF-e modelo 55 e NFS-e; o cupom do PDV não é fiscal)
- [ ] Boleto registrado e Pix com cobrança automática e baixa automática (hoje boleto é só forma de pagamento; a cobrança Ze Tech usa link e linha digitável informados à mão)
- [x] Importação de extrato bancário (OFX) na conciliação: lê o arquivo, concilia sozinho o que bate (valor, sentido, até 3 dias) e deixa o resto em "Pendências do extrato" para lançar ou ignorar (`banco_extrato_importar`, `src/lib/ofx.ts`). Pendente: API bancária (Open Finance) e vínculo manual com lançamento existente
- [ ] TEF integrado à maquininha (hoje há cadastro de credenciadora e painel, sem integração com a maquininha)

### Prioridade média

- [ ] SPED Fiscal e Contribuições e exportação de arquivos para a contabilidade
- [ ] Importação em massa por planilha: produtos, clientes e saldos de estoque (hoje só cotações)
- [ ] Integrações: e-commerce e marketplaces, WhatsApp automático, API pública e webhooks
- [x] Trabalho sem internet: frente de caixa, salão e delivery abrem sem conexão (páginas guardadas no aparelho), vendas e comandas ficam salvas e são enviadas ao voltar; venda recusada fica guardada para resolver; tela "Conferência sem internet" com saldo de estoque e caixa
- [ ] CT-e e MDF-e para clientes com frota e transporte de terceiros
- [ ] Configurar inscrição municipal, código do serviço e alíquota de ISS reais para a NFS-e (item pendente da Rodada 4)

### Prioridade baixa

- [ ] Auditoria ligada: registrar quem alterou preço, desconto e estoque (a tabela `auditoria` existe, mas nada grava nela)
- [ ] Relatórios: filtros salvos, exportação para planilha em todas as telas e painéis por meta
- [ ] Diferenciais de construção: cálculo de quantidade (m² de piso, sacos de cimento) e lista de materiais por obra

### Dívida técnica

- [ ] Testes automatizados do front, começando pelo cálculo de impostos, XML da NF-e e fluxo de caixa
- [ ] Lockfile reproduzível na CI (o `bun.lock` aponta para um registro privado do Lovable; a CI instala sem trava de versões)
- [ ] Quebrar as telas maiores (`pedidos.$id.tsx` e `compras.$id.tsx`) em componentes
- [ ] 60 avisos de lint (`react-hooks/exhaustive-deps`, `react-refresh/only-export-components`)
- [ ] Medir o custo de `has_role` nas policies com dados reais

## Rodada 7 — Restaurante e lanchonete (novo ramo)

Decisão: o restaurante entra como ramo da mesma plataforma (mesmos login, empresa, estoque, financeiro e fiscal), com telas próprias para salão e cozinha. Primeira versão: à la carte e lanchonete com mesas e comandas, sem delivery.

### Etapa R1 — Salão

- [x] Banco: cardápio (categorias, itens, grupos de opções com obrigatório e máximo, opções com acréscimo), mesas e comandas
- [x] Perfis `garcom` e `cozinha` no banco; ramo "Restaurante e lanchonete". **Ainda não atribuíveis pela tela de usuários**: hoje as políticas das demais tabelas (clientes, produtos, contas...) valem para qualquer usuário da empresa, então um garçom ou cozinheiro veria dados que não deve
- [x] Isolamento dos perfis do salão: política restritiva `salao_restrito` em toda tabela com RLS (fora da lista liberada: sessão, cardápio, mesas e comandas), trava `exige_nao_salao()` nas funções chamáveis, menu e redirecionamento próprios; `garcom` e `cozinha` liberados em `PERFIS`. O `smoke.sql` falha se surgir tabela ou função nova sem a proteção
- [x] Regras no banco (RPCs): abrir comanda, lançar item com opções, enviar à cozinha, andamento do preparo, cancelar item (garçom antes do envio; gestão depois, com motivo), transferir de mesa, cancelar comanda, fechar com serviço, couvert, desconto só da gestão, pagamento dividido e lançamento no caixa
- [x] Testes de segurança do banco (permissões por perfil, isolamento entre empresas, escrita direta negada, numeração sequencial)
- [x] Tela de cadastro do cardápio, das opções dos pratos e das mesas (`/cardapio`, só gestão)
- [x] Tela do salão (`/salao`): mesas, comandas, lançamento de itens com opções, envio à cozinha, entrega, troca de mesa e cancelamento. Falta validar no celular e no uso real
- [x] Tela da cozinha em tempo real (`/cozinha`), com filtro cozinha/bar e alerta de atraso
- [x] Fechamento de conta (serviço, couvert, desconto da gestão, divisão entre pagantes, vários pagamentos e caixa)
- [x] Baixa parcial da mesa: quem vai embora paga a própria parte e a comanda segue aberta. Por itens (unidades já entregues, serviço proporcional e couvert de quem sai) ou por valor livre; o fechamento cobra só o saldo. Item pago não é cancelado e comanda com recebimento não é cancelada. Pendente: estorno de baixa parcial
- [x] PDV do restaurante: leitor de comanda (código de barras `C123` da etiqueta impressa, ou número da mesa digitado), mesas vermelhas (ocupadas) e verdes (livres) e configuração da quantidade de mesas (`Cardápio e mesas`, cria de 1 até N e desativa as que sobram, sem mexer em mesa ocupada). Falta leitura por câmera do celular
- [x] Módulo liberado pelo ramo "restaurante" ou CNAE 56.xx, com menu "Restaurante"

### Etapas seguintes

- [x] R2 — Ficha técnica: insumos por prato e por opção (ex.: bacon extra), com perda de preparo; custo, lucro e CMV de cada prato; baixa de estoque ao enviar à cozinha (depósito da cozinha configurável); bebida de revenda ligada a um produto baixa 1 unidade; cancelar na fila devolve os insumos, depois de iniciado o preparo não volta. Pendente: conversão de unidades (g ↔ kg), produção de preparos (molhos, bases) e relatório de perdas
- [x] R3 — Delivery próprio: pedido com cliente, endereço, zona/taxa e pagamento previsto; painel por etapa (montando, cozinha, pronto, em rota, entregue); impressão do pedido
- [ ] R3b — Integração iFood (o banco já tem `canal` e `codigo_externo`; falta credencial de parceiro)
- [ ] R4 — Impressão térmica, balcão e garçom em tablet
- [ ] NFC-e (depende da Fase 2): obrigatória para operar restaurante

## Maquininha simulada (teste antes da ponte real)

- [x] Modo `simulado` na configuração do TEF: a frente de caixa mostra o painel "MODO DE TESTE" com "Simular aprovação" (NSU `SIM-…`, autorização e bandeira de exemplo) e "Simular recusa"; a venda segue o mesmo caminho do TEF real (`frente_venda` + `frente_registrar_tef`) e o cupom sai marcado como simulado
- [x] Teste de segurança do banco com a venda completa (transação, caixa, estoque, recusa, isolamento entre empresas, cancelamento e estorno)
- [x] Correção: cancelar venda de balcão com lançamento no caixa falhava por tipo de `forma_pagamento`

## Rodada 7 — Especialização em materiais de construção (em sequência, com conferência entre etapas)

- [x] P0 Segurança: notas fiscais exigem administrador/gestor/financeiro e conferem empresa da nota; status do emissor só para administrador e só da própria empresa; filial validada na gestão de usuários; criação de usuário e login de motorista desfazem a conta se uma etapa falhar e evitam vínculo duplicado
- [x] P1 Venda e entrega: retirada/entrega parcial com trava de saldo e chave contra reenvio, ocorrências (falta/sobra/avaria/substituição), agendamento/reagendamento com motivo, visão por item no pedido (orçamento→pedido já existia)
- [x] P1 resto: romaneio impresso por entrega (`/entregas` e pedido: quantidade, item, data, saldo e assinaturas), leitura de código de barras no novo pedido, na separação, na conferência e na saída (`3*código`), histórico unificado da obra (`/obra-historico`)
- [x] Teste de banco com pedido real de obra: retirada parcial, saldo por item, trava de saída, agendado contra o saldo, reagendamento com motivo e ocorrências (`supabase/ci/smoke.sql`, bloco 21); o CI passa a aplicar também as migrations que o Lovable grava só em `drizzle/migrations`
- [x] P2 Sugestão de reposição revisável por fornecedor (`/sugestao-compra`, RPC `compra_criar_de_sugestao`), considerando vendas, reservado, já pedido, mín/máx, prazo e embalagem de compra. Compras, cotações, XML da NF-e e estoque físico/reservado/disponível já existiam
- [ ] P2 resto: lote/tonalidade de pisos (precisa de modelo de lote no estoque), motivo obrigatório em ajustes de inventário/transferência
- [ ] P3 Logística no celular com fila offline
- [ ] P4 Painéis e indicadores com origem do valor
- [ ] P5 Financeiro e estrutura de conciliação/CNAB (sem banco real até haver credenciais)
- [ ] P6 Catálogo, API versionada e integrações
- [ ] Implantação: importação por planilha e passos iniciais

## Etapa 2/3 — complemento

- [x] Lotes, tonalidade e calibre por depósito (`/estoque-lotes`, RPC `estoque_lote_lancar`, histórico permanente)
- [x] Conferência sem internet mostra mínimo e o que falta
- [x] App do motorista no celular (`/motorista`) já atualiza entregas e histórico da obra
- [ ] Teste real: cotação com fornecedor → XML → entrada no estoque após venda (precisa de fornecedor e XML reais)
- [ ] Ligar lote à venda/separação e à importação do XML
- [x] Lote/tonalidade escolhido no item do pedido e visível na separação (RPC `pedido_item_definir_lote`)
- [x] Tela "Lotes sem internet" (`/lotes-offline`) com saldo e histórico
- [ ] Baixar o saldo do lote automaticamente na saída do pedido e preencher lote na importação do XML
- [ ] Teste do app do motorista "não entregue" (nenhum motorista tem login e nenhuma entrega está em rota)

## Fase 0 — Diagnóstico e estabilização

- [x] Mapa dos fluxos, núcleo compartilhado, revisão de papéis, empresa e filial, gravações em etapas e trabalho sem internet: `docs/diagnostico-fase-0.md`
- [x] Script que repete a verificação de papéis e de isolamento entre empresas: `docs/fase-0/verificacao-papeis-e-tenant.sql`
- [x] P0: papéis no banco (R1) e papel na nota fiscal e nos dados do emitente (R2), pela tabela de papéis aprovada
- [x] P0: comissão entre empresas (R3), venda offline duplicada (R4), nota fiscal protegida no servidor e no banco (parte de R2)
- [x] Importação do XML de entrada que não trava: limite de 45 s com "Cancelar importação", outra nota pode ser importada em seguida, lotes do XML na mesma transação da compra, nota repetida recusada com atalho para a compra já criada; duplicidade conferida pela chave ou por número + série + fornecedor, com aviso já ao escolher o XML e mensagem de "em processo de importação" quando outra chamada da mesma nota está em andamento
- [x] CAPTCHA (Cloudflare Turnstile) no formulário de contato: o envio passa pelo servidor, que confere o desafio; só o servidor chama a função do banco. Liga ao cadastrar as chaves (`docs/captcha-turnstile.md`); sem elas o formulário segue como antes
- [x] P3: formulário público de contato com limite de envios (R14): 5 por hora por origem, 100 por hora no total, campo escondido anti-robô, tamanho e formato validados
- [x] Salvar empresa numa transação só (`empresa_salvar`): empresa, vínculo do administrador no primeiro cadastro e regime da configuração fiscal; só administrador
- [x] Aviso na frente de caixa quando uma venda guardada sem internet já estava registrada (a resposta tinha se perdido): a venda não é lançada de novo e o aviso fica na tela até ser fechado
- [x] Tela de auditoria (`/auditoria`, só administrador e gestor): filtros por o que mudou, tipo, usuário e período; mostra o valor de antes e o de depois; filtro "Sistema" para o que o servidor alterou; índices por empresa e data
- [x] P2: auditoria ampliada (R12): financeiro, notas fiscais, empresa, filiais, configuração fiscal, comissões e papéis, com exclusões e segredos mascarados
- [x] P2: peças da ordem de serviço baixam o estoque ao aprovar e devolvem ao cancelar (R11)
- [x] P2: gravações em etapas viram transação (R10): filial extra, orçamento, separação e conferência; total da compra por gatilho
- [x] P2 (decisão do dono): acesso por filial (R13); NF-e do balcão por vendedor e caixa
- [x] P1: referências entre empresas (R5), criação de cliente SaaS e troca de papéis sem desfazer (R6, R7), regime tributário ao salvar a empresa (R8)

## Fase 2 — Recebimento e fiscal no balcão

- [x] Base da NFC-e no banco (migration `20261016000000_nfce_base.sql`): configuração com CSC secreto e numeração própria (`nfce_config`, só administrador e gestor), nota modelo 65 criada pelo pedido (`nfce_criar`, idempotente, com CPF opcional e lista de pendências), número reservado só quando a nota está pronta, campos de contingência e tentativas protegidos como o andamento da nota, auditoria sem o token
- [x] Tela de pendências fiscais (`/pendencias-fiscais`): notas rejeitadas, em contingência, sem retorno há mais de 15 minutos e NFC-e em rascunho; eventos de pagamento que falharam, foram ignorados ou ficaram sem resposta (só administrador, gestor e financeiro)
- [ ] Transmissão da NFC-e pela ACBr, com contingência e nova tentativa (depende de liberar `dev.acbr.api.br` ou da documentação da API de NFC-e)
- [x] Tela para cadastrar o CSC e a série da NFC-e (`/nfce-config`, só administrador e gestor): o token fica guardado e não volta para a tela; série e contingência manual; o contador é do sistema
- [x] Botão de emitir NFC-e na frente de caixa (no cupom da venda e na lista de vendas do caixa): CPF opcional validado, mostra o número ou o que falta resolver; a venda guardada sem internet só libera o botão depois de enviada. A transmissão à Sefaz continua pendente
- [x] Botão de emitir NFC-e no PDV (cupom da venda concluída), com o mesmo painel da frente de caixa (CPF opcional, pendências, andamento). A transmissão à Sefaz continua pendente
- [x] NFC-e das vendas do restaurante: ao fechar a conta, o caixa e a gestão veem o painel da NFC-e da comanda (`nfce_criar_comanda`, `nfe.comanda_id`). Itens saem do produto ligado ao item do cardápio (item sem produto fiscal vira pendência); taxa de serviço e couvert entram como outras despesas (`nfe.valor_outras_despesas`) — **confirmar esse tratamento com o contador antes de transmitir**. Pendente: reabrir a NFC-e de comanda já fechada (hoje só logo após o fechamento) e a transmissão à Sefaz
- [ ] Pix com cobrança automática e boleto registrado (depende do provedor escolhido)
- [x] Importar nota de entrada pelo PDF digital (DANFE), com conferência antes de gravar
- [x] Produção baixa o saldo por tamanho quando o pedido sai de "Aguardando arte" (cancelamento devolve)

## Fase 1 — Entrada de dados

- [x] Importação por planilha de produtos, clientes e saldos de estoque (`/importacao`, migration `20261017000000_importacao_planilha.sql`): CSV (separador `;`, `,` ou tabulação, UTF-8 ou Latin-1), modelo para baixar, colunas por apelido, pré-visualização com erro por linha e conferência no banco antes de gravar (código já existente, depósito, saldo reservado); entra tudo ou nada, até 5000 linhas por vez, uma importação por vez por empresa e tipo; categorias novas são criadas; "atualizar os que já existem" muda só os campos preenchidos; saldos entram como ajuste de estoque com histórico; histórico das importações; relatório de erros em CSV
- [ ] Importação direta de arquivo `.xlsx` (hoje salvar como CSV no Excel)
- [ ] Importar fornecedores, obras e preços por tabela; limite por plano de assinatura
- [ ] Passos iniciais de implantação (checklist guiado depois do cadastro da empresa)

## Rodada 8 — Pet shop e veterinária (`docs/pet-shop-fase-1.md`)

- [x] Base: módulo liberado por CNAE (`7500`, `4789004`, `9609208`, a confirmar com a contabilidade) ou pelo ramo "Pet shop e veterinária"; produto marcado como serviço (`produtos.controla_estoque = false`) não tem saldo nem movimento (venda, cancelamento, reserva e importação ignoram), fora de reposição e giro
- [x] Pets e tutores (`/pets`), serviços e preço por porte/raça/pelagem (`/pet-servicos`, com simulação "quanto custa para este pet") e profissionais com comissão (`/pet-profissionais`); grupo de menu "Pet shop" (`pet_salvar`, `pet_servico_salvar`, `pet_preco_salvar`, `pet_preco_calcular`, `pet_profissional_salvar`)
- [x] Agenda de banho e tosa (`/pet-agenda`): agendamento só pela recepção, profissional sem dois atendimentos ao mesmo tempo, preço e duração congelados, situações agendado → confirmado → em atendimento → pronto, cancelar/faltar com motivo, remarcar (`pet_agendar`, `pet_agenda_situacao`, `pet_reagendar`). "Retirado" sai da cobrança (próximo PR)
- [x] Cobrança pela frente de caixa ("Retirar e cobrar" abre o caixa com os serviços; o operador escolhe a forma de pagamento) com NFS-e em rascunho, comissão do profissional sobre os serviços (aprovar/pagar em `/pet-comissoes`) e relatório "Serviços por profissional"; NFC-e leva só a mercadoria; venda cancelada devolve o atendimento a "pronto" e cancela a comissão não paga (`pet_agenda_retirar`). A cobrança do pet shop exige internet
- [ ] Clínica veterinária (escopo próprio)

## Rodada 9 — Pet shop, Fase 2 (`docs/pet-shop-fase-2.md`)

- [x] PR 5 — Contatos com o tutor (`/pet-contatos`): aniversário do pet e retorno de banho, com link do WhatsApp e mensagem editável; quem foi chamado sai da lista (`pet_contatos_pendentes`, `pet_contato_registrar`). Sem envio automático
- [x] PR 6 — Pacotes de banho (`/pet-pacotes`): um pacote por pet, validade de 30/60/90 dias, vendido adiantado no caixa; o banho sai do pacote na retirada (sem cobrar de novo); agenda e cobrança avisam no penúltimo banho que resta só mais um; NFS-e na venda do pacote; comissão pelo valor de cada uso (`pet_pacote_vender`, `pet_agenda_retirar` com `p_usar_pacote`, `pet_agenda_cobertura`). Confirmar com a contabilidade quando a NFS-e do pacote deve sair
- [x] PR 7 — Venda a granel (`/granel`, grupo Estoque): o saco guarda o produto vendido por kg e os kg do saco (`produtos.granel_produto_id`/`granel_fator`, informados no cadastro do produto); "abrir saco" baixa o saco e dá entrada dos kg no granel pelo custo proporcional, com histórico (`granel_abrir_saco`, `granel_aberturas`). A venda por kg segue o caixa normal
- [x] PR 8 — Agenda própria do profissional (`/pet-minha-agenda`): perfil novo **Profissional** (mesmo isolamento do salão: não lê nada da loja), conta ligada ao cadastro (`pet_profissionais.profile_id`, `pet_profissional_vincular`), vê só os atendimentos dele (sem preço, telefone nem documento) e avança Começar/Pronto (`pet_minha_agenda`, `pet_minha_situacao`)
- [ ] Lembretes automáticos (depende da integração oficial do WhatsApp)

## Rodada 10 — Pet shop, Fase 3: clínica (`docs/pet-shop-fase-3.md`)

- [ ] Escopo desenhado; decisões registradas (só o veterinário lê o prontuário; guarda do prontuário segue em aberto com o responsável técnico — nada é apagado)
- [x] PR 1 — Base da clínica: módulo `clinica` (CNAE 7500 ou ramo "Clínica veterinária"), perfil **Veterinário** (mesmo isolamento do Profissional; agenda própria vale para os dois), CRMV e UF obrigatórios para a função veterinário, conta ligada precisa combinar com a função, categorias de serviço consulta/vacina/exame. O isolamento do texto clínico em si vem com as tabelas, no PR 2
- [x] PR 2 — Consulta e prontuário (`/clinica-prontuario`, `/clinica-atendimento`): só o perfil Veterinário lê e escreve o texto clínico, sempre por funções (as tabelas não têm acesso direto, nem para administrador); atendimento aberto pela consulta agendada, fechado fica imutável (nem o dono do banco altera) e a consulta vai para pronto; correção só por adendo com nome e CRMV; histórico do paciente, busca, alergia do pet e registro de quem abriu cada ficha; tudo exige a clínica liberada
- [x] PR 3 — Vacinas e vermífugos (`/clinica-catalogo`, `/clinica-vacinas`, `/clinica-cartao`): catálogo com série de doses e reforço (a gestão cadastra; sugestões marcadas para o veterinário conferir); aplicação dentro do atendimento de vacina, com lote e validade, baixando 1 dose do lote e do estoque; série e reforço calculados; auxiliar como aplicador sob o veterinário; cancelamento com motivo devolve a dose; vacina aplicada em outro local entra no cartão sem baixa; cartão imprimível para recepção, gestão e veterinário. O item cobrável é o serviço da agenda
- [x] PR 4 — Reforços (`/clinica-reforcos`): pets com vacina ou vermífugo para tomar (padrão 15 dias à frente) ou atrasado (até 180 dias), uma linha por pet e data, com os itens; "Chamar no WhatsApp" (mensagem editável, guardada no navegador) e "Já falei" tiram o pet da lista naquela data; vale a aplicação mais recente de cada item (cancelada não conta, sem próxima dose e item inativo saem, pet com vacina já agendada não aparece); só nome do item e data, nada do prontuário (`clinica_reforcos_pendentes`, contatos do tipo `reforco`)
- [ ] PR 5 — Cobrança clínica (caixa, NFS-e em rascunho, comissão do veterinário)

## Rodada 11 — Pet shop, Fase 4: exames, lembretes e trabalho sem internet (`docs/pet-shop-fase-4.md`)

- [x] Escopo desenhado; decisões respondidas: só cães e gatos, offline cobre cadastro, atendimento, vacina e exame. Em aberto: outras fichas do sistema atual e 3 pontos do PR 5 (quem leva o notebook, validade da cópia, bloqueio e senha)
- [x] PR 1 — Atalhos da próxima dose (21 dias, 30 dias, 1 ano)
- [x] PR 2 — Exames: modelos de hemograma (com VCM, HCM, CHCM e RDW), bioquímica e urina, com unidade e faixa por espécie; faixa guardada no resultado
- [x] PR 3 — Exames: resultados só com número, cálculo do hemograma, valor fora da faixa, evolução e laudo
- [x] PR 4 — Exames: anexos (ultrassom, raio-x, laudos) em armazenamento privado
- [ ] PR 5 — Trabalho sem internet (cães e gatos; cadastro, atendimento, vacina e exame): 5a base segura (cofre criptografado, fila, pendências, preparar visita) ✔ · 5b cadastros ✔ · 5c atendimento ✔ · 5d vacina e exame ✔ · 5e anexos ✔

## Rodada 12 — Paridade com o legado Delphi (`projeto-legado`)

Origem: comparativo entre o erpzetech e o ERP legado (Delphi/MySQL, repositório `felipeaugusantos/sistema`, pasta `projeto-legado`). A coluna "o que o legado tem" vem de nomes de pastas e arquivos, sem leitura das regras de negócio; antes de cada item, ler o código do legado indicado e confirmar no erpzetech que o recurso realmente não existe. Itens fora do alvo atual (tintométrico e indústria/ordem de produção) ficam em "Fora do alvo".

### Etapa 12.1 — Recebimento e fiscal (prioridade alta)

- [ ] NFC-e no PDV e na frente de caixa, com cupom fiscal (legado: `ecf/`, `paf/`, `DanfeNFCe.fr3`; repete o item da Rodada 6)
- [ ] Boleto registrado, remessa/retorno CNAB 240/400 e baixa automática (legado: `boleto/`, `autban/`, `libIntegracaoContasBancarias/`, `EnviaEmailBoletoMonitor`)
- [ ] Pix com cobrança e baixa automática, com consulta periódica de pagamentos (legado: `libIntegracaoPixCitel/`, `ConsultaPagamentosPixMonitor`, `Link.Pagamento`)
- [ ] TEF real com a maquininha e conciliação de cartão por adquirente (legado: `libTefMultiplus/`, `libTefCitel/`, `PinPad/`, `libCartoes/`, `libIntegracaoCartoes/`)
- [ ] SPED Fiscal, SPED Contribuições e exportação para a contabilidade (legado: `fiscal/untExecutaSPED.pas`, `libReinf/`, `Contabilidade/`, `MonitorContabil`)
- [ ] CT-e e MDF-e emitidos pela loja (hoje só há leitura de DACTE para custo de frete)

### Etapa 12.2 — Preço, promoção e cadastros em massa (prioridade alta)

- [ ] Tabelas de preço com faixa de desconto por cliente, grupo, marca e perfil (vendedor/gerente), com desconto máximo por atividade (legado: `CadFaixaDesc*`, `CadDescontoCliente*`, `CadDescontoMaximoPorAtividade`)
- [ ] Promoção, combo/kit e cupom de desconto (legado: `Promocao/`, `CadComboProdVenda`, `CadCupomDesconto`)
- [ ] Alteração global de preço e de desconto com prévia (legado: `untAltPrecoGlobal`, `AlteracaoGlobalDescontoProdutos`)
- [ ] Importação em massa por planilha: produtos, clientes, fornecedores e saldos de estoque (repete o item da Rodada 6; legado: `ImportacaoDados/`)

### Etapa 12.3 — Gestão financeira (prioridade média)

- [ ] Plano de contas, centro de custo e rateio de lançamentos (legado: `CadCentroCusto`, `CadCtaResultados`)
- [ ] DRE, balancete e previsão orçamentária por mês (legado: `ClasseBalanceteFinanceiro`, `CadPrevisaoMensal`)
- [ ] Cheques pré-datados e emitidos (legado: `financeiro/chequepre/`, `chequeemitido/`)
- [ ] Open Finance / extrato bancário por API, além do OFX (legado: `libIntegracaoContasBancarias/`)

### Etapa 12.4 — Operações, depósito e logística (prioridade média)

- [ ] Endereçamento de depósito: armazém, rua/prateleira, doca e operador (legado: `CadArmazem`, `CadDocas`, `untEnderecamentoProduto`)
- [ ] Número de série e controle de garantia com checklist e envio de conserto ao fornecedor (legado: `untControleNumeroSerie`, `Garantia/`)
- [ ] Consignação, comodato, remessa e entrega futura com saldo e baixa por documento fiscal (legado: `fiscal/CFOP/`, `Entrega.Futura`, `RecalculoEntregaFuturaMonitor`)
- [ ] Integração de frete: cotação e etiqueta com transportadoras (legado: `Intelipost`, `Jadlog`, `Mandae`, `LalaMove`, `Correios`, `Frenet`, `DataFrete`)
- [ ] Cálculo de rota de entrega (legado: `Calculo.Rota`)

### Etapa 12.5 — Relacionamento e canais (prioridade média)

- [ ] CRM: leads, ocorrências, ações automáticas e histórico por cliente (legado: `crm/`)
- [ ] Cashback e clube de fidelidade (legado: `CadCashback`, `untClubeFidelidade`)
- [ ] Pesquisa de satisfação pós-venda (legado: `Pesquisa.Satisfacao.Tracksale`)
- [ ] WhatsApp e SMS automáticos: aviso de pedido, entrega e cobrança (legado: `whatsapp/`, `sms/`)
- [ ] E-commerce e marketplaces, incluindo iFood (Rodada 7, R3b) e etiqueta de despacho (legado: `MarketPlace/`, `B2W/`, `iLog/`)

### Etapa 12.6 — Relatórios e qualidade (prioridade média)

- [ ] Relatórios com filtros salvos, exportação para planilha em todas as telas e editor de modelos (legado: `editorRelatorios/`, ~357 modelos `.fr3`)
- [ ] Testes automatizados de imposto (ICMS, ST, DIFAL, IPI, CFOP) usando os casos do legado como referência (legado: `TestCase/`, `TestesUnitariosStClientes` e similares)
- [ ] Verificar se o horário gravado em vendas feitas sem internet vem do servidor, não do relógio do aparelho (o legado proíbe `Now()` por esse motivo)
- [ ] Adotar `docs/specs/<rodada>/spec.md`, `plan.md` e `tasks.md` por rodada, no formato usado em `projeto-legado/IA/specs`
- [ ] Quebrar `pedidos.$id.tsx` e `compras.$id.tsx` seguindo a separação em camadas do módulo `Contabilidade/` do legado

### Fora do alvo (portar só se a Ze Tech atender o segmento)

- [ ] Tintométrico: hub de marcas e fórmulas (legado: `autcomtinta/`, `auttin/`, `LibTintas/`)
- [ ] Indústria: estrutura de produto, ordem de produção e custos (legado: `industrial/`, `OrdemProducaoIndustrial/`)
