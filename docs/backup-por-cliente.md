# Backup por cliente (fases 1 e 2)

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

## Próximas fases
Cron noturno com retenção por segmento (bucket privado) e restauração assistida.
