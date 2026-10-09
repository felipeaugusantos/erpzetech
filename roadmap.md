# Roadmap

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
- [ ] Importação de extrato bancário (OFX ou API) na conciliação
- [ ] TEF integrado à maquininha (hoje há cadastro de credenciadora e painel, sem integração com a maquininha)

### Prioridade média
- [ ] SPED Fiscal e Contribuições e exportação de arquivos para a contabilidade
- [ ] Importação em massa por planilha: produtos, clientes e saldos de estoque (hoje só cotações)
- [ ] Integrações: e-commerce e marketplaces, WhatsApp automático, API pública e webhooks
- [ ] PDV offline com fila de vendas (hoje o service worker só mostra página de "sem internet")
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
