# Backup automático no Google Drive

Em Ajustes → Backup na nuvem, o administrador conecta sua própria conta Google. A conexão do cliente OAuth ao projeto não substitui essa autorização por usuário.

- A rotina existente `backup-clientes-noturno` chama `/api/public/hooks/backup-clientes` a cada 15 minutos entre 02:00 e 04:45 em Brasília. Nenhum novo agendamento foi criado.
- Primeiro a rotina produz os arquivos isolados por tenant no armazenamento privado; o envio ao Drive lê apenas esses arquivos concluídos. Não é exportação completa do banco e não copia anexos, contas de acesso ou arquivos de outros buckets.
- Cada chamada envia até três clientes; uma reserva transacional impede envios simultâneos do mesmo tenant. Cada dia admite até três tentativas. Erros e pedidos de reconexão ficam visíveis na tela.
- O envio confere tamanho e MD5 antes de registrar sucesso. A busca por propriedades do tenant e dia recupera uploads cuja confirmação se perdeu.
- Arquivos acima de 50 MB ficam com erro para revisão; o envio multipart tem esse limite para limitar memória por execução.
- A pasta é criada pelo ERP com escopo `drive.file`; arquivos pessoais não são enumerados. A retenção só remove arquivos registrados, depois de confirmar pasta e propriedade do tenant. Apagar ocorre apenas após uma cópia nova conferida. Limpeza limitada a dez arquivos por chamada.
- Retenção segue `politicaDoCliente`: padrão 7 diárias, 4 semanais, 12 mensais; clínica/pet shop 14, 8, 24. Um arquivo pode valer para mais de uma categoria.
- Pausar interrompe novos envios. Desconectar revoga a conexão, remove o segredo cifrado local e preserva as cópias existentes no Drive.
- Reconectar renova a chave cifrada; acesso negado ou necessidade de reconexão interrompem a rotina da conta.
- Chaves cifradas e controles do Drive estão explicitamente fora do catálogo de exportação.

## Verificação pendente

Tela autenticada, recusa do callback sem segredo e testes locais foram conferidos. Envio e limpeza reais ainda dependem de autorização do Google pelo administrador. A versão publicada precisa ser atualizada antes que a rotina noturna alcance as alterações. O OAuth Google externo deve estar publicado, não em Testing, para evitar expiração após sete dias.