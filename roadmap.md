# Roadmap

- [x] Prontuário carrega cartões de todos os pacientes já atendidos da empresa, sem exigir busca; lista paginada por último atendimento, com animal, tutor, última visita e próxima consulta futura agendada/confirmada (ou sem consulta agendada), quantidade de visitas e acesso à ficha, mantendo o acesso veterinário existente.

- [x] Guardar PDF original nas duas importações usando anexos clínicos privados e reservas reutilizadas em reenvios; histórico por pet acessa arquivos e imprime datas, valores exatos, situação, adendos e minigráficos dos fechados. 28 testes de histórico/precisão e três de envio/importação passaram; A4 controlado confirmou ALT 30,5 → 26,9 e datas no PDF. Build OK; gravação real depende da sessão veterinária pendente abaixo; não publicado.

- [x] Importação do PDF por pet: conferência conjunta dos resultados reconhecidos, criação de modelos/campos faltantes e exames em rascunho numa transação idempotente. 48 testes de lógica/proteção e uma regressão de importação passaram; PDF real de Léo mostrou Hemograma e Bioquímica, ALT 26,9 e unidades editáveis, computador/celular sem transbordamento. Plaquetas ambíguas continuam avisadas, não convertidas. Build OK; não publicado.
- [ ] Conferir gravação e leitura dos exames importados com acesso veterinário real: sessão disponível é da gestão, não veterinária; prévia validada com respostas controladas, sem criar exames no paciente real.

- [x] Tela Laudos e evolução por pet, acessível em Exames e Prontuário: todos os exames com resultados e adendos, evolução dos fechados por nome/unidade e minigráfico dos quatro últimos. Trinta testes passaram; comparação controlada 30,5 → 26,9 conferida no navegador. Conta disponível não lê os exames de Léo; verificação com sessão veterinária real permanece pendente. Nenhum resultado alterado; não publicado.

- [x] Corrigir consulta automática de CEP em Clientes, reutilizando a consulta dos tutores; CEP real 01001-000 preencheu Praça da Sé, Sé, São Paulo/SP em computador e celular, preservando número e complemento. Seis testes passaram, consultas antigas canceladas, sem alterar cadastros reais; não publicado.

- [x] Incluir minigráficos na impressão com até três resultados anteriores compatíveis do paciente e o atual, mantendo valores exatos. Consulta real de Léo não tem anteriores fechados (não mostra gráfico); histórico controlado validou gráfico, valores 30,5 e 26,9, folha A4 e celular. Corrigido deslocamento da janela apenas na impressão do laudo. 42 testes passaram; nenhum resultado gravado; não publicado.

- [x] Preservar decimais dos exames sem arredondamento na tela, impressão e cálculos; 39 testes passaram, função decimal confirmada no banco, ALT 26,9 conferido no exame real de Léo pela conta de Bruna e no laudo para impressão. Nenhum resultado ou exame fechado alterado; não publicado.

- [x] Importar PDF digital de laboratório no exame aberto, com prévia, conferência de paciente/espécie, resultados compatíveis e apenas referências absolutas do leucograma deste exame; não converter plaquetas sem unidade, não modificar modelos ou exames fechados. PDF de Leo conferido na conta real: 22 campos do hemograma, confirmação obrigatória, rascunho e envio verificados com gravação interceptada, computador/celular sem transbordamento. 38 testes passaram. Leitura conservadora de tabelas digitais compatíveis; digitalizações e outros formatos não reconhecidos exigem conferência manual. Não publicado.

- [x] Registrar somente as oito referências absolutas destacadas nas observações dos campos do Hemograma da clínica da Bruna; removidas as anotações relativas e de plaquetas acrescentadas anteriormente, conforme o novo recorte. Leitura confirmou as oito faixas e seus campos; nenhum resultado de paciente registrado. Faixas automáticas permanecem desativadas: a imagem omite espécie e unidades; ativação para cães e gatos aguarda validação da veterinária/laboratório.

- [x] Preencher rua, bairro, cidade e UF automaticamente pelo CEP no cadastro do tutor, preservando número e complemento e permitindo edição manual. Consulta real do CEP 01001-000 conferida na conta da clínica; sucesso e erro controlados verificados, sem gravar registros. Treze testes passaram; não publicado.

- [x] Organizar o tutor novo pela referência: nome em destaque e abas Endereço e contatos, Documentos e Observações; apelido, e-mail, WhatsApp separado e inscrição estadual nos campos existentes. Dez testes passaram; conferido na conta da clínica em computador e celular e envio interceptado, sem criar cadastros fictícios. Sem novas regras financeiras; não publicado.

- [x] Incluir CPF ou CNPJ e endereço completo no tutor novo de Pets e tutores, reutilizando Clientes. Documentos e endereço aparecem para tutor existente, com acesso a Clientes para edição. Conta real da Bruna, formulário desktop/celular e envio PF/PJ conferidos com gravação interceptada; nenhuma pessoa fictícia cadastrada. Nove testes passaram. Não publicado.

- [x] Corrigir autorização compartilhada do WhatsApp: aceita clínica ou Lava rápido, mantendo papéis, isolamento e lista autorizada do servidor. Migração aplicada; conta real da Bruna confirmou clínica=true, Lava rápido=false e autorização para o próprio tenant; tela abriu sem o aviso indevido. 34 testes passaram e build OK. Pareamento do número não concluído nem mensagens enviadas.

- [x] Solicitação de exames: selecionar modelos ativos da clínica e adicionar à relação, sem digitar nomes; mantém observações e remoção. Conta real de Bruna/Thor conferida sem modelos cadastrados; inclusão de dois exames e remoção verificadas com resposta simulada, sem emitir documento. Nove testes de documentos passaram; não publicado.

- [x] Painel da clínica: pacientes com visitas e exames por período, busca e paginação; leitura exclusiva da gestão sem texto clínico/resultados. Thor conferido na conta real de Bruna: duas visitas e nenhum exame cadastrado, computador e celular sem transbordamento. Testes de proteção adicionados; teste SQL completo depende do papel privilegiado da CI (sandbox não permite SET ROLE). Não publicado.

- [x] Clínica: painel próprio (/clinica-painel, gestão), visão por veterinário (/clinica-veterinarios), favoritos do bulário com dose e validade (bulário e prontuário) e receita impressa com logo e cor da empresa. Typecheck e 63 testes OK; telas não vistas com sessão real (empresa de teste sem clínica). PDF baixado ainda sem logo. Não publicado.

- [x] Modernizar gráficos do Dashboard: barras arredondadas, valores exatos e linha de faturamento integrada ao período; 23 testes passaram, conta autenticada confirmou R$ 1.224,00 em 18/10 e 2 pedidos aprovados, computador e celular sem transbordamento ou erros, build OK. Não publicado.

- [x] Converter embalagens na importação da nota: campo Unidades por embalagem, fator automático quando a unidade de compra cadastrada corresponde à nota, prévia de 3 × 6 = 18 UN e custo proporcional; 14 testes passaram, prévia autenticada e celular conferidos, build OK. Nenhuma compra gravada nem estoque existente corrigido; não publicado.

- [x] Histórico Google Drive: tela própria acessível por Backup na nuvem, com data e hora do envio em Brasília, tamanho e situação; navegação autenticada e celular conferidos sem erros, quatro testes existentes passaram. Conta ainda sem execuções reais para conferir linhas de envio; não publicado.

- [x] Backup no Google Drive: tela, conexão por administrador, envio noturno e retenção implementados; 35 testes passaram, tela autenticada e cron sem autenticação recusado conferidos. Não publicado.
- [ ] Verificar envio real e retenção no Google Drive: depende de consentimento do administrador no botão Conectar Google Drive; autorização de acesso durante desenvolvimento foi recusada. Publicação necessária para o job usar a versão nova.

- [x] Isolamento do resumo de IA: ficha remontada por paciente; 3 testes de troca em cache, resposta atrasada e rascunho de alergia, mais 10 testes existentes, passaram. Prontuário aberto com sessão real sem erros; geração real de IA não exercitada (testada com resposta simulada). Não publicado.

- [x] Equipe Ze Tech criada com listagem, nova conta com confirmação por e-mail, liberação de conta existente e remoção de acesso; gestão exclusiva do administrador original, que não pode ser removido. Nove testes passaram; listagem autenticada e recusa real de conta inexistente conferidas. Nenhuma conta real criada/removida; recebimento do e-mail e entrada de novo integrante ainda não verificados. Não publicado.

- [x] Integrar central Help Ze Tech: chave compartilhada salva; tela /chamados em Ajustes, abertura/listagem com empresa derivada do acesso e reenvio com a mesma chave idempotente. Consulta real autenticada retornou lista vazia; formulário conferido sem enviar chamado, 25 testes passaram e build OK. Não publicado. A central exige CNPJ; empresas sem CNPJ precisam de alteração no Help antes de abrir chamados. Envio real e recebimento de e-mail ainda não exercitados.

- [x] Hotelaria, Fase 1, telas: Recepção (painel do dia, check-in com ficha, check-out com prévia, fechar o dia, liberar limpeza), Mapa de ocupação, Reservas, Reserva e conta do hóspede (ações de estadia, lançamentos, sinal e pagamentos, estorno, transferência, nota), Hóspedes, Acomodações, Tarifas com simulador e Configurações, mais o grupo Hotelaria no menu. Inclui a migration 20261222 (`hs_checkout_previa`) com a seção 94 do smoke. CI do banco, 648 testes, lint, typecheck e build passaram. **As telas não foram abertas no navegador**: as migrations 20261217 a 20261222 ainda não estão no banco do app, então só compilaram e passaram nos testes de lógica. Pendente: aplicar as migrations no banco do app, gerar de novo os tipos do Supabase, exercitar cada tela com sessão real e ajustar o que aparecer.

- [x] Hotelaria, Fase 1, migration 5 (leitura): mapa de ocupação (acomodação × dia, ocupações com as datas reais, bloqueios, totais por noite e quartos sem acomodação, janela de até 62 dias), painel do dia (chegadas, saídas, atrasos, hospedados, ocupação em %, acomodações sujas e contas em aberto, para hoje, dia passado e dia futuro), resumo da conta (com estornos marcados e a nota) e resumo da reserva. Só leitura, só quem opera o hotel e só do próprio hotel e da própria empresa. CI do banco com a migration 20261221 e a seção 93 do smoke, 644 testes, lint, typecheck e build passaram. O banco da Fase 1 está completo; as telas ainda não existem, nem o item de menu. Pendente: telas (recepção, mapa, reservas, conta do hóspede, hóspedes, acomodações, tarifas e configurações) e aplicar as migrations 20261217 a 20261221 no banco do app.

- [x] Hotelaria, Fase 1, migration 4 (check-out e NFS-e): check-out que lança as noites que faltam desde o check-in, encurta a saída antecipada, cobra ao menos uma noite, exige a conta zerada (pagamento até o saldo, devolução só do crédito) e deixa a acomodação suja até a recepção liberar; reserva de vários quartos com conta compartilhada (cobrança e nota no último quarto) e contas extras; NFS-e de hospedagem em rascunho por conta (hospedagem por quarto e serviços; taxa de turismo e consumo de mercadoria ficam de fora; desconto rateado e ISS sobre o líquido). CI do banco com a migration 20261220 e a seção 92 do smoke, 642 testes, lint, typecheck e build passaram. Sem telas ainda. Pendente: mapa de ocupação e painel do dia (migration 5) e as telas.

- [x] Hotelaria, Fase 1, migration 3 (estadia): conta do hóspede com razão que só cresce (corrigir é estornar, nunca mudar o valor), lançamentos de consumo, serviço e ajuste da gestão, separar contas, sinal e pagamentos pelo caixa do mesmo hotel (devolução só da gestão), check-in com a ficha de hospedagem e acompanhantes, fechar o dia (diária e taxa de turismo da noite sem duplicar, com chegadas pendentes e saídas atrasadas), estender, encurtar e trocar de quarto no meio da estadia, e cancelamento e não comparecimento tratando o sinal (devolver pelo caixa ou reter como receita, só a gestão retém). CI do banco com a migration 20261219 e a seção 91 do smoke, 640 testes, lint, typecheck e build passaram. Sem telas ainda. Pendente: check-out com NFS-e em rascunho, mapa e painel do dia (migrations 4 e 5) e as telas.

- [x] Hotelaria, Fase 1, migration 2 (reservas): reserva de um ou mais quartos, atômica e idempotente pela chave; calendário de ocupação com restrição `EXCLUDE` no banco (duas reservas da mesma acomodação não se cruzam, nem com duas pessoas reservando juntas; saída de uma é entrada da outra); preço de cada noite guardado na reserva (mudar a tarifa depois não muda o que já foi vendido), cotação com adulto extra, criança e mínimo de noites; disponibilidade por tipo e acomodações livres; alterar datas e pessoas, trocar de acomodação (upgrade com preço mantido só pela gestão), cancelar por reserva ou por quarto, não comparecimento e interdição por período. CI do banco com a migration 20261218 e a seção 90 do smoke, 636 testes, lint, typecheck e build passaram. Sem telas ainda. Pendente: sinal e conta do hóspede, check-in, check-out com NFS-e, mapa e painel do dia, e as telas.

- [x] Hotelaria, Fase 1, migration 1 (base): módulo liberado por ramo Hotelaria, liberação explícita, escolha sem CNPJ ou CNAE 55.10-8 e 55.90-6; configuração por hotel (hotel = filial), tipos de acomodação, acomodações (UH), tarifas com vigência, dia da semana e prioridade, e hóspedes com os campos da ficha nacional (CPF conferido, estrangeiro sem CPF aceito). Escrita só por funções (`hs_*`), cadastros só da gestão, recepção cadastra hóspede, salão sem acesso e isolamento por empresa e por hotel. CI do banco com a migration 20261217 e a seção 89 do smoke, 633 testes, lint, typecheck e build passaram. Sem telas e sem item de menu ainda. Pendente: reservas e mapa (migration 2), check-in, conta do hóspede e check-out (migrations 3 e 4), leitura do painel (migration 5) e as telas. Escopo em `docs/hotelaria-fase-1.md`.

- [x] Módulos do sistema: cada empresa tem um módulo principal (Material de Construção, Pet Shop, Clínica Veterinária ou Lava-Rápido, no campo ramo de atividade) e o cadastro de produto muda conforme ele. Campos comuns seguem nas colunas de sempre e os próprios do módulo ficam em `produtos.dados_modulo` (lista única em `src/lib/modulos-produto.ts`, igual à do banco e conferida por teste). Outros ramos seguem com o cadastro padrão. CI do banco com a migration 20261126 e a seção 75 do smoke, 572 testes, lint, typecheck e build passaram. Telas não exercitadas no navegador com sessão real. Pendente: importação por planilha e nota de entrada ainda não preenchem os campos do módulo, e a fila offline do Lava-Rápido.

- [x] Lava rápido, Fase 3: checklist de avarias na entrada (exigência opcional por empresa e imutável depois de concluído), fotos de antes e depois (armazenamento privado, caminho reservado pelo banco, cancelar sem apagar, foto reduzida no navegador) e painel Ze Tech por cliente (`/ze-tech-lava-rapido`). CI do banco com migrations 20261122 a 20261124 e seções 71 a 73 do smoke, 562 testes, typecheck e build passaram. Telas e envio real de foto não exercitados no navegador com sessão real. Pendente: envio automático do WhatsApp (exige a API oficial contratada), cobrança recorrente no cartão, comissão nas lavagens cobertas e fila offline para o lava rápido.

- [x] Lava rápido, Fase 2: planos mensais por veículo (vendidos no caixa, com saldo e validade), fidelidade (a N-ésima lavagem é brinde), avisos ao cliente pelo WhatsApp (veículo pronto, plano vencendo, retorno; envio assistido pela recepção) e insumos no estoque por serviço (baixa na entrega que nunca trava a cobrança). CI do banco com migrations 20261119 a 20261121 e seções 68 a 70 do smoke, 559 testes, typecheck e build passaram. Telas não exercitadas no navegador com sessão real. Pendente: envio automático do WhatsApp (exige a API oficial contratada), cobrança recorrente no cartão e fila offline para o lava rápido.

- [x] Lava rápido, Fase 1 (carro, moto, caminhonete, avião e helicóptero): módulo liberado pelo CNAE 45.20-0/06, por liberação explícita ou por escolha sem CNPJ; veículos (placa ou prefixo da aeronave), serviços com preço por tipo de veículo, lavadores com comissão, pátio com aguardando/lavando/secando/pronto e "Entregar e cobrar" pela frente de caixa com NFS-e em rascunho. CI do banco (migrations + 57 conferências novas de permissão, preço, cobrança e venda cancelada), 11 testes novos, typecheck e build passaram. Telas não exercitadas no navegador com sessão real. Fica para a Fase 2: planos mensais, WhatsApp automático, fidelidade e insumos no estoque.

- [x] Acesso por usuário sem link: /auth aceita código estável da empresa, exibido ao administrador e ao criar acessos; 21 testes passaram e senha incorreta recusada no servidor. Entrada com senha real de operador sem link não exercitada.
- [x] Tempo Real corrigido para pedidos.total; tela autenticada mostrou 4 pedidos e R$ 2.036,88, consulta real conferida e prévia sem erros.

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
- [x] Mapa de mesas com status e praças de produção: mesa livre/ocupada/reservada/bloqueada com filtro no `/salao`; bloqueio (só mesa sem comanda aberta, trava por gatilho também na transferência) e reserva de mesa (nome, telefone, pessoas, data/hora; vale 30 min antes a 2 h depois e vira "atendida" ao abrir a comanda; escrita só por RPC). Praças cadastráveis (churrascaria, lanches, pizzaria…) além de cozinha e bar, escolhidas no item do cardápio e filtradas na `/cozinha`. Migration 20261209 e seção 20b do smoke, testes de status e rótulo. Telas não exercitadas no navegador com sessão real. Pendente: impressão por praça (R4), confirmação de reserva por WhatsApp.
- [x] Foto do item e cardápio online: foto do prato no cadastro (envio reduzido no navegador, bucket público `cardapio-fotos` com pasta da empresa; só a gestão envia), miniatura no lançamento da comanda, ordem do item no cadastro e página pública só de leitura `/menu/<link da empresa>` (categorias, itens ativos, preço, foto, descrição e adicionais; desligada por padrão, liga em Cardápio e mesas > Cardápio online, com link e QR code). Migration 20261210 e seção 20c do smoke. Telas e envio real de foto não exercitados no navegador com sessão real. Pendente: foto no app de autoatendimento (não existe), vários cardápios por empresa.
- [x] Crédito na mesa/conta cliente e juntar contas: crédito recebido adiantado (entra no caixa na hora e abate a conta no fechamento, sem mudar o fechamento nem a baixa parcial; só caixa e gestão), devolução da sobra pela gestão (saída no caixa, com motivo; cancelar comanda só depois de devolver o crédito) e "Juntar contas" na comanda (itens, pagamentos e pessoas das contas escolhidas vão para a conta atual; origens ficam canceladas como "unidas"; serviço/couvert diferentes só com autorização da gestão). Migration 20261211 e seção 17b do smoke. Telas não exercitadas no navegador com sessão real. Pendente: importar parcialmente itens de outra conta, crédito vinculado ao cliente cadastrado.
- [x] Balança, tara e buffet livre: item "vendido por peso" (preço por KG, só entra na comanda pela pesagem; o banco recusa o lançamento comum), cadastro de taras (prato, vasilhame) com tara padrão por item, tela `/balanca` (bipa a comanda ou abre uma nova, peso digitado ou vindo de balança com saída de teclado, prévia do valor, ticket impresso com peso, tara, valor e código da comanda) e teto do buffet livre (o prato pesado custa no máximo o preço do buffet livre, por prato). Cálculo no banco, prévia igual na tela, pesagem gravada no item. Migration 20261212 e seção 17c do smoke, testes do cálculo e do ticket. Telas e impressão não exercitadas no navegador com sessão real. Pendente: leitura direta da balança por porta serial/USB (hoje só teclado ou digitação), baixa de estoque dos itens por peso (ficha técnica por KG), teto do buffet livre por pessoa (hoje por prato), autoatendimento do cliente sem operador logado.
- [x] Senha do pedido de balcão e painel de senhas (lojas de shopping): na comanda avulsa, "Emitir senha e enviar à produção" numera a senha do dia (recomeça em 1 a cada dia, por loja), envia os itens pendentes à produção e imprime o ticket (senha grande, itens, código da comanda para o caixa); a cozinha e as comandas avulsas mostram "Senha N"; tela `/painel-senhas` para TV com "Em preparo" e "Pronto — retire no balcão" (usa o andamento dos itens que já existe e some quando tudo é entregue). Migration 20261214 e seção 17e do smoke, testes do ticket e da etapa. Telas e impressão não exercitadas no navegador com sessão real. Pendente: chamada por voz/som no painel, painel público sem login (hoje a TV usa um usuário logado), senha também para pedido do iFood.
- [x] Vários cardápios: cada cardápio (almoço, jantar, delivery, iFood...) lista os itens que vendem nele, com preço e ordem próprios (o preço base vale onde o cardápio não define um); uso por canal (salão e balcão, delivery, cardápio online, iFood), horário que sugere o cardápio na comanda, cardápio padrão (itens novos entram nele). Na comanda há seletor de cardápio quando existe mais de um e o banco cobra o preço do cardápio escolhido (`restaurante_lancar_item_no_cardapio`); a página pública mostra um bloco por cardápio online. O que já existia vira "Cardápio principal" e os itens com preço do iFood viram o cardápio "iFood". Migration 20261215 e seção 17f do smoke, testes de horário, preço e ordem. Telas não exercitadas no navegador com sessão real. Pendente: lançamento sem internet cobra o preço base (a fila offline não leva o cardápio), conector do iFood publicar o cardápio "iFood" (o campo "Preço no iFood" do item fica só como legado).
- [x] Chamar garçom pelo QR da mesa: a gestão liga o recurso, cadastra os motivos ("Chamar garçom", "Pedir a conta", "Pedir água"...) e imprime o QR de cada mesa (Cardápio e mesas > Chamar garçom); o cliente lê o QR (`/chamar/<link>/<mesa>`, sem login, sem instalar nada), escolhe o motivo e o chamado aparece numa faixa no PDV do restaurante, em tempo real, até alguém marcar "Atendi". O QR leva o id da mesa (não adivinhável), há um chamado aberto por mesa e motivo (toque repetido ou outro chamado da mesa em 20 s volta o mesmo) e um limite de 200 chamados abertos por empresa. Migration 20261216 e seção 17g do smoke, teste do endereço do QR. Telas, QR impresso e leitura no celular não exercitados no navegador. Pendente: aviso sonoro, aviso no celular do garçom, estatística de tempo de atendimento.
- [x] Revisão do PR: a pesagem passa a baixar os insumos do estoque pela ficha técnica (migration 20261217, seção 17h do smoke) e o crédito acima da conta pode ser devolvido também quando o cliente dispensa o serviço (botão "Devolver" no fechamento da conta, com a mesma escolha de serviço no banco).
- [ ] R3b — Integração iFood. **Feito (base interna, sem falar com o iFood):** caixa de entrada de pedidos externos na tela Delivery (aceitar abre o delivery do canal com itens, adicionais e taxa do pedido, sem duplicar pelo código; recusar com motivo), ligação dos itens do iFood ao cardápio (guardada no item), código e preço do iFood no cadastro do item. Pedido entra pelo formato interno descrito na migration 20261213 (função `restaurante_externo_receber`, só com a chave de serviço). Migration 20261213 e seção 17d do smoke. **Falta (precisa da credencial de parceiro e da documentação oficial):** conector (login, polling e confirmação de eventos, converter o pedido do iFood para o formato interno, avisar o iFood da aceitação/recusa/despacho), envio do cardápio e dos preços, atualização de preços, vários cardápios por empresa e conciliação do desconto do canal.

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
- [ ] Botão de emitir NFC-e no PDV (pedido) e nas vendas do restaurante
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
- [x] Ficha rápida do pet: microchip e foto do animal (miniatura JPEG, `pets.microchip`/`pets.foto`), histórico de pesagens com variação (`pet_pesagens`, `pet_pesagem_registrar`/`pet_pesagem_excluir`; o peso do cadastro acompanha a mais recente), farmacêutico com CRF no cadastro de profissionais (responsável pelo SNGPC; o envio em si ainda não existe), atestados de vacinação e de trânsito (modelos revisáveis) e ficha clínica imprimível (`/clinica-ficha`). Typecheck, lint, 631 testes e o smoke do banco (seção 89, Postgres 16) passaram; as telas não foram exercitadas no navegador
- [x] Campos personalizados do animal e do tutor (`/pet-campos`, administrador e gestor): texto, número, data, sim/não e lista de opções, obrigatório, ordem e desativar sem perder os valores; aparecem no cadastro de `/pets` e na ficha clínica impressa (`pet_campos`, `pet_campos_valores`, `pet_campo_salvar`, `pet_campos_valores_salvar`). Typecheck, lint, 637 testes e smoke do banco (seção 90) passaram; telas não exercitadas no navegador
- [x] Ordem de serviço do pet (`/pet-os`, impressão em `/pet-os-documento`): usa as tabelas da assistência (`os_ordens`, `os_itens`) com `pet_id` e um retrato do animal e do tutor guardado na ordem (refeito até a aprovação, congelado depois); itens de produto (peça: baixa o estoque na aprovação, devolve ao cancelar ou remover) e de serviço (produto sem estoque ou item livre); andamento aberta → orçamento → aprovada → em atendimento → pronta → entregue, cancelável até a entrega; a assistência técnica comum não lista estas ordens (`pet_os_salvar`, `pet_os_item_adicionar`, `pet_os_item_remover`, `pet_os_situacao`). Typecheck, lint, 641 testes e smoke do banco (seção 91) passaram; telas não exercitadas no navegador. Pendente: cobrança da OS pela frente de caixa
- [x] Internação, fase 1 (`/clinica-internacao`, boxes em `/clinica-boxes`): admissão com box (um animal por box, um box por animal), mapa dos internados com dia da internação, último peso, alergia e ocorrências, pesagem (entra no histórico de pesagens do pet), relato médico e ocorrências (não se alteram nem se apagam), troca de box registrada como ocorrência, alta e óbito (óbito inativa o cadastro do animal e guarda a data); internação encerrada é imutável. Mesmo modelo do prontuário: tabelas sem acesso direto, só funções; texto clínico (motivo, relatos, resumo de alta/óbito) só do veterinário; o auxiliar (perfil Profissional ligado a um cadastro de função auxiliar) vê o mapa, as ocorrências e as pesagens e registra ocorrência e pesagem; cada abertura de ficha fica na auditoria de acessos (`clinica_internacao_admitir`, `clinica_internacoes`, `clinica_internacao_obter`, `clinica_internacao_pesagem`, `clinica_internacao_relato`, `clinica_internacao_ocorrencia`, `clinica_internacao_box_trocar`, `clinica_internacao_encerrar`, `pet_box_salvar`, `clinica_boxes`). Typecheck, lint, 644 testes e smoke do banco (seção 92) passaram; telas não exercitadas no navegador. Pendente (fase 2): prescrição médica, mapa de execuções com cores, itens cobráveis da internação e impressão do histórico
- [x] Internação, fase 2: prescrição médica (medicamento, dose, via, a cada N horas por N dias ou dose única; só o veterinário prescreve e suspende, com o CRMV da hora), mapa de execuções (`/clinica-execucoes`) com as doses programadas e aviso de cor (azul programada, amarelo na hora, vermelho atrasada há mais de 15 min, verde feita, laranja não feita com motivo, cinza cancelada; atualiza a cada minuto; não adianta dose em mais de 2 horas), produtos e serviços da internação (produto com estoque sai do depósito ao lançar e volta ao cancelar com motivo; serviço e item avulso não mexem no estoque; o auxiliar lança, só o veterinário cancela), histórico completo e impresso (`/clinica-internacao-historico`); a alta e o óbito cancelam as doses que faltam (`clinica_internacao_prescrever`, `clinica_prescricao_suspender`, `clinica_execucao_registrar`, `clinica_execucoes_mapa`, `clinica_internacao_catalogo`, `clinica_internacao_item_lancar`, `clinica_internacao_item_cancelar`). Typecheck, lint, 647 testes e smoke do banco (seção 93) passaram; telas não exercitadas no navegador. Pendente: cobrança dos itens da internação pelo caixa e receita de controle especial (SNGPC)
- [x] SNGPC para medicamentos controlados de uso veterinário (`/sngpc`, escopo e pontos em aberto em `docs/sngpc.md`): cadastro do medicamento controlado (produto + registro na Anvisa de 13 números + lista da Portaria 344 + caixa/frasco), livro próprio com saldo por medicamento e lote (saldo inicial, entrada com nota fiscal, dispensação por receita/notificação com prescritor CRMV, tutor e animal, e perda com motivo; nenhum lote fica negativo em nenhuma data; lançamento só se cancela, com motivo), geração dos XMLs de movimentação e de inventário no layout do Guia Anvisa v2.3 (`usoMedicamento` 2, só CRMV, CPF do farmacêutico no cabeçalho) compactados em .zip e guardados com hash, e o ciclo do arquivo (gerado, transmitido com protocolo, cancelado) — transmitido fecha o período. O farmacêutico passa a exigir CPF (`sngpc_*`, `pet_profissional_salvar`). Typecheck, lint, 657 testes e smoke do banco (seção 94) passaram; XML e ZIP conferidos com parser de XML, `zipfile` e `unzip`. Pendente: validar um arquivo no validador oficial da Anvisa (o XSD não estava disponível), confirmar com o responsável técnico se a clínica deve enviar ao SNGPC, e os códigos de tipo de documento do comprador além do 1
- [x] Cobrança no caixa da ordem de serviço do pet e da internação (`/frente-caixa?os=` e `?internacao=`, lista da recepção em `/clinica-cobrancas`), no molde do banho e tosa e do lava rápido: a venda é feita na frente de caixa de sempre, com as linhas da ordem ou da internação já preenchidas (serviço avulso vai num produto de apoio `PET-AVULSO`; o desconto combinado na ordem entra na venda), e depois o vínculo (`pet_os_cobrar`, `clinica_internacao_cobrar`) confere que a venda traz cada item na quantidade e pelo valor combinados, liga as duas pontas e entrega a ordem. Como a ordem e a internação já baixaram o estoque, o vínculo devolve a baixa delas (fica só a da venda) e a venda cancelada refaz a baixa e devolve a cobrança a aberta. Ordem com valor só sai pela cobrança (a tabela não deixa marcar como entregue), e os itens da ordem do pet só mudam pelas funções. Internação só se cobra depois da alta, por recepção/gestão, e a tela dela mostra só itens e total, nunca texto clínico. Typecheck, lint, 661 testes e smoke do banco (seção 95) passaram; telas não exercitadas no navegador. Pendente: NFS-e em rascunho e comissão do profissional/veterinário nessas cobranças (esperam o contador, PR 5), e cobrança parcial da internação ainda internada

## Rodada 11 — Pet shop, Fase 4: exames, lembretes e trabalho sem internet (`docs/pet-shop-fase-4.md`)

- [x] Escopo desenhado; decisões respondidas: só cães e gatos, offline cobre cadastro, atendimento, vacina e exame. Em aberto: outras fichas do sistema atual e 3 pontos do PR 5 (quem leva o notebook, validade da cópia, bloqueio e senha)
- [x] PR 1 — Atalhos da próxima dose (21 dias, 30 dias, 1 ano)
- [x] PR 2 — Exames: modelos de hemograma (com VCM, HCM, CHCM e RDW), bioquímica e urina, com unidade e faixa por espécie; faixa guardada no resultado
- [x] PR 3 — Exames: resultados só com número, cálculo do hemograma, valor fora da faixa, evolução e laudo
- [x] PR 4 — Exames: anexos (ultrassom, raio-x, laudos) em armazenamento privado
- [ ] PR 5 — Trabalho sem internet (cães e gatos; cadastro, atendimento, vacina e exame): 5a base segura (cofre criptografado, fila, pendências, preparar visita) ✔ · 5b cadastros ✔ · 5c atendimento ✔ · 5d vacina e exame ✔ · 5e anexos ✔
