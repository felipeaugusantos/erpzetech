# Monitoramento de erros

**O que registra:** erros não tratados do navegador (`error`, `unhandledrejection` e a tela "Esta tela não abriu") e todo `Error` que o servidor escreve em `console.error` (inclusive falhas de funções de servidor e rotinas). Cada defeito vira uma linha em `erros_app`, agrupada por impressão digital (SHA-256 da origem, da mensagem e das 3 primeiras linhas da pilha, sem números nem hashes de arquivo), com contador, primeira e última vez e a empresa afetada.

**Onde ver:** `/ze-tech-erros` (menu Ze Tech, só operador). Ações: resolver, ignorar e reabrir. Erro resolvido que volta é reaberto sozinho.

**Privacidade (LGPD):** o texto é limpo duas vezes (navegador e servidor) de e-mail, CPF/CNPJ, telefone, UUID, token/JWT e query/fragmento de URL (`src/lib/monitoramento.ts`). Não guarda IP, nome nem id do usuário; guarda só a empresa (derivada do token no servidor) e o caminho da página sem parâmetros. Sem serviço externo: nada sai do banco do sistema.

**Contra abuso:** o endpoint público `POST /api/public/erros` limita 20 envios por minuto por IP, corpo de até 16 KB e cada aba manda no máximo 10 defeitos distintos; o banco aceita no máximo 500 defeitos NOVOS por hora (os já conhecidos continuam somando). O limite por IP é em memória de cada instância.

**Ruído ignorado:** `ResizeObserver loop`, `Script error.`, abortos, aba antiga depois de publicar (recarrega sozinha), extensões do navegador, falhas de rede quando o aparelho está sem internet e respostas 4xx do servidor.

**Retenção:** resolvidos e ignorados há mais de 90 dias são apagados pela rotina noturna de backup (`erros_app_limpar`).

**Não cobre (ainda):** alertas ativos (e-mail/WhatsApp à equipe: depende de domínio de envio), uptime, erros de consulta do react-query e métricas de desempenho. Se precisar de alertas antes, o caminho mais curto é um serviço externo (por exemplo Sentry) ligado ao mesmo ponto de captura (`relatarErro` e `relatarErroDoServidor`), com revisão de privacidade e atualização da Política (subprocessador).
