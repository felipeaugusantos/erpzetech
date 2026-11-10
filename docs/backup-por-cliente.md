# Backup por cliente (fases 1 a 4)

Cada cliente (tenant) tem os dados isolados por `tenant_id`. O backup nativo do Supabase é do banco inteiro; este
recurso gera um arquivo só de UM cliente, para a equipe Ze Tech (tela `/ze-tech-backups`). O cliente não baixa.

## Como funciona

- `src/lib/backup-tenant.ts`: catálogo das tabelas que entram (`TABELAS_BACKUP`), das que ficam de fora com o motivo
  (`TABELAS_FORA_DO_BACKUP`), das colunas de segredo que nunca saem (`COLUNAS_FORA_DO_BACKUP`) e da ordem de leitura.
- `src/lib/backup-tenant.functions.ts`: funções de servidor só para operador. Leem com o serviço, sempre filtrando pelo
  cliente, uma página de 1000 linhas por vez. Nada é guardado no servidor.
- A tela conta os dados por grupo (clínica, lava rápido, hotelaria…), deixa escolher o que baixar, monta o arquivo no
  navegador (`.ndjson.gz`: 1ª linha é o manifesto; depois `{"t":"tabela","d":{…}}` por registro) e registra o
  download na auditoria do cliente (`entidade = backup_cliente`).

## Tabela nova com tenant_id

`tests/backup-tenant.test.ts` compara o catálogo com `src/integrations/supabase/types.ts`. Tabela nova entra em
`TABELAS_COM_TENANT` (ou em `TABELAS_FORA_DO_BACKUP`, com o motivo). Sem coluna `id`, declare a ordem em `ORDEM_BACKUP`.
Coluna com nome de segredo (token, senha, api_key, hash) precisa entrar em `COLUNAS_FORA_DO_BACKUP`.

## Não entra

Contas de acesso (auth), chaves de integração, convites do portal, arquivos do armazenamento e operações ainda
guardadas só no navegador do cliente.

## Rotina noturna (fase 3)

- Rota `POST /api/public/hooks/backup-clientes?lote=3`, protegida pelo segredo do cron (`LOVABLE_CRON_SECRET`, mesmo
  mecanismo da rotina do WhatsApp). Cada chamada faz o backup de até `lote` clientes ativos (padrão 3, máximo 10) que
  ainda não têm o do dia, aplica a retenção e devolve um relatório. Repetir a chamada é seguro: cliente já feito ou em
  andamento é pulado (índice único `backup_execucoes_um_por_dia`).
- **Agendamento (falta configurar):** chame a rota a cada 10 a 15 minutos entre 2h e 5h (Brasília) com o cabeçalho
  `Authorization: Bearer <segredo do cron>`. O campo `pendentes` do relatório diz quantos clientes ainda faltam no dia.
  Antes de ligar, confirme no Lovable quem é o agendador (o mesmo ponto em aberto do WhatsApp).
- O arquivo é produzido por streaming (uma página por vez), compactado e enviado ao bucket privado `backups-clientes`
  em `{segmento}/{tenant_id}/{AAAA-MM-DD}.ndjson.gz`. O servidor não guarda o cliente inteiro na memória. A primeira
  linha é o manifesto (contagens do início) e a última é `{"fim": …}` com as contagens reais.
- **Retenção por segmento** (`src/lib/backup-rotina.ts`): cada dia gera um arquivo que conta como diário; domingo
  também como semanal e dia 1º como mensal. Padrão 7 diários, 4 semanais e 12 mensais; clínica e pet shop 14, 8 e 24.
  Cliente com segmentos diferentes usa o maior prazo. O que sai da regra é apagado do bucket e a execução vira `expirado`.
- `backup_execucoes` e o bucket são só do serviço (nenhum acesso para o app nem para o cliente). Na tela da equipe, cada
  cliente mostra o último backup da rotina e a lista dos guardados; baixar gera um link de 5 minutos que fica na
  auditoria do cliente.
- Execução em andamento há mais de 2 h é marcada como interrompida e libera nova tentativa; falha apaga o arquivo parcial.

## Limites conhecidos

- O tamanho máximo do arquivo é o limite de upload do projeto no Supabase (global, em Configurações do Storage). Cliente
  que passe disso falha com o erro registrado em `backup_execucoes`; aí é preciso subir o limite ou exportar por pedaços.
- O upload é feito por streaming sem tamanho prévio: valide com um cliente real antes de ligar o agendador.

## Restauração assistida (fase 4)

Tela `/ze-tech-restauracao`, só para a equipe Ze Tech. Fluxo: escolher o cliente, enviar o arquivo `.ndjson.gz`,
**conferir** (não grava nada) e só então restaurar.

- **Conferência do arquivo** (`src/lib/backup-restauracao.ts`): recusa backup de outro cliente, linha com `tenant_id`
  de outro cliente, tabela fora do catálogo, coluna de segredo, JSON quebrado, versão mais nova, e arquivo cortado (a
  última linha `fim` precisa existir e bater com a contagem). Qualquer problema bloqueia tudo.
- **Plano:** compara os ids do arquivo com o que existe hoje e mostra, por tabela, quantas linhas faltam.
- **Só insere o que falta** (`backup_restaurar_tabela`, migração `20261231000000`): linha que já existe não é alterada
  (`ON CONFLICT DO NOTHING`) e nada é apagado. Repetir é seguro. Só o serviço executa; cada chamada vai para a auditoria
  do cliente.
- **Só cadastros** (`TABELAS_RESTAURAVEIS`: fornecedores, categorias, produtos, variações, tabelas de preço, clientes,
  pets, serviços do pet e do lava rápido, veículos, obras). Ficam de fora vendas, estoque, financeiro, fiscal,
  prontuário e principalmente acessos e permissões: restaurar um papel antigo devolveria acesso já revogado. A lista da
  função do banco e a do código são conferidas por teste. Incluir outra tabela exige conferir antes se ela tem gatilho
  com efeito colateral.
- **Ponto de segurança obrigatório:** só restaura se houver backup do cliente concluído nas últimas 24 horas (a tela gera
  um na hora, se faltar). A restauração só libera depois de digitar o nome do cliente.
- **Atomicidade:** cada lote de até 300 linhas é uma transação; a restauração inteira NÃO é uma transação única (os lotes
  vão por chamadas separadas, em ordem de dependência). Como só insere, parar no meio nunca destrói nada: o que entrou
  fica, e dá para conferir e rodar de novo.
- Os gatilhos de validação das tabelas continuam ligados. Linha que depende de um registro que também foi apagado e
  não é restaurável (por exemplo um cliente ligado a um profissional apagado) falha com o erro da chave estrangeira.

## Próximos passos possíveis

Ampliar a lista de tabelas restauráveis (com revisão de cada gatilho) e restaurar por grupo (clínica, lava rápido).
