import { capa, gerar, h1, h2, nota, ol, p, requisitos, sit, tabela, ul } from "./base.mjs";

const VERSAO = "2.0";
const DATA = "21/10/2026";

const sumario = [
  "Visão geral",
  "Objetivos e indicadores de sucesso",
  "Público e perfis de usuário",
  "Escopo do produto por módulo (requisitos funcionais)",
  "Fluxos principais",
  "Requisitos não funcionais",
  "Premissas, restrições e fora de escopo",
  "Roadmap por fases",
  "Riscos, dependências e decisões em aberto",
  "Glossário",
];

const partes = [];

partes.push(
  capa({
    titulo: "Documento de Requisitos de Produto (PRD)",
    subtitulo: "ERP Ze Tech",
    linhas: [
      ["Versão", `${VERSAO} (substitui a 1.0 de 16/10/2026)`],
      ["Data", DATA],
      [
        "Situação",
        "Baseline do produto na `main` em 21/10/2026, com as entregas em revisão (PRs 91 a 94) marcadas à parte",
      ],
      ["Repositório", "felipeaugusantos/erpzetech"],
      ["Documento par", "TRD — Requisitos Técnicos (versão 2.0)"],
    ],
  }),
);

partes.push(
  h1("Sumário") +
    `<ol class="sumario">${sumario.map((s) => `<li>${s}</li>`).join("")}</ol>` +
    nota(
      `**Como ler este documento.** Cada requisito tem um identificador (RF-…), uma prioridade (P0 a P3) e a situação real no código em ${DATA}: ${sit("Implementado")} funciona e está testado; ${sit("Parcial")} existe com limitações descritas; ${sit("Em revisão")} está pronto em pull request aberto, ainda não na \`main\` nem aplicado no banco; ${sit("Planejado")} ainda não existe; ${sit("Bloqueado")} depende de algo externo. A situação vem do \`roadmap.md\`, dos documentos de escopo em \`docs/\` e do código. Metas numéricas de sucesso são propostas para validação do dono do produto, não medições.`,
    ) +
    nota(
      "**O que mudou desde a versão 1.0 (16/10/2026).** Entraram na `main`: importação por planilha (Fase 1), importação de extrato OFX, o módulo **Pet shop e clínica veterinária** (Fases 1 a 4, incluindo trabalho sem internet), login por usuário, módulos sem CNPJ e liberações pela equipe Ze Tech, link de acesso do assinante, menus e dashboards por ramo, máscaras de campos, busca de endereço pelo telefone no delivery, CNPJ alfanumérico na empresa e no cadastro, e as melhorias da locação (vistoria, manutenção, cobrança na devolução). Em revisão: CNPJ alfanumérico nas notas fiscais (#91), Reforma Tributária IBS/CBS fase 1 (#92), mensagens ao tutor (#93) e receituário e documentos da clínica (#94).",
    ),
);

// 1
partes.push(
  h1("1. Visão geral") +
    h2("1.1 O que é") +
    p(
      "O ERP Ze Tech é um sistema de gestão (ERP) em nuvem, no modelo SaaS multiempresa, criado para a operação de lojas de materiais de construção — do balcão pequeno às redes com várias filiais e depósitos. A mesma plataforma atende também **restaurantes e lanchonetes**, **assistência técnica**, **locação de equipamentos** e **pet shops e clínicas veterinárias**, liberados pelo ramo ou pelo CNAE da empresa (ou escolhidos à mão por quem ainda não tem CNPJ). A equipe da Ze Tech opera um painel próprio de gestão dos clientes (planos, cobrança, notas emitidas e uso).",
    ) +
    p(
      "O fluxo central do produto é: **Cliente → Orçamento → Aprovação → Pedido → Reserva de estoque → Separação → Conferência → Entrega (inclusive parcial) → Financeiro**, com nota fiscal em cada ponto em que a lei exige. No pet shop e na clínica, o fluxo é **Tutor e pet → Agenda → Atendimento (banho, tosa, consulta, vacina, exame) → Cobrança no caixa**, com prontuário, vacinas, exames e documentos da clínica.",
    ) +
    h2("1.2 Problema") +
    ul([
      "Lojas de material de construção vendem em unidades diferentes das compradas (rolo/metro, caixa/m², palete/saco), em obras, com entrega parcial ao longo de semanas. Sistemas genéricos tratam isso mal.",
      "O balcão não pode parar: a internet cai e a venda continua. O dinheiro já foi recebido no caixa quando a conexão volta. O mesmo vale para o veterinário que atende numa propriedade rural sem sinal.",
      "A operação fiscal (NF-e, NFS-e, NFC-e) é obrigatória, varia por estado e tem rejeições que precisam ser acompanhadas. Em 2026 ela ganhou o CNPJ alfanumérico e os tributos da Reforma Tributária (IBS, CBS e Imposto Seletivo).",
      "Redes precisam separar o que cada filial e cada perfil de usuário pode ver e fazer, com rastro de quem alterou o quê. Na clínica, o prontuário só pode ser lido e escrito pelo veterinário, e cada leitura fica registrada.",
      "Pet shops e clínicas pequenas vivem de agenda, de lembrar o tutor (vacina, retorno, aniversário) e de cobrar serviço e produto juntos.",
    ]) +
    h2("1.3 Proposta de valor") +
    tabela(
      ["Para", "Valor"],
      [
        [
          "O dono / gestor",
          "Visão única de vendas, margem, estoque, contas e entregas por filial; auditoria de alterações; permissões por perfil; dashboard próprio para cada ramo (loja, restaurante, clínica e pet shop).",
        ],
        [
          "O balcão",
          "Frente de caixa em tela cheia operada pelo teclado, que continua vendendo sem internet e não duplica venda ao reconectar.",
        ],
        [
          "O estoque e a logística",
          "Reserva, separação, conferência por leitura de código de barras, romaneio, entrega parcial com saldo por item e app do motorista.",
        ],
        [
          "O financeiro e o contador",
          "Contas a receber e a pagar, caixa por operador, notas fiscais com acompanhamento de rejeições, painel fiscal por loja e preparo para a Reforma Tributária.",
        ],
        [
          "A recepção do pet shop e da clínica",
          "Agenda de banho, tosa e consulta sem sobreposição; cobrança de serviço e produto no mesmo caixa; lista de quem chamar hoje, com a mensagem de WhatsApp pronta.",
        ],
        [
          "O veterinário",
          "Prontuário imutável com adendos, vacinas com lote e reforço, exames preenchidos só com número, anexos de imagem e laudo, documentos (receita, atestado, termo) e trabalho sem internet com dados criptografados no notebook.",
        ],
        [
          "A Ze Tech",
          "Cobrança por plano, filiais extras, implantação, liberação de módulos e visão de uso de cada cliente.",
        ],
      ],
      ["26%", "74%"],
    ),
);

// 2
partes.push(
  h1("2. Objetivos e indicadores de sucesso") +
    h2("2.1 Objetivos do produto") +
    ol([
      "Cobrir toda a operação comercial e logística de uma loja de materiais de construção em um só sistema.",
      "Não perder venda nem atendimento: balcão, salão, delivery e consultório resistem à falta de internet e a reenvios.",
      "Isolar dados entre empresas, filiais e perfis, com rastro de auditoria — e proteger o dado clínico com acesso só do veterinário.",
      "Fechar o ciclo fiscal e de recebimento no balcão (NFC-e, Pix, boleto, TEF e conciliação) e acompanhar as mudanças da legislação (CNPJ alfanumérico, IBS/CBS).",
      "Reduzir o custo de implantar um cliente novo (importação por planilha, módulos liberados sem CNPJ, link próprio de acesso).",
      "Atender pet shops e clínicas veterinárias de ponta a ponta, da agenda ao prontuário e ao contato com o tutor.",
    ]) +
    h2("2.2 Indicadores propostos (a validar)") +
    tabela(
      ["Indicador", "Como medir", "Meta proposta"],
      [
        [
          "Vendas de balcão sem duplicidade",
          "Vendas com a mesma chave de operação gravadas mais de uma vez",
          "0",
        ],
        [
          "Operações offline recusadas e esquecidas",
          "Itens da fila (caixa, salão, delivery, clínica) com erro há mais de 24 h sem decisão do operador",
          "0",
        ],
        [
          "Notas fiscais com pendência aberta",
          "Notas rejeitadas, em contingência ou sem retorno há mais de 15 min na tela de pendências",
          "Tratadas no mesmo dia",
        ],
        [
          "Tempo de implantação de um cliente",
          "Do cadastro da empresa à primeira venda registrada",
          "Reduzir com importação por planilha e módulos liberados",
        ],
        [
          "Vazamento entre empresas",
          "Testes de isolamento no CI e verificação periódica de papéis",
          "0 achados",
        ],
        [
          "Cobertura de auditoria",
          "Alterações de preço, desconto, estoque, financeiro e fiscal com autor registrado",
          "100% das tabelas sensíveis",
        ],
        [
          "Leituras do prontuário sem registro",
          "Acessos ao prontuário, exames, anexos e documentos sem linha na auditoria de acessos",
          "0",
        ],
        [
          "Faltas na agenda do pet shop",
          'Agendamentos marcados como "faltou" sobre o total, antes e depois da confirmação por mensagem',
          "Reduzir (a medir após o piloto)",
        ],
        [
          "Tutores chamados no prazo",
          "Itens das listas de contato (retorno, reforço de vacina, aniversário) tratados em até 7 dias",
          "A definir com o piloto",
        ],
      ],
      ["30%", "46%", "24%"],
    ),
);

// 3
partes.push(
  h1("3. Público e perfis de usuário") +
    p(
      "O acesso é por perfil (papel). Um usuário pode ter mais de um. O banco aplica a tabela de papéis; a interface apenas reflete. Desde a versão 1.0, o **login é pelo usuário** dentro da empresa (e não mais pelo e-mail) e a empresa tem um **link próprio** que abre a tela de entrada com a sua marca.",
    ) +
    tabela(
      ["Perfil", "Quem é", "O que faz no sistema"],
      [
        [
          "Administrador",
          "Dono ou responsável pela conta",
          "Tudo da empresa, incluindo dados fiscais da empresa e filiais, usuários, perfis e redefinição de senha da equipe.",
        ],
        [
          "Gestor",
          "Gerente da loja ou rede",
          "Aprova e cancela pedidos, autoriza descontos, vê auditoria, configura impostos e NFC-e; vê todas as filiais.",
        ],
        [
          "Vendedor",
          "Atendente de balcão e de obra; recepção do pet shop",
          "Cria orçamentos e pedidos, emite nota do balcão, acompanha comissão; agenda banho, tosa e consulta.",
        ],
        [
          "Caixa",
          "Operador da frente de caixa",
          "Vende no balcão, abre e fecha o caixa, recebe, emite NFC-e/NF-e do balcão; cobra atendimentos do pet shop.",
        ],
        [
          "Estoquista",
          "Separação e conferência",
          "Separa e confere pedidos, ajusta estoque e inventário, lança lotes.",
        ],
        [
          "Comprador",
          "Compras",
          "Cotações, pedidos de compra, sugestão de reposição, entrada por XML.",
        ],
        [
          "Financeiro",
          "Contas e conciliação",
          "Contas a receber e a pagar, baixas, notas fiscais, eventos de pagamento, comissões do pet shop.",
        ],
        ["Logística", "Planeja entregas", "Planeja entregas e rotas, agenda e reagenda."],
        [
          "Motorista",
          "Entrega em campo",
          "Só inicia a rota e registra sucesso ou insucesso da própria entrega, pelo celular.",
        ],
        [
          "Garçom",
          "Salão do restaurante",
          "Mesas, comandas, lançamento de itens; sem acesso às demais telas.",
        ],
        ["Cozinha", "Preparo", "Fila de preparo em tempo real; sem acesso às demais telas."],
        [
          "Profissional",
          "Banhista, tosador, groomer",
          "Só a própria agenda e o andamento dos próprios atendimentos; sem acesso à loja.",
        ],
        [
          "Veterinário",
          "Médico(a) veterinário(a) com CRMV cadastrado",
          "Atende, escreve e lê o prontuário, aplica vacina, abre exames, anexa arquivos, emite documentos; trabalha sem internet. Perfil restrito: não vê a loja.",
        ],
        [
          "Operador Ze Tech",
          "Equipe da Ze Tech",
          "Painel de clientes, planos, cobrança, notas emitidas, liberação de módulos e tempo real das lojas.",
        ],
      ],
      ["16%", "26%", "58%"],
    ) +
    nota(
      "**Regras de filial.** Administrador, gestor e usuário sem filial vinculada veem todas as filiais; os demais veem só a própria. Decisão do dono, aplicada no banco. **Regra do prontuário:** nem o administrador nem o gestor leem o texto clínico; só o veterinário, pelas funções da clínica. A gestão vê apenas a auditoria de acessos (quem abriu o quê), sem o conteúdo.",
    ),
);

// 4
const rf = [];
rf.push(
  h1("4. Escopo por módulo (requisitos funcionais)") +
    p(
      'Prioridade: P0 imprescindível, P1 alta, P2 média, P3 baixa. A situação segue a legenda da página anterior; "Em revisão" traz o número do pull request.',
    ),
);

rf.push(
  h2("4.1 Plataforma, acesso e empresa") +
    requisitos([
      [
        "RF-001",
        "Multiempresa: cada empresa vê só os seus dados; toda entidade operacional carrega empresa (e filial, quando aplicável).",
        "P0",
        "Implementado",
      ],
      [
        "RF-002",
        "Cadastro e entrada de usuários; quem se cadastra sozinho passa pelo onboarding e cria o próprio espaço (sem herdar acesso a outra empresa).",
        "P0",
        "Implementado",
      ],
      [
        "RF-003",
        "Perfis e permissões aplicados no banco, por operação (tabela de papéis aprovada na Fase 0).",
        "P0",
        "Implementado",
      ],
      [
        "RF-004",
        "Permissões configuráveis por módulo (ver, criar, editar, excluir) por perfil.",
        "P2",
        "Parcial",
      ],
      [
        "RF-005",
        "Cadastro da empresa e das filiais, salvo de uma vez (empresa, vínculo do administrador e regime tributário).",
        "P0",
        "Implementado",
      ],
      [
        "RF-006",
        "Acesso por filial: cada usuário vê e opera só a filial a que pertence (exceto administrador, gestor e usuário sem filial).",
        "P1",
        "Implementado",
      ],
      [
        "RF-007",
        "Filial extra com depósito e configuração fiscal própria criados juntos.",
        "P1",
        "Implementado",
      ],
      [
        "RF-008",
        "Módulos opcionais (restaurante, assistência, locação, pet shop, clínica) liberados pelo ramo e pelo CNAE da empresa.",
        "P1",
        "Implementado",
      ],
      [
        "RF-009",
        "Formulário público de contato com limite de envios e verificação anti-robô (CAPTCHA Cloudflare Turnstile).",
        "P2",
        "Implementado",
      ],
      [
        "RF-010",
        "Tela de auditoria (administrador e gestor): quem alterou o quê, valor antes e depois, com filtros por tipo, usuário e período.",
        "P1",
        "Implementado",
      ],
      [
        "RF-011",
        "Login por usuário dentro da empresa (3 a 30 caracteres, único por empresa), e-mail só como contato; só o administrador troca o usuário e redefine senha; o login do motorista e a troca de operador no caixa seguem a mesma regra.",
        "P0",
        "Implementado",
      ],
      [
        "RF-012",
        "Negócio sem CNPJ escolhe os módulos que usa (tela própria e formulário da empresa); com CNPJ de 14 caracteres vale o CNAE. A equipe Ze Tech pode liberar módulos de forma explícita, sem alterar atividades fiscais, ramo ou permissões.",
        "P1",
        "Implementado",
      ],
      [
        "RF-013",
        "Link próprio da empresa (e do assinante): abre o login com a marca da empresa, também antes de a empresa ser cadastrada; nomes reservados e formato validados; empresa e assinante não disputam o mesmo link.",
        "P1",
        "Implementado",
      ],
      [
        "RF-014",
        "Menu e dashboard enxutos por ramo: restaurante e alimentação, empresa só de clínica e pet shop veem apenas o que usam; liberações explícitas prevalecem.",
        "P1",
        "Implementado",
      ],
      [
        "RF-015",
        "Máscaras de telefone, WhatsApp, CPF, CNPJ e CEP nos campos de todo o sistema; o CNPJ aceita letras (alfanumérico).",
        "P2",
        "Implementado",
      ],
      [
        "RF-016",
        "Redefinição da senha do administrador do assinante pela equipe Ze Tech, por função autenticada que confere o vínculo do assinante.",
        "P1",
        "Implementado",
      ],
    ]),
);

rf.push(
  h2("4.2 Cadastros") +
    requisitos([
      [
        "RF-020",
        "Clientes pessoa física e jurídica, com dados fiscais, endereço, limite de crédito, saldo disponível, situação financeira, prazo e desconto máximo; opção de não receber mensagens.",
        "P0",
        "Implementado",
      ],
      [
        "RF-021",
        "Histórico do cliente: orçamentos, pedidos, entregas, pagamentos e obras.",
        "P1",
        "Implementado",
      ],
      [
        "RF-022",
        "Obras do cliente (situação, responsável, datas) vinculáveis a orçamentos, pedidos e entregas; histórico unificado da obra.",
        "P0",
        "Implementado",
      ],
      [
        "RF-023",
        "Produtos: códigos, categorias e subcategorias configuráveis, marca, fornecedor, NCM, CFOP, CST/CSOSN, custo, preço, margem, mínimo e máximo, localização, medidas, fotos; produto pode ser marcado como serviço (sem estoque).",
        "P0",
        "Implementado",
      ],
      [
        "RF-024",
        "Conversão de unidades de compra e venda (rolo/metro, caixa/m², palete/saco) e estoque representado corretamente.",
        "P0",
        "Implementado",
      ],
      [
        "RF-025",
        "Consulta de dados do produto por código de barras (GTIN) e do cliente/empresa por CNPJ (numérico ou alfanumérico).",
        "P2",
        "Implementado",
      ],
      [
        "RF-026",
        "Fornecedores, vendedores, profissionais indicadores, técnicos, motoristas e veículos.",
        "P1",
        "Implementado",
      ],
      [
        "RF-027",
        "Importação em massa por planilha (CSV) de produtos, clientes e saldos de estoque, com pré-visualização, validação por linha, entra tudo ou nada, relatório de erros e histórico.",
        "P1",
        "Implementado",
      ],
      [
        "RF-028",
        "Importação direta de arquivo .xlsx, de fornecedores, obras e preços, e checklist guiado de implantação.",
        "P2",
        "Planejado",
      ],
      [
        "RF-029",
        "CNPJ alfanumérico (Receita Federal, 2026): máscara, validação do dígito verificador, empresa com CNPJ, importação de clientes (inclusive no banco), consulta pública e busca; cadastro rápido de cliente na frente de caixa.",
        "P0",
        "Implementado",
      ],
    ]),
);

rf.push(
  h2("4.3 Estoque e depósitos") +
    requisitos([
      [
        "RF-030",
        "Entrada, saída, ajuste, inventário e transferência entre depósitos e filiais, com histórico (produto, quantidade, usuário, data, documento, motivo).",
        "P0",
        "Implementado",
      ],
      ["RF-031", "Estoque físico, reservado e disponível, por depósito.", "P0", "Implementado"],
      ["RF-032", "Reserva e liberação de reserva ligadas ao pedido.", "P0", "Implementado"],
      [
        "RF-033",
        "Lotes, tonalidade e calibre por depósito, com histórico permanente e **validade do lote** (também para vacinas e medicamentos); lote escolhido no item do pedido e visível na separação.",
        "P1",
        "Implementado",
      ],
      [
        "RF-034",
        "Baixa automática do saldo do lote na saída do pedido e preenchimento do lote na importação do XML.",
        "P2",
        "Planejado",
      ],
      ["RF-035", "Motivo obrigatório em ajustes de inventário e transferência.", "P2", "Planejado"],
      [
        "RF-036",
        "Sugestão de reposição revisável por fornecedor (vendas, reservado, já pedido, mínimo/máximo, prazo e embalagem).",
        "P1",
        "Implementado",
      ],
      [
        "RF-037",
        "Cálculo de quantidade (m² de piso, sacos de cimento) e lista de materiais por obra.",
        "P3",
        "Planejado",
      ],
      [
        "RF-038",
        "Venda a granel: abrir saco (baixa o saco e dá entrada dos kg no granel pelo custo proporcional) e vender por kg com casas decimais.",
        "P1",
        "Implementado",
      ],
    ]),
);

rf.push(
  h2("4.4 Comercial: orçamento, pedido e entrega") +
    requisitos([
      [
        "RF-040",
        "Orçamento rápido no balcão (busca de cliente e produto, desconto, frete, validade) com impressão e PDF pelo navegador; status de rascunho a expirado.",
        "P0",
        "Implementado",
      ],
      [
        "RF-041",
        "Conversão de orçamento aprovado em pedido sem redigitar, com reserva automática quando configurado.",
        "P0",
        "Implementado",
      ],
      [
        "RF-042",
        "Pedido com situações de aguardando pagamento a concluído e linha do tempo completa.",
        "P0",
        "Implementado",
      ],
      [
        "RF-043",
        "Separação e conferência (com leitura de código de barras), pronto para entrega.",
        "P0",
        "Implementado",
      ],
      [
        "RF-044",
        "Retirada e entrega parcial: comprado, entregue, reservado e pendente por item; trava de saldo e chave contra reenvio.",
        "P0",
        "Implementado",
      ],
      [
        "RF-045",
        "Ocorrências (falta, sobra, avaria, substituição), agendamento e reagendamento com motivo.",
        "P1",
        "Implementado",
      ],
      ["RF-046", "Romaneio impresso por entrega, com assinaturas.", "P1", "Implementado"],
      ["RF-047", "Planejamento de entrega e rota; mapa da frota.", "P1", "Implementado"],
      [
        "RF-048",
        "App do motorista no celular (inicia a rota; sucesso ou insucesso da própria entrega).",
        "P1",
        "Parcial",
      ],
      ["RF-049", "Fila offline da logística no celular.", "P2", "Planejado"],
      [
        "RF-050",
        "Comissão de vendedores gerada pelo fluxo do pedido entregue, com regras por vendedor.",
        "P1",
        "Implementado",
      ],
      ["RF-051", "Devoluções com retorno de estoque e financeiro.", "P1", "Implementado"],
      ["RF-052", "Compartilhar orçamento pelo WhatsApp.", "P3", "Planejado"],
    ]),
);

rf.push(
  h2("4.5 Balcão: PDV, frente de caixa e caixa") +
    requisitos([
      [
        "RF-060",
        "Frente de caixa em tela cheia, operada pelo teclado, com sugestão de produtos por IA a partir de texto livre.",
        "P0",
        "Implementado",
      ],
      [
        "RF-061",
        "Caixa por operador: abertura, sangria, suprimento, fechamento com contagem, troca de operador e senha do gestor para cancelar, descontar acima do limite e sangrar.",
        "P0",
        "Implementado",
      ],
      [
        "RF-062",
        "Venda de balcão que continua sem internet, guardada no aparelho e enviada ao reconectar de forma idempotente (não duplica a venda, a saída de estoque nem a entrada no caixa).",
        "P0",
        "Implementado",
      ],
      [
        "RF-063",
        "Aviso ao operador quando uma venda guardada já estava registrada (resposta perdida).",
        "P1",
        "Implementado",
      ],
      [
        "RF-064",
        "Operação recusada pelo banco fica guardada com o erro e nunca é descartada sozinha.",
        "P0",
        "Implementado",
      ],
      [
        "RF-065",
        "Maquininha em modo simulado para teste (aprovação e recusa) com a mesma trilha da maquininha real.",
        "P2",
        "Implementado",
      ],
      ["RF-066", "Integração real com a maquininha (TEF) de uma credenciadora.", "P1", "Planejado"],
      ["RF-067", "Relatório de fechamento por operador.", "P1", "Implementado"],
      [
        "RF-068",
        "Conferência sem internet (retrato de estoque e caixa) e lotes sem internet.",
        "P2",
        "Implementado",
      ],
    ]),
);

rf.push(
  h2("4.6 Compras") +
    requisitos([
      [
        "RF-070",
        "Compras com situações, recebimento parcial e total da compra por gatilho.",
        "P0",
        "Implementado",
      ],
      ["RF-071", "Cotações com fornecedores e escolha da cotação vencedora.", "P1", "Implementado"],
      [
        "RF-072",
        "Entrada por XML da NF-e e por PDF digital (DANFE e DACTE com vários documentos): lotes na mesma transação da compra; importação que não trava (limite de 45 s com cancelar); detalhes da nota já importada em tela de leitura.",
        "P0",
        "Implementado",
      ],
      [
        "RF-073",
        'Nota duplicada recusada pela chave, ou por número + série + fornecedor, com aviso de "já importada" ou "em processo de importação" e atalho para a compra existente.',
        "P0",
        "Implementado",
      ],
      [
        "RF-074",
        "Teste real fim a fim: cotação com fornecedor → XML → entrada no estoque após venda.",
        "P2",
        "Planejado",
      ],
      [
        "RF-075",
        "Entrada de notas com CNPJ e chave de acesso alfanuméricos (XML, PDF, CT-e) e conferência de fornecedor e transportadora por letras e números.",
        "P0",
        "Em revisão · #91",
      ],
    ]),
);

rf.push(
  h2("4.7 Financeiro") +
    requisitos([
      [
        "RF-080",
        "Contas a receber (receber pagamento e baixar) e a pagar, com vencidos e extrato a receber.",
        "P0",
        "Implementado",
      ],
      [
        "RF-081",
        "Crédito de clientes, fluxo de caixa, contas bancárias e movimentação bancária.",
        "P1",
        "Implementado",
      ],
      [
        "RF-082",
        "Dashboard: faturamento do dia e do mês, ticket médio, margem estimada, contas, estoque baixo, entregas e separações pendentes, com filtros; versões próprias para restaurante, clínica e pet shop (atendimentos, agenda, receita por serviço).",
        "P1",
        "Implementado",
      ],
      [
        "RF-083",
        "Importação de extrato bancário OFX ligada à conciliação (concilia o que bate e deixa o resto em pendências); API bancária (Open Finance) e vínculo manual com lançamento existente.",
        "P1",
        "Parcial",
      ],
      [
        "RF-084",
        "Pix com cobrança automática (QR dinâmico) e baixa automática por webhook.",
        "P0",
        "Bloqueado",
      ],
      ["RF-085", "Boleto registrado com baixa automática.", "P1", "Bloqueado"],
      [
        "RF-086",
        "Tela de pendências de pagamento: eventos de provedores que falharam, foram ignorados ou ficaram sem resposta.",
        "P1",
        "Implementado",
      ],
    ]),
);

rf.push(
  h2("4.8 Fiscal") +
    requisitos([
      [
        "RF-090",
        "NF-e modelo 55 a partir do pedido, com cálculo de impostos pela filial emitente (interna ou interestadual) e transmissão pelo emissor ACBr; consulta, cancelamento, XML e PDF.",
        "P0",
        "Implementado",
      ],
      [
        "RF-091",
        "Nota do balcão emitida também por vendedor e caixa; cancelar nota só administrador e gestor.",
        "P1",
        "Implementado",
      ],
      [
        "RF-092",
        "NFS-e da locação e do serviço (configuração real de inscrição municipal, código de serviço e ISS pendente).",
        "P1",
        "Parcial",
      ],
      [
        "RF-093",
        "NFC-e (modelo 65): configuração de CSC, série e numeração próprias; criação da nota a partir da venda, com CPF opcional e lista do que falta; botão na frente de caixa.",
        "P0",
        "Parcial",
      ],
      [
        "RF-094",
        "Transmissão da NFC-e à Sefaz pela ACBr, com contingência e nova tentativa.",
        "P0",
        "Bloqueado",
      ],
      [
        "RF-095",
        "Tela de pendências fiscais: notas rejeitadas, em contingência, sem retorno e NFC-e em rascunho.",
        "P1",
        "Implementado",
      ],
      [
        "RF-096",
        "Painel fiscal por loja (entradas, saídas, saldo e impostos por período).",
        "P1",
        "Implementado",
      ],
      [
        "RF-097",
        "SPED Fiscal e Contribuições e exportação de arquivos para a contabilidade.",
        "P2",
        "Planejado",
      ],
      [
        "RF-098",
        "CT-e e MDF-e para clientes com frota ou transporte de terceiros.",
        "P3",
        "Planejado",
      ],
      [
        "RF-099",
        "Emissão de NF-e/NFC-e com CNPJ alfanumérico (NT 2026.004): emitente, destinatário, responsável técnico, conta do emissor e leitura de chaves de 44 posições com letras.",
        "P0",
        "Em revisão · #91",
      ],
      [
        "RF-0A0",
        "Reforma Tributária (NT 2025.002-RTC), fase 1: tabelas oficiais de CST e cClassTrib, classificação IBS/CBS no produto, cálculo do item e dos totais e grupos IBSCBS/IBSCBSTot na NF-e do regime normal (CST 000, 011, 200, 400 e 410).",
        "P0",
        "Em revisão · #92",
      ],
      [
        "RF-0A1",
        "Reforma Tributária: demais CSTs (diferimento, suspensão, alíquota fixa, monofasia, crédito presumido, ZFM/ALC), NFC-e, devolução com DFeReferenciado, notas de crédito e débito, eventos, DANFE e crédito na compra.",
        "P1",
        "Planejado",
      ],
      [
        "RF-0A2",
        "Reforma Tributária para Simples Nacional e MEI (a partir de 04/01/2027): depende de nota técnica futura.",
        "P1",
        "Bloqueado",
      ],
    ]),
);

rf.push(
  h2("4.9 Restaurante e lanchonete") +
    requisitos([
      [
        "RF-100",
        "Cardápio com categorias, itens, grupos de opções (obrigatório, máximo) e acréscimos; mesas e comandas.",
        "P0",
        "Implementado",
      ],
      [
        "RF-101",
        "Salão: abrir comanda, lançar item com opções, enviar à cozinha, trocar de mesa, cancelar item e comanda com regras por perfil.",
        "P0",
        "Implementado",
      ],
      [
        "RF-102",
        "Cozinha em tempo real, com filtro cozinha/bar e alerta de atraso.",
        "P0",
        "Implementado",
      ],
      [
        "RF-103",
        "Fechamento de conta: serviço opcional, couvert só para casa com show ao vivo, desconto da gestão, divisão, vários pagamentos, caixa; baixa parcial da mesa por itens ou por valor; conta impressa.",
        "P0",
        "Implementado",
      ],
      [
        "RF-104",
        "Ficha técnica: insumos por prato e opção, custo, lucro e CMV; baixa de estoque ao enviar à cozinha.",
        "P1",
        "Implementado",
      ],
      [
        "RF-105",
        "Delivery próprio com zonas e taxas, painel por etapa e impressão; endereço preenchido pelo telefone do cliente (pedidos anteriores e cadastro), zona e taxa escolhidas pelo bairro.",
        "P1",
        "Implementado",
      ],
      [
        "RF-106",
        "Salão e delivery funcionam sem internet e sincronizam ao voltar.",
        "P0",
        "Implementado",
      ],
      ["RF-107", "Integração iFood.", "P2", "Bloqueado"],
      [
        "RF-108",
        "Impressão térmica, balcão e garçom em tablet; estorno de baixa parcial; conversão g↔kg; relatório de perdas.",
        "P2",
        "Planejado",
      ],
      ["RF-109", "Busca de endereço por CEP no delivery.", "P3", "Planejado"],
    ]),
);

rf.push(
  h2("4.10 Assistência técnica e locação") +
    requisitos([
      [
        "RF-110",
        "Ordens de serviço com peças e mão de obra, técnicos, horas trabalhadas e relatório por loja em PDF; peças baixam o estoque ao aprovar e voltam ao cancelar.",
        "P1",
        "Implementado",
      ],
      [
        "RF-111",
        "Locação de equipamentos: cadastro, estoque próprio, contratos e balcão de locação (vários equipamentos, período, pagamento à vista ou parcelado); locação devolvida ou cancelada permanece na lista.",
        "P1",
        "Implementado",
      ],
      ["RF-112", "Nota de serviço da locação (NFS-e) com campos de ISS.", "P1", "Parcial"],
      [
        "RF-113",
        "Vistoria na devolução, com cobrança do dano pela caução e da diferença em contas a receber; equipamento com dano vai para manutenção.",
        "P1",
        "Implementado",
      ],
      [
        "RF-114",
        "Plano de manutenção por equipamento, pelos dias de locação, com aviso e bloqueio ao vencer; manutenção preventiva recomeça a contagem.",
        "P1",
        "Implementado",
      ],
      [
        "RF-115",
        "Cobrança da locação na devolução em contas a receber (pelo valor final, inclusive dias a mais).",
        "P1",
        "Implementado",
      ],
    ]),
);

rf.push(
  h2("4.11 Pet shop") +
    p(
      'Documentos de escopo: `docs/pet-shop-fase-1.md` a `docs/pet-shop-fase-4.md`. O módulo é liberado por CNAE (7500, 4789004, 9609208), pelo ramo "Pet shop e veterinária" ou pela escolha manual de quem não tem CNPJ. Só cães e gatos (decisão do dono).',
    ) +
    requisitos([
      [
        "RF-130",
        "Pets e tutores: cadastro do pet (espécie, raça, porte, pelagem, peso, nascimento, castração, alergias) ligado ao tutor; o tutor pode ser cadastrado no próprio cadastro do pet, sem passar pelo cadastro de cliente, com aviso de telefone parecido e proteção contra duplicidade.",
        "P0",
        "Implementado",
      ],
      [
        "RF-131",
        'Serviços do pet shop (banho, tosa, estética, consulta, vacina, exame) e preço por porte, raça e pelagem; o preço mais específico vence; simulação "quanto custa para este pet".',
        "P0",
        "Implementado",
      ],
      [
        "RF-132",
        "Profissionais (banhista, tosador, groomer, veterinário) com comissão; acesso próprio (usuário e senha) criado junto com o cadastro.",
        "P1",
        "Implementado",
      ],
      [
        "RF-133",
        "Agenda de banho e tosa só pela recepção, sem dois atendimentos ao mesmo tempo para o profissional, com preço e duração congelados; situações agendado, confirmado, em atendimento, pronto; cancelar, faltar e remarcar com motivo.",
        "P0",
        "Implementado",
      ],
      [
        "RF-134",
        'Cobrança pelo caixa ("Retirar e cobrar"), com NFS-e em rascunho, comissão do profissional aprovada e paga em tela própria e relatório "Serviços por profissional"; venda cancelada devolve o atendimento a "pronto".',
        "P0",
        "Implementado",
      ],
      [
        "RF-135",
        "Contatos com o tutor: aniversário do pet e retorno de banho, com a mensagem de WhatsApp pronta e o registro de quem já foi chamado.",
        "P1",
        "Implementado",
      ],
      [
        "RF-136",
        "Pacotes de banho vendidos adiantado (30, 60 ou 90 dias), com saldo por pet, uso na retirada e aviso do penúltimo banho.",
        "P1",
        "Implementado",
      ],
      [
        "RF-137",
        'Agenda própria do profissional ("Minha agenda"): só os atendimentos dele, sem preço, documento nem telefone do tutor; avança só o andamento do que é dele.',
        "P1",
        "Implementado",
      ],
      [
        "RF-138",
        "Menu e dashboard do pet shop e da clínica (atendimentos, agenda, receita por serviço), sem cartões de loja, fiscal e vencimento que não se aplicam.",
        "P1",
        "Implementado",
      ],
      [
        "RF-139",
        "Fidelidade (pontos, cashback, indicação), campanhas segmentadas e pós-venda automático.",
        "P3",
        "Planejado",
      ],
      [
        "RF-13A",
        "Assinatura de banho e serviços (cobrança recorrente, uso ilimitado ou por pacote, pausa e cancelamento) e compra programada de ração.",
        "P2",
        "Planejado",
      ],
      [
        "RF-13B",
        "Hotel, creche e táxi dog (diárias, vaga, checklist de entrada e saída, rota).",
        "P3",
        "Planejado",
      ],
    ]),
);

rf.push(
  h2("4.12 Clínica veterinária") +
    requisitos([
      [
        "RF-140",
        'Perfil Veterinário com CRMV e UF no cadastro profissional; módulo "clínica" liberado por CNAE 7500 ou ramo; conta ligada a um cadastro de veterinário ativo.',
        "P0",
        "Implementado",
      ],
      [
        "RF-141",
        "Consulta e prontuário: queixa, anamnese, sinais vitais, exame físico, diagnóstico, conduta e retorno; atendimento fechado é imutável, correção é adendo identificado; só o veterinário lê e escreve; cada abertura de ficha fica na auditoria de acessos.",
        "P0",
        "Implementado",
      ],
      [
        "RF-142",
        "Iniciar atendimento sem consulta marcada (paciente que chegou direto) e cadastro do paciente pelo veterinário.",
        "P1",
        "Implementado",
      ],
      [
        "RF-143",
        "Vacinas e vermífugos: catálogo (série de doses, intervalos, reforço, idade mínima, produto), aplicação com lote e baixa de estoque, próxima dose com atalhos de 21 dias, 30 dias e 1 ano, vacina aplicada em outro local e cartão de vacinação para imprimir.",
        "P0",
        "Implementado",
      ],
      [
        "RF-144",
        'Reforços: lista de pets com vacina ou vermífugo a tomar ou atrasado, com WhatsApp e "já falei"; mostra só o nome do item e a data.',
        "P1",
        "Implementado",
      ],
      [
        "RF-145",
        "Exames: modelos editáveis (hemograma, bioquímica e urina) com campos, unidades, campo calculado e faixa por espécie; resultados preenchidos só com número, valor fora da faixa destacado, exame fechado imutável com adendo, cancelamento com motivo, evolução e laudo imprimível; exame avulso trazido de fora.",
        "P0",
        "Implementado",
      ],
      [
        "RF-146",
        "Anexos do atendimento e do exame (imagem, laudo em arquivo, exame laboratorial) em armazenamento privado, com link que dura 2 minutos e registro de quem abriu; anexo cancelado com motivo continua no registro.",
        "P1",
        "Implementado",
      ],
      [
        "RF-147",
        "Trabalho sem internet no consultório e em visitas: cofre criptografado no notebook com a agenda, tutores e pacientes; cadastro rápido, atendimento, vacina, exame e anexos guardados e enviados ao reconectar, de forma idempotente, com recusa visível.",
        "P0",
        "Implementado",
      ],
      ["RF-148", "Cobrança clínica (consulta, vacina e exame no caixa).", "P1", "Bloqueado"],
      [
        "RF-149",
        "Receituário e documentos: receita simples, atestado, termo de consentimento (anestesia, cirurgia, eutanásia, internação) e solicitação de exames, emitidos pelo veterinário, numerados por empresa e ano, impressos em A4 com CRMV; imutáveis, com cancelamento e motivo; modelos próprios da clínica; recusa receita de controle especial.",
        "P0",
        "Em revisão · #94",
      ],
      [
        "RF-14A",
        "Mensagens ao tutor: confirmar agendamento, pet pronto e exame pronto (sem resultado na mensagem), além de aniversário, retorno e reforço de vacina, com WhatsApp de 1 clique; modelos de mensagem por empresa; tutor pode pedir para não receber (LGPD).",
        "P1",
        "Em revisão · #93",
      ],
      [
        "RF-14B",
        "Envio automático de mensagens pela API oficial do WhatsApp (conta Business, modelos aprovados), usando a mesma fila e os mesmos modelos.",
        "P1",
        "Planejado",
      ],
      [
        "RF-14C",
        "Assinatura digital (ICP-Brasil) e receita de controle especial.",
        "P2",
        "Planejado",
      ],
      [
        "RF-14D",
        "Portal do tutor por link seguro: carteirinha de vacina, próximos reforços, resultados liberados e pedido de agendamento.",
        "P1",
        "Planejado",
      ],
      [
        "RF-14E",
        "Internação e cirurgia (leitos, prescrição e checklist de medicação, evolução, alta, diária).",
        "P2",
        "Planejado",
      ],
      [
        "RF-14F",
        "Telemedicina (exige relação presencial registrada, vedada em urgência), curva de peso e escore corporal, plano de saúde pet.",
        "P3",
        "Planejado",
      ],
    ]),
);

rf.push(
  h2("4.13 Gestão SaaS (equipe Ze Tech)") +
    requisitos([
      [
        "RF-150",
        "Clientes da Ze Tech com planos, histórico de cobranças, filiais e situação; contas a pagar da Ze Tech.",
        "P1",
        "Implementado",
      ],
      [
        "RF-151",
        "Notas emitidas por cliente, assistência por cliente, custo por técnico e tempo real das lojas.",
        "P2",
        "Implementado",
      ],
      [
        "RF-152",
        "Criação de cliente (empresa e administrador) pela equipe, desfeita por inteiro se uma etapa falhar; campo do link de acesso da loja no cadastro do assinante.",
        "P1",
        "Implementado",
      ],
      [
        "RF-153",
        "Liberação explícita de módulos por empresa pela equipe Ze Tech.",
        "P1",
        "Implementado",
      ],
      [
        "RF-154",
        "Cobrança com Pix/boleto automáticos e baixa (hoje o link e a linha digitável são informados à mão).",
        "P1",
        "Bloqueado",
      ],
      [
        "RF-155",
        "API pública com chaves por empresa, webhooks de saída, WhatsApp automático e integração com e-commerce/marketplaces.",
        "P2",
        "Planejado",
      ],
    ]),
);

partes.push(rf.join(""));

// 5
partes.push(
  h1("5. Fluxos principais") +
    h2("5.1 Venda de obra com entrega parcial") +
    ol([
      "O vendedor monta o orçamento (cliente, obra, itens, desconto, frete) e o gera em PDF.",
      "O cliente aprova; o orçamento vira pedido sem redigitar e o estoque é reservado.",
      "O gestor aprova; o estoquista separa e confere lendo os códigos de barras.",
      "A logística planeja entregas; cada entrega leva parte dos itens. O sistema controla o saldo por item e trava saídas acima do saldo.",
      "O motorista inicia a rota e registra sucesso ou insucesso; ocorrências (falta, avaria) ficam registradas.",
      "O financeiro gera as contas a receber; a nota fiscal é emitida; a comissão nasce quando o pedido é entregue.",
    ]) +
    h2("5.2 Venda de balcão sem internet") +
    ol([
      "O operador abre o caixa e vende pela frente de caixa; cada venda leva uma chave única.",
      "Sem conexão, a venda fica guardada no aparelho; o recibo é impresso normalmente.",
      "Ao reconectar, a fila é enviada. Se a venda já tinha chegado (resposta perdida), o sistema avisa e não vende de novo.",
      "Se o banco recusar, a venda fica na lista com o erro; o operador decide tentar de novo ou descartar (com confirmação).",
      "Com a venda registrada, o operador pode emitir a NFC-e (CPF opcional). A nota fica pronta ou lista o que falta resolver.",
    ]) +
    h2("5.3 Restaurante: da comanda ao caixa") +
    ol([
      "O garçom abre a comanda na mesa, lança itens com opções e envia à cozinha.",
      "A cozinha acompanha a fila em tempo real; o estoque dos insumos baixa ao enviar.",
      "Na conta, o garçom (ou o caixa) aplica serviço e couvert; a gestão autoriza desconto; quem sai paga a própria parte (baixa parcial) e a comanda segue aberta.",
      "O fechamento lança os pagamentos no caixa.",
    ]) +
    h2("5.4 Pet shop: do agendamento à retirada") +
    ol([
      "A recepção cadastra o tutor e o pet (ou só o pet, com o tutor novo) e agenda o serviço com o profissional; o sistema impede sobreposição e congela preço e duração.",
      'Na véspera, a lista "Confirmar agendamento" traz quem chamar, com a mensagem pronta; o clique abre o WhatsApp e registra o aviso.',
      "O profissional vê só a própria agenda e avança o atendimento (em atendimento, pronto). Com o pet pronto, a recepção avisa o tutor.",
      'Na retirada, "Retirar e cobrar" abre o caixa com os serviços; a comissão do profissional e a NFS-e em rascunho nascem na cobrança. Banho de pacote sai do saldo do pacote.',
      "Depois, as listas de retorno de banho e aniversário trazem quem chamar de novo.",
    ]) +
    h2("5.5 Clínica: consulta, vacina, exame e documentos") +
    ol([
      "O veterinário abre o atendimento pela agenda ou inicia um atendimento sem consulta marcada; cada abertura de ficha fica na auditoria de acessos.",
      "Registra queixa, exame e conduta; aplica vacina escolhendo o lote (baixa o estoque e calcula o reforço); abre exame pelo modelo, preenche só números e fecha; anexa imagem ou laudo.",
      "Emite documentos (receita, atestado, termo, solicitação de exames), que saem numerados e imutáveis, em A4, com o CRMV.",
      'Fecha o atendimento: ele fica imutável e correção vira adendo; a consulta vai para "pronta" e a recepção cobra.',
      "A recepção vê a lista de reforços e de exames prontos, sem texto do prontuário, e chama o tutor.",
      "Sem internet (visita a uma propriedade rural): o veterinário baixa a cópia da agenda antes de sair, trabalha com os dados criptografados no notebook e tudo é enviado ao reconectar, sem duplicar.",
    ]) +
    h2("5.6 Nota fiscal do balcão (NFC-e) e Reforma Tributária") +
    ol([
      "Venda registrada → NFC-e criada (número reservado só quando está tudo certo).",
      "Transmissão à Sefaz pela ACBr; resposta autorizada, rejeitada ou em contingência (transmissão ainda bloqueada).",
      "Rejeitadas e sem retorno aparecem na tela de pendências fiscais para tratamento no mesmo dia.",
      "Na NF-e do regime normal, cada item leva a classificação IBS/CBS do produto (padrão: tributação integral) e a nota leva os totais de IBS e CBS (em revisão, #92). Simples e MEI só entram em 2027.",
    ]),
);

// 6
partes.push(
  h1("6. Requisitos não funcionais") +
    tabela(
      ["Área", "Requisito"],
      [
        [
          "Segurança e isolamento",
          "Nenhum usuário vê ou altera dados de outra empresa; perfis valem no banco, não só na tela; perfis restritos (garçom, cozinha, profissional, veterinário) isolados das demais telas; nenhuma tabela ou função nova sem a proteção (o CI reprova).",
        ],
        [
          "Dado clínico",
          "Só o veterinário lê e escreve prontuário, exames, anexos e documentos, sempre por funções; documento e atendimento fechado são imutáveis; cada leitura fica na auditoria de acessos (sem texto clínico); anexos em armazenamento privado, com link de 2 minutos.",
        ],
        [
          "Integridade do dinheiro",
          "Operações de caixa, estoque e nota são atômicas; reenvio nunca duplica; operação recusada nunca é descartada sozinha.",
        ],
        [
          "Disponibilidade no balcão e no consultório",
          "Frente de caixa, salão, delivery e conferência abrem e operam sem internet; a clínica trabalha sem internet com os dados criptografados no aparelho; telas voltam a abrir com os dados em cache.",
        ],
        [
          "Auditoria",
          "Alterações em financeiro, fiscal, empresa, filiais, papéis, preços, descontos e estoque ficam registradas com autor, antes e depois; segredos (tokens) aparecem mascarados.",
        ],
        [
          "Desempenho",
          "Telas de operação (caixa, salão, separação, agenda) respondem de forma imediata em aparelhos comuns; listas grandes paginadas; índices nas consultas de auditoria e pendências. Metas numéricas a definir com medição real.",
        ],
        [
          "Usabilidade",
          "Interface em português, responsiva, com atalhos de teclado no balcão, máscaras nos campos e textos de erro compreensíveis para o operador.",
        ],
        [
          "Privacidade (LGPD)",
          "Dados pessoais tratados por finalidade; tutor pode pedir para não receber mensagens e some de todas as listas; mensagem de exame não leva resultado; verificação anti-robô sem guardar o IP em claro; acesso por perfil.",
        ],
        [
          "Qualidade",
          "Cada alteração passa por CI com testes de segurança do banco, testes unitários, tipos, build e lint; revisão automática de código.",
        ],
        [
          "Conformidade fiscal",
          "Regras de NF-e, NFC-e e NFS-e dependem de UF e município; validar com um contador antes de produção. O CNPJ alfanumérico e os tributos IBS/CBS seguem as notas técnicas 2026.004 e 2025.002-RTC.",
        ],
        [
          "Conformidade veterinária",
          "Documentos com CRMV e UF da emissão; receita de controle especial recusada até haver assinatura qualificada (Resolução CFMV 1.465/2022 e normas da Anvisa); textos dos termos são modelos que a clínica deve revisar com a assessoria jurídica.",
        ],
      ],
      ["22%", "78%"],
    ),
);

// 7
partes.push(
  h1("7. Premissas, restrições e fora de escopo") +
    h2("Premissas") +
    ul([
      "O sistema é entregue como aplicação web instalável (PWA), usada em computador, tablet e celular.",
      "O desenvolvimento é conectado ao Lovable: migrations e código sincronizam com o editor; o histórico publicado não é reescrito.",
      "A emissão fiscal usa um emissor terceiro (ACBr API) e certificado digital A1 por empresa.",
      "O módulo de pet shop e clínica atende cães e gatos; animais de grande porte e propriedade rural (cadastro de rebanho) não estão no escopo.",
    ]) +
    h2("Restrições") +
    ul([
      "Pix, boleto e TEF exigem escolha de provedor/credenciadora pelo dono do produto (conta, taxas e contrato).",
      "iFood exige credencial de parceiro.",
      "A transmissão da NFC-e depende de confirmar o suporte na documentação da ACBr e de homologação com cliente piloto.",
      "O envio automático de WhatsApp exige a API oficial (conta Business, número por clínica e modelos aprovados pela Meta).",
      "A cobrança clínica depende da resposta do contador sobre o tratamento fiscal da vacina.",
      "O grupo IBS/CBS no emissor (ACBr) precisa ser validado em homologação antes de uso em produção.",
    ]) +
    h2("Fora de escopo (por ora)") +
    ul([
      "Folha de pagamento e RH.",
      "Contabilidade completa (o produto exporta arquivos para o contador; não o substitui).",
      "Marketplace próprio de produtos.",
      "Receita de controle especial e assinatura digital de documentos (planejados em fase própria).",
    ]),
);

// 8
partes.push(
  h1("8. Roadmap por fases") +
    tabela(
      ["Fase", "Objetivo", "Entregas principais", "Situação"],
      [
        [
          "0 — Estabilização",
          "Reduzir risco antes de expandir",
          "Mapa dos fluxos; papéis no banco; fiscal protegido; comissão e venda sem duplicar; referências entre empresas; gravações em etapas viram transação; auditoria ampliada e tela; acesso por filial; CAPTCHA; salvar empresa numa transação.",
          sit("Implementado") + " Concluída",
        ],
        [
          "1 — Entrada de dados",
          "Reduzir o custo de colocar cliente novo",
          "Importação por planilha CSV de produtos, clientes e saldos, com pré-visualização, validação por linha, relatório de erros e importação transacional. Falta: arquivo .xlsx direto e checklist guiado.",
          sit("Implementado") + " Núcleo entregue",
        ],
        [
          "2 — Recebimento e fiscal no balcão",
          "Vender no balcão sem digitar nada à mão",
          "NFC-e (base, configuração, botão e pendências prontos; transmissão pendente); Pix com QR dinâmico e baixa por webhook; boleto registrado.",
          sit("Parcial"),
        ],
        [
          "3 — TEF e conciliação",
          "Cartão sem digitação e extrato que fecha",
          "Importação de extrato OFX (pronta); TEF integrado a uma credenciadora; Open Finance.",
          sit("Parcial"),
        ],
        [
          "4 — Contabilidade",
          "Entregar ao contador sem retrabalho",
          "SPED Fiscal e Contribuições; exportações; configuração real do ISS da NFS-e.",
          sit("Planejado"),
        ],
        [
          "5 — Integrações",
          "Abrir o produto",
          "API pública com chaves por empresa; webhooks de saída; WhatsApp automático; e-commerce/marketplace por um canal; iFood.",
          sit("Planejado"),
        ],
        [
          "6 — Operação avançada",
          "Diferenciais",
          "Cálculo de quantidade e lista de materiais por obra; logística offline no celular; painéis com origem do valor; relatórios com filtros salvos; CT-e/MDF-e.",
          sit("Planejado"),
        ],
        [
          "P1–P4 — Pet shop e clínica",
          "Atender pet shop e clínica veterinária de ponta a ponta",
          "Loja e agenda de banho e tosa; pacotes, granel, contatos e agenda do profissional; prontuário, vacinas e reforços; exames, anexos e trabalho sem internet. Falta: cobrança clínica (aguarda o contador).",
          sit("Implementado") + " Cobrança clínica bloqueada",
        ],
        [
          "P5 — Relacionamento com o tutor",
          "Reduzir faltas e aumentar o retorno",
          "Mensagens ao tutor com modelos e opção de não receber (em revisão, #93); documentos da clínica (em revisão, #94); depois API oficial do WhatsApp e portal do tutor.",
          sit("Em revisão"),
        ],
        [
          "P6 — Recorrência e hospital",
          "Receita recorrente e clínica de maior porte",
          "Assinatura de banho e serviços; compra programada de ração; internação e cirurgia; assinatura digital e receita de controle especial; hotel e creche; fidelidade.",
          sit("Planejado"),
        ],
        [
          "F1 — CNPJ alfanumérico",
          "Aceitar o novo CNPJ em todo o fiscal",
          "Empresa, cadastro, importação e consulta (entregue); emissão, XML, PDF, CT-e e conferência de fornecedor (em revisão, #91).",
          sit("Em revisão"),
        ],
        [
          "F2 — Reforma Tributária",
          "Emitir NF-e com IBS/CBS",
          "Fase 1 no regime normal: tabelas, classificação do produto, cálculo e grupos da NF-e (em revisão, #92). Próximas: simulação e pedidos, NFC-e e devolução, compras (crédito), DANFE, CSTs restantes, notas de crédito e débito e eventos, Simples/MEI em 2027.",
          sit("Em revisão"),
        ],
      ],
      ["16%", "17%", "49%", "18%"],
    ) +
    nota(
      "**Dívida técnica acompanhada:** testes automatizados do front além dos já existentes; lockfile reproduzível na CI; quebrar telas muito grandes em componentes; avisos de lint; medir o custo de verificação de papel nas políticas do banco com dados reais; tipos gerados pelo Lovable que sobrescrevem ajustes manuais.",
    ),
);

// 9
partes.push(
  h1("9. Riscos, dependências e decisões em aberto") +
    h2("Riscos") +
    tabela(
      ["Risco", "Impacto", "Mitigação"],
      [
        [
          "Fiscal em produção (rejeições, regras por UF, CNPJ alfanumérico, IBS/CBS)",
          "Alto",
          "Homologação com cliente piloto; tela de pendências; validação com contador; formato do emissor testado em homologação antes de produção.",
        ],
        [
          "Migrations ainda não aplicadas e testadas no banco real (20261112 a 20261116 aguardam os PRs em revisão)",
          "Alto",
          "Aplicar em ambiente de teste e conferir cada perfil (filial, auditoria, NF-e, caixa, contato, veterinário) antes de abrir; seguir a ordem dos arquivos.",
        ],
        [
          "Tipos gerados pelo Lovable sobrescrevem ajustes manuais",
          "Médio",
          "Reconferir tipos após cada sincronização; o CI acusa.",
        ],
        [
          "Dependência de terceiros (ACBr, provedor de Pix, credenciadora, WhatsApp)",
          "Alto",
          "Camada de integração isolada; webhooks idempotentes com assinatura.",
        ],
        [
          "Dado clínico sensível (LGPD) e perda de aparelho com dados offline",
          "Alto",
          "Acesso só do veterinário, auditoria de leitura, cofre criptografado no notebook, mensagens sem conteúdo clínico, opção de não receber mensagens.",
        ],
        [
          "Textos jurídicos dos termos (eutanásia, anestesia) usados sem revisão",
          "Médio",
          "Modelos marcados para revisão jurídica; a clínica guarda os próprios.",
        ],
        [
          "Falta de teste de campo do salão, do app do motorista e do trabalho sem internet da clínica",
          "Médio",
          "Piloto com loja e clínica reais; roteiro de testes por perfil.",
        ],
        ["Concentração de telas grandes", "Baixo", "Quebrar em componentes quando tocadas."],
      ],
      ["38%", "10%", "52%"],
    ) +
    h2("Decisões em aberto (do dono do produto)") +
    tabela(
      ["#", "Decisão", "Desbloqueia"],
      [
        ["1", "Provedor de Pix e boleto (banco ou gateway).", "RF-084, RF-085, RF-154"],
        ["2", "Credenciadora da maquininha (Stone, Cielo, Rede ou outra).", "RF-066"],
        [
          "3",
          "Liberar o acesso à documentação da API de NFC-e da ACBr (ou colar as páginas).",
          "RF-094",
        ],
        ["4", "Escopo fiscal da contabilidade (SPED por estado atendido).", "RF-097"],
        ["5", "Credencial de parceiro do iFood.", "RF-107"],
        [
          "6",
          "Cadastrar as chaves do Turnstile (CAPTCHA) e aplicar as migrations da rodada.",
          "Operação segura do contato",
        ],
        [
          "7",
          "Resposta do contador sobre o tratamento fiscal da vacina.",
          "RF-148 (cobrança clínica)",
        ],
        [
          "8",
          "WhatsApp: abrir conta Business por clínica e aprovar os modelos de mensagem na Meta (ou escolher um provedor).",
          "RF-14B",
        ],
        [
          "9",
          "Provedor de assinatura digital e regra atual da Anvisa/CFMV para receita de controle especial.",
          "RF-14C",
        ],
        [
          "10",
          "Confirmar com o fornecedor do emissor (ACBr) o formato do grupo IBS/CBS e testar em homologação.",
          "RF-0A0 em produção",
        ],
        [
          "11",
          "Revisão jurídica dos modelos de termo de consentimento.",
          "Uso dos modelos iniciais",
        ],
        [
          "12",
          "Priorizar o próximo passo da Reforma Tributária (simulação e pedidos, NFC-e, compras) e a orientação para Simples/MEI em 2027.",
          "RF-0A1, RF-0A2",
        ],
      ],
      ["6%", "64%", "30%"],
    ),
);

// 10
partes.push(
  h1("10. Glossário") +
    tabela(
      ["Termo", "Significado"],
      [
        ["Tenant / empresa", "Cliente do SaaS; tudo que ele cria fica isolado dos demais."],
        ["Filial", "Loja da rede; tem depósitos, caixa e configuração fiscal próprios."],
        ["RLS", "Segurança por linha no banco: define quais linhas cada usuário enxerga."],
        [
          "RPC",
          "Função do banco chamada pela aplicação para executar uma operação inteira de uma vez.",
        ],
        ["Idempotente", "Repetir a mesma operação não gera efeito duplicado."],
        [
          "NF-e / NFC-e / NFS-e",
          "Notas fiscais eletrônicas de produto (modelo 55), de consumidor (modelo 65) e de serviço.",
        ],
        [
          "CNPJ alfanumérico",
          "Novo formato do CNPJ (Receita Federal, 2026): 14 caracteres, letras ou números nas 12 primeiras posições e 2 dígitos verificadores numéricos.",
        ],
        [
          "IBS / CBS / IS",
          "Tributos da Reforma Tributária do consumo: Imposto sobre Bens e Serviços (estados e municípios), Contribuição sobre Bens e Serviços (União) e Imposto Seletivo.",
        ],
        [
          "CST / cClassTrib",
          "Código de situação tributária e código de classificação tributária do IBS/CBS, de tabelas oficiais do Informe Técnico da NF-e.",
        ],
        ["CSC", "Código de segurança do contribuinte, exigido para a NFC-e."],
        [
          "Contingência",
          "Emissão alternativa quando a Sefaz está fora do ar; a nota é enviada depois.",
        ],
        [
          "CST/CSOSN, NCM, CFOP",
          "Códigos fiscais do imposto, do produto e da natureza da operação.",
        ],
        ["TEF", "Integração entre o sistema e a maquininha de cartão."],
        ["CMV", "Custo da mercadoria vendida (no restaurante, o custo dos insumos do prato)."],
        ["Romaneio", "Documento impresso da entrega, com itens, quantidades e assinaturas."],
        ["PWA", "Aplicação web que pode ser instalada no aparelho e abrir sem internet."],
        ["Tutor", "Dono do animal; no sistema é um cliente comum ligado a um ou mais pets."],
        [
          "CRMV",
          "Registro do médico veterinário no Conselho Regional (número e UF); aparece em todo documento clínico.",
        ],
        [
          "Prontuário",
          "Registro clínico do atendimento (queixa, exame, diagnóstico, conduta); só o veterinário lê e escreve.",
        ],
        [
          "Adendo",
          "Correção ou complemento de um atendimento ou exame já fechado; o original não muda.",
        ],
        [
          "Cofre",
          "Armazenamento criptografado no navegador do veterinário para trabalhar sem internet.",
        ],
        [
          "Reforço",
          "Dose de vacina ou vermífugo que se repete depois da série inicial (por exemplo, anual).",
        ],
      ],
      ["24%", "76%"],
    ),
);

const html = partes.join("\n");
const arquivo = await gerar({
  html,
  saida: "PRD-ERP-Ze-Tech.pdf",
  rodape: `ERP Ze Tech — PRD v${VERSAO}`,
});
console.log(arquivo);
