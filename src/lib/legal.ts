// Termos de Uso e Política de Privacidade (LGPD) do EZRA ERP. Texto base: o jurídico da EZRA deve revisar antes da venda.
// Qualquer mudança de conteúdo exige trocar VERSAO_LEGAL (AAAA-MM-DD): todo mundo aceita de novo na próxima entrada.

/** Versão vigente dos dois documentos. É a chave do aceite gravado no banco (aceites_legais.versao). */
export const VERSAO_LEGAL = "2026-11-16";

/** Dados da empresa que aparecem nos documentos. Preencha razão social, CNPJ e foro antes de publicar. */
export const DADOS_LEGAIS = {
  nome: "EZRA",
  razaoSocial: "",
  cnpj: "",
  email: "contato@zeregistra.com.br",
  /** Contato do encarregado (DPO) para pedidos dos titulares. */
  emailPrivacidade: "contato@zeregistra.com.br",
  foro: "",
};

export type SecaoLegal = { titulo: string; paragrafos: string[] };
export type DocumentoLegal = { titulo: string; resumo: string; secoes: SecaoLegal[] };

/** "EZRA (CNPJ ...)" com o que estiver preenchido. */
export function identificacaoDaEmpresa(d = DADOS_LEGAIS): string {
  const base = d.razaoSocial.trim() ? `${d.razaoSocial.trim()} (${d.nome})` : d.nome;
  return d.cnpj.trim() ? `${base}, CNPJ ${d.cnpj.trim()}` : base;
}

export function formatarVersaoLegal(versao: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(versao);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : versao;
}

export function montarTermos(d = DADOS_LEGAIS): DocumentoLegal {
  const quem = identificacaoDaEmpresa(d);
  return {
    titulo: "Termos de Uso",
    resumo: `Regras de uso do EZRA ERP, sistema de gestão oferecido como serviço (SaaS) por ${quem}.`,
    secoes: [
      {
        titulo: "1. Aceitação",
        paragrafos: [
          `Estes Termos regem o uso do EZRA ERP ("Serviço") oferecido por ${quem} ("EZRA") à empresa assinante ("Cliente") e às pessoas que ela autoriza a usar o sistema ("Usuários").`,
          "Ao marcar o aceite e entrar no sistema, o Usuário declara ter lido e concordado com estes Termos e com a Política de Privacidade. Quem aceita em nome da empresa declara ter poderes para isso.",
        ],
      },
      {
        titulo: "2. O que é o Serviço",
        paragrafos: [
          "O EZRA ERP é um sistema online de gestão: vendas e caixa, estoque, financeiro, emissão de documentos fiscais, módulos por segmento (como pet shop, clínica veterinária, restaurante, lava-rápido e hotelaria) e recursos opcionais, conforme o plano e os módulos liberados para a empresa.",
          "Os recursos disponíveis dependem do plano contratado e dos módulos liberados pela EZRA. Recursos em evolução podem mudar, e a EZRA avisa mudanças relevantes com antecedência razoável.",
        ],
      },
      {
        titulo: "3. Conta, acesso e segurança",
        paragrafos: [
          "Cada Usuário tem acesso pessoal e intransferível. O Cliente é responsável por quem cadastra, pelos perfis que concede e por retirar o acesso de quem sai da empresa.",
          "Guarde sua senha. Atividade feita com o seu acesso é considerada feita por você. Avise a EZRA imediatamente se suspeitar de uso indevido.",
        ],
      },
      {
        titulo: "4. Responsabilidades do Cliente",
        paragrafos: [
          "O Cliente é responsável pela veracidade dos dados que lança, pelos cadastros fiscais (CFOP, CST/CSOSN, alíquotas, NCM e demais parâmetros), pela guarda do certificado digital e pela conferência dos documentos fiscais emitidos. As sugestões do sistema são apoio e não substituem a orientação do contador do Cliente.",
          "No módulo de clínica veterinária, o conteúdo clínico (prontuários, receitas, exames) é de responsabilidade do profissional que o registra. O sistema, inclusive recursos de inteligência artificial, é ferramenta de apoio: não diagnostica, não indica tratamento nem dose, e qualquer rascunho gerado precisa de revisão do profissional.",
          "É proibido usar o Serviço para atividade ilegal, tentar burlar a segurança, acessar dados de outras empresas, copiar o sistema ou sobrecarregá-lo de forma abusiva.",
        ],
      },
      {
        titulo: "5. Dados do Cliente",
        paragrafos: [
          "Os dados lançados pelo Cliente continuam sendo do Cliente. A EZRA os trata apenas para prestar o Serviço, conforme a Política de Privacidade, e mantém cada empresa isolada das demais.",
          "O Cliente pode pedir a exportação dos seus dados. Depois do encerramento do contrato, os dados ficam disponíveis para exportação por prazo combinado e, então, são eliminados ou anonimizados, salvo o que a lei exigir guardar (por exemplo, documentos fiscais).",
        ],
      },
      {
        titulo: "6. Planos, preço e pagamento",
        paragrafos: [
          "Valores, prazos, período de teste, taxa de implantação e filiais adicionais seguem o plano e a proposta aceitos pelo Cliente. O não pagamento no vencimento pode levar à suspensão do acesso após aviso, sem apagar os dados.",
          "Reajustes são informados com antecedência e seguem o que estiver previsto na proposta ou no contrato.",
        ],
      },
      {
        titulo: "7. Disponibilidade e suporte",
        paragrafos: [
          "A EZRA busca manter o Serviço disponível e faz manutenções programadas, avisadas sempre que possível. Não há garantia de funcionamento ininterrupto: falhas de internet, de provedores externos (como a Receita e as SEFAZ, operadoras de pagamento e serviços de nuvem) e casos de força maior estão fora do controle da EZRA.",
          "Algumas telas guardam operações no navegador quando a internet cai e as enviam ao reconectar. Manter o aparelho com o sistema aberto até a sincronização é responsabilidade do Cliente.",
          "O suporte é prestado pelos canais informados no site e pela central de chamados do sistema, em horário comercial, salvo contrato diferente.",
        ],
      },
      {
        titulo: "8. Propriedade intelectual",
        paragrafos: [
          "O sistema, a marca, o código e os textos são da EZRA ou licenciados a ela. O Cliente recebe o direito de uso durante o contrato, não exclusivo e intransferível. Nada nestes Termos transfere propriedade intelectual.",
        ],
      },
      {
        titulo: "9. Limitação de responsabilidade",
        paragrafos: [
          "A EZRA responde pelos danos diretos que causar por falha do Serviço, até o limite do valor pago pelo Cliente nos 12 meses anteriores ao fato, nos limites da lei. A EZRA não responde por lucros cessantes, por decisões tomadas com base em dados lançados incorretamente nem por penalidades fiscais decorrentes de parametrização, informação ou conferência do Cliente.",
        ],
      },
      {
        titulo: "10. Encerramento",
        paragrafos: [
          "O Cliente pode cancelar conforme o prazo do plano contratado. A EZRA pode suspender ou encerrar o acesso em caso de descumprimento destes Termos, uso abusivo ou inadimplência persistente, com aviso prévio quando possível.",
        ],
      },
      {
        titulo: "11. Mudanças nestes Termos",
        paragrafos: [
          `Estes Termos podem ser atualizados. A versão vigente aparece nesta página com a data. Quando houver mudança relevante, o sistema pede um novo aceite na próxima entrada.`,
        ],
      },
      {
        titulo: "12. Lei aplicável e foro",
        paragrafos: [
          d.foro.trim()
            ? `Aplica-se a lei brasileira. Fica eleito o foro da comarca de ${d.foro.trim()} para resolver qualquer disputa, ressalvado o foro do consumidor quando a lei assim determinar.`
            : "Aplica-se a lei brasileira. O foro competente é o definido na proposta ou no contrato firmado com o Cliente.",
          `Dúvidas sobre estes Termos: ${d.email}.`,
        ],
      },
    ],
  };
}

export function montarPrivacidade(d = DADOS_LEGAIS): DocumentoLegal {
  const quem = identificacaoDaEmpresa(d);
  return {
    titulo: "Política de Privacidade",
    resumo: `Como ${quem} trata dados pessoais no EZRA ERP, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).`,
    secoes: [
      {
        titulo: "1. Quem é quem",
        paragrafos: [
          "Para os dados da conta e do uso do sistema (nome, e-mail, login, dados da empresa assinante e registros de acesso), a EZRA é a controladora.",
          "Para os dados que o Cliente lança no sistema sobre as pessoas com quem se relaciona (clientes, tutores, funcionários, fornecedores, hóspedes, pacientes e seus responsáveis), o Cliente é o controlador e a EZRA é a operadora: trata esses dados só para prestar o Serviço e conforme as instruções do Cliente.",
        ],
      },
      {
        titulo: "2. Quais dados tratamos",
        paragrafos: [
          "Conta e acesso: nome, e-mail ou usuário, perfil de permissão, empresa e registros de entrada e de uso.",
          "Empresa assinante: razão social, CNPJ, endereço, contatos, dados fiscais e de cobrança.",
          "Dados lançados pelo Cliente: cadastros de clientes e tutores (nome, CPF/CNPJ, endereço, telefone, e-mail), animais de estimação e seu histórico clínico, vendas, financeiro, documentos fiscais, hóspedes e fichas de hospedagem, entre outros, conforme os módulos que o Cliente usa.",
          "Dados técnicos: endereço IP, tipo de navegador e registros de erro, para segurança e funcionamento.",
          "Não pedimos dados pessoais sensíveis de pessoas. O histórico clínico é de animais; se o Cliente registrar informação de saúde de uma pessoa, é responsável por ter base legal para isso.",
        ],
      },
      {
        titulo: "3. Para que usamos e em que base legal",
        paragrafos: [
          "Prestar o Serviço e cumprir o contrato com o Cliente (execução de contrato).",
          "Cumprir obrigações legais e regulatórias, como guarda de documentos fiscais (obrigação legal).",
          "Segurança, prevenção a fraude, suporte e melhoria do Serviço (legítimo interesse, respeitados os direitos do titular).",
          "Comunicações sobre o contrato, cobrança e avisos do sistema. Comunicação de marketing só com consentimento ou nos casos que a lei permite, com opção de sair.",
          "Não vendemos dados pessoais.",
        ],
      },
      {
        titulo: "4. Com quem compartilhamos",
        paragrafos: [
          "Compartilhamos apenas o necessário com prestadores que fazem o Serviço funcionar: hospedagem e banco de dados, armazenamento de arquivos, envio de e-mail, verificação anti-robô, inteligência artificial e transcrição (apenas nos recursos que o Cliente usa), mensageria como o WhatsApp (apenas onde a empresa ativou) e backup em nuvem (apenas onde o administrador conectou).",
          "Também compartilhamos dados com órgãos públicos quando a função exige (por exemplo, a emissão de notas fiscais envia dados à Receita e às SEFAZ) ou por ordem legal.",
          "O resumo do histórico por inteligência artificial usa só dado clínico do animal, sem dados do tutor, nome do animal, microchip, foto nem veterinário.",
        ],
      },
      {
        titulo: "5. Transferência internacional",
        paragrafos: [
          "Alguns prestadores podem armazenar ou processar dados fora do Brasil. Nesses casos adotamos as garantias previstas na LGPD, como cláusulas contratuais e prestadores com padrões reconhecidos de segurança.",
        ],
      },
      {
        titulo: "6. Por quanto tempo guardamos",
        paragrafos: [
          "Pelo tempo em que o contrato estiver ativo e, depois, pelo prazo necessário para cumprir obrigações legais (como as fiscais), exercer direitos em disputas e atender prazos de backup. Depois disso, eliminamos ou anonimizamos.",
          "Registros de aceite destes documentos são guardados como prova do consentimento e não são apagados.",
        ],
      },
      {
        titulo: "7. Como protegemos",
        paragrafos: [
          "Cada empresa é isolada das demais no banco de dados por regras de acesso; o acesso é por conta pessoal e perfis de permissão; as conexões usam criptografia; operações sensíveis têm registro; os backups por cliente são verificados.",
          "Nenhum sistema é totalmente invulnerável. Em caso de incidente que possa causar risco ou dano relevante, comunicamos o Cliente, os titulares afetados e a Autoridade Nacional de Proteção de Dados (ANPD) nos termos da lei.",
        ],
      },
      {
        titulo: "8. Seus direitos",
        paragrafos: [
          "A LGPD garante ao titular: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento, revogação de consentimento e revisão de decisões automatizadas.",
          `Para exercer qualquer direito sobre dados da conta ou da empresa assinante, escreva para ${d.emailPrivacidade}. Se seus dados foram lançados por uma empresa que usa o EZRA ERP (por exemplo, uma loja, clínica ou hotel), o pedido deve ser feito a essa empresa, que é a controladora, e a EZRA ajuda o Cliente a atender.`,
          "Respondemos no prazo da lei. Você também pode reclamar à ANPD.",
        ],
      },
      {
        titulo: "9. Cookies e armazenamento no navegador",
        paragrafos: [
          "Usamos armazenamento do navegador para manter a sessão, guardar preferências e permitir o trabalho sem internet (fila de operações e cache de consultas). Não usamos cookies de publicidade.",
          "O portal do tutor guarda cache apenas por usuário e o limpa ao trocar de sessão.",
        ],
      },
      {
        titulo: "10. Crianças e adolescentes",
        paragrafos: [
          "O Serviço é voltado a empresas e profissionais, e não é destinado a menores de 18 anos.",
        ],
      },
      {
        titulo: "11. Mudanças nesta Política",
        paragrafos: [
          "Podemos atualizar esta Política. A versão vigente e sua data ficam nesta página, e, em mudanças relevantes, o sistema pede novo aceite.",
        ],
      },
      {
        titulo: "12. Contato",
        paragrafos: [`Encarregado e dúvidas de privacidade: ${d.emailPrivacidade}.`],
      },
    ],
  };
}

/** Itens que o texto precisa ter para ficar de pé; usado pelo teste para ninguém apagar uma seção sem querer. */
export const SECOES_OBRIGATORIAS_PRIVACIDADE = [
  "Quem é quem",
  "Quais dados tratamos",
  "base legal",
  "Seus direitos",
  "Transferência internacional",
  "Contato",
];
