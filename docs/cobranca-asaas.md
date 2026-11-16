# Cobrança automática das mensalidades (Asaas)

**O que faz:** para o cliente com "Cobrança automática (Asaas)" ligada (Ze Tech > cliente > editar), a rotina diária gera a fatura do mês, cria a cobrança no Asaas (o pagador escolhe Pix, boleto ou cartão na página da fatura), recebe o pagamento por webhook e dá baixa sozinha. Fatura vencida há mais de 10 dias suspende o acesso da loja; pagar reativa na hora. Cliente sem a chave ligada segue como hoje (cobrança manual em `/ze-tech-cobranca`).

**O que NÃO faz (ainda):** cobrança automática no cartão guardado. O Asaas exige que o sistema envie os dados do cartão para a API e a tokenização precisa ser habilitada pelo suporte do Asaas na conta; isso traz escopo PCI e decisão de negócio. Hoje o cartão é pago na página da fatura, a cada mês. Também não manda e-mail/WhatsApp próprio: quem avisa o pagador é o Asaas.

## Configuração (variáveis de ambiente)
| Variável | Para quê |
|---|---|
| `ASAAS_API_KEY` | chave da API do Asaas (obrigatória) |
| `ASAAS_API_URL` | base da API; sem ela usa o **sandbox** (`https://api-sandbox.asaas.com/v3`). Em produção, a URL de produção do Asaas (confira na documentação) |
| `ASAAS_WEBHOOK_TOKEN` | token do webhook (invente um valor longo; não use a chave da API) |
| `LOVABLE_CRON_SECRET` | já existente; protege a rotina diária |

**No painel do Asaas:** criar o webhook para `https://<app>/api/public/webhooks/asaas`, com o mesmo token em `ASAAS_WEBHOOK_TOKEN` (o Asaas o envia no cabeçalho `asaas-access-token`), eventos de cobrança, fila sem interrupção.
**Agendamento:** chamar uma vez por dia `POST /api/public/hooks/cobranca-diaria?lote=20` com `Authorization: Bearer <LOVABLE_CRON_SECRET>`. Repetir é seguro. Responde o resumo (faturas geradas, cobranças criadas, falhas por fatura, suspensos, reativados).

## Como funciona
- Fatura continua em `saas_faturas` (fonte da verdade). `saas_gerar_faturas_auto` cria mensalidade e filiais extras do mês só de cliente ativo com cobrança automática, sem duplicar.
- O servidor cria o cliente no Asaas (reaproveita se o CPF/CNPJ já existir) e a cobrança com `externalReference = id da fatura`; antes de criar, procura por essa referência, então rodar de novo não duplica. Fatura já vencida é cobrada com vencimento de hoje (o Asaas não aceita data passada); a fatura no sistema não muda. Não cobra de novo o que está vencido há mais de 30 dias.
- Webhook: autenticado pelo token, evento gravado uma vez (idempotente pelo id do evento do Asaas). `PAYMENT_RECEIVED` dá baixa; no cartão, `PAYMENT_CONFIRMED` também. Estorno e chargeback desfazem a baixa. Vencida, apagada e captura recusada só anotam o status. Cobrança desconhecida é ignorada.
- Inadimplência: `saas_inadimplencia_rodar` suspende (`situacao = suspenso`, `suspenso_automaticamente`) quem tem fatura vencida além da tolerância (`_saas_tolerancia_dias`, 10) e reativa quem quitou; suspensão manual da equipe nunca é desfeita pela rotina. Cada baixa ou estorno reavalia aquele cliente na hora.
- Empresa: `assinatura_situacao()` alimenta o aviso de atraso e a tela de bloqueio (`AssinaturaGate`). Administrador e gestor veem os links de pagamento; os demais são orientados a falar com o administrador; equipe EZRA, contador e empresa sem cobrança automática não veem nada. Erro de rede ou função ausente nunca bloqueia.

## Limites e cuidados
- O bloqueio é da tela. A proteção real dos dados continua sendo o login e o isolamento por empresa no banco; quem chamar a API direto não é barrado pela suspensão. Se isso for requisito, o próximo passo é uma trava no banco (função chamada pelas políticas), com custo de desempenho a medir.
- A tela `/planos` da empresa lê a assinatura real (`assinatura_resumo()`, migração 20270125: saas_clientes, saas_planos e saas_faturas) e é só leitura: não altera plano, não registra pagamento nem lança implantação (mudança de plano vira chamado em `/chamados`; cobrança e baixa são da equipe e do gateway). As tabelas antigas `assinaturas` e `assinatura_faturas` ficaram no banco sem uso, mas a empresa ainda tem permissão de gravar nelas; o próximo passo seguro é revogar essa escrita (e depois apagá-las), conferindo antes que nada mais as usa.
- Teste em sandbox antes: crie um cliente de teste com CPF/CNPJ válido, ligue a cobrança automática, rode a rotina, pague a cobrança no sandbox e confira a baixa e a reativação.
- Fatura com valor cobrado diferente do valor da fatura (juros e multa do Asaas) quita a fatura pelo valor dela; o excedente não é registrado.
