# Notas recebidas (manifestação do destinatário)

Tela `/nfe-recebidas` (menu Notas Fiscais). Busca as NF-e emitidas contra o CNPJ da empresa pela
Distribuição DF-e do emissor fiscal (ACBr) e registra a manifestação.

## Regra de ouro

- **Busca e ciência podem ser automáticas** (liga o administrador ou gestor, por empresa; vale a
  configuração `/empresas/{cnpj}/distnfe` do ACBr: busca a cada 1 a 24 h, ciência opcional).
- **Confirmar e recusar nunca são automáticos.** Só administrador, gestor ou financeiro.
  Desconhecimento (210220) e operação não realizada (210240) exigem justificativa de 15 a 255
  caracteres; não podem ser desfeitos na Sefaz.

## Onde fica cada coisa

- `src/lib/nfe-recebidas.ts`: regras puras (eventos, justificativa, CNPJ permitido, intervalo). Testado
  em `tests/nfe-recebidas.test.ts`.
- `src/lib/nfe-recebidas.functions.ts`: funções de servidor (painel, config, listar, buscar,
  manifestar, histórico). Conferem papel e empresa; o CNPJ pedido tem que ser de uma empresa da pessoa.
- `drizzle/migrations/0085_nfe_manifestacoes.sql`: auditoria (quem, quando, evento, protocolo). Sem
  acesso direto; o servidor lê e grava com a chave de serviço.

## Requisitos para funcionar

- CNPJ de 14 caracteres na empresa (CPF não recebe NF-e por este serviço).
- Certificado digital A1 da empresa cadastrado no emissor fiscal (o sistema guarda só os dados dele).
- A conta ACBr precisa ter o serviço de Distribuição NF-e liberado (a chave usa o escopo
  `empresa nfe`; se a API pedir escopo próprio, ajustar em `src/lib/acbr.server.ts`).
- A Sefaz limita a frequência das consultas: a busca manual respeita o intervalo mínimo
  (`ignorar_tempo_espera` fica sempre `false`, para não bloquear o CNPJ).
