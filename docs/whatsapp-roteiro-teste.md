# Roteiro de teste do WhatsApp (sem clientes reais)

Objetivo: provar, com uma empresa de teste e um número seu, que o WhatsApp conecta, envia **uma** mensagem, recebe os
avisos de entrega e respeita o "SAIR". Nada aqui liga envio automático, agenda rotina nem fala com cliente de verdade.

**Estado do código (lido, não executado):** conexão por QR code, fila, rodada de envio, tentativas, descadastro e avisos
do Evolution existem. Faltam o servidor Evolution e as variáveis; a rotina de envio não está agendada no repositório.
Este roteiro **não foi executado**: cada passo precisa ser conferido por você e o resultado anotado.

## Regras do teste (valem o tempo todo)

- Só empresa de teste, cliente de teste e **seu próprio número** (de preferência um chip separado: WhatsApp pode banir
  número que envia mensagem automática).
- **Nenhum** `auto_*` ligado. Só mensagem manual.
- **Nenhum agendador** novo. A rodada de envio é chamada à mão, uma vez por vez.
- Não copie as chaves do Lovable (`LOVABLE_*`) para a VPS e **não** coloque variáveis do Evolution no Lovable.
- Valores de chaves ficam só no `app.env` da VPS, nunca no chat.

## Fase 0 — Decisões que são suas (eu não faço)

1. **Onde roda o Evolution API.** Opções: na própria VPS (Docker, com banco e Redis próprios, em porta local, sem tocar nos
   containers do `zeregistra`) ou num servidor separado. Isso tem custo de manutenção e precisa de HTTPS se ficar exposto.
2. **Número de teste** (chip dedicado) e o nome da **empresa de teste** (com módulo de clínica liberado).
3. Um **cliente de teste** cujo telefone é o seu, com um pet e uma vacina/retorno de teste.

## Fase 1 — Olhar o banco antes (somente leitura)

No SQL do banco, confira que nenhuma empresa real está "conectada" (a rodada de envio atua em **todas** as conectadas):

```sql
select tenant_id, instancia, estado, numero, auto_pronto, auto_plano, auto_reforco, auto_retorno
from public.wa_config
order by estado, tenant_id;
```

```sql
select situacao, origem, tipo, count(*) from public.wa_mensagens group by 1,2,3 order by 1,2,3;
```

- Esperado: nenhuma linha `conectada` (ou só a sua de teste) e nada em `na_fila` de empresas reais.
- Se houver empresa real conectada ou mensagem real na fila, **pare** e me avise: uma rodada de teste mexeria nelas
  (a rodada também cancela mensagens automáticas de empresas sem envio ligado e enfileira as automáticas das que têm).

## Fase 2 — Variáveis só na VPS

No `/home/ezra/app.env` (como root; permissão `600`), acrescente (valores seus):

```
EVOLUTION_API_URL=...            # endereço do seu Evolution
EVOLUTION_API_KEY=...            # chave dele
WHATSAPP_WEBHOOK_SECRET=...      # gere: openssl rand -hex 24   (mínimo 16 caracteres)
WHATSAPP_APP_URL=https://ezraerp.zeregistra.com.br
LOVABLE_CRON_SECRET=...          # valor inventado por você SÓ para a VPS: openssl rand -hex 24
```

O nome `LOVABLE_CRON_SECRET` é o que o código lê; na VPS ele guarda um segredo seu, sem relação com o do Lovable.
Reinicie: `systemctl restart ezra`.

## Fase 3 — Conectar o número de teste

1. Entre em `https://ezraerp.zeregistra.com.br` com o usuário de teste (administrador/gestor da empresa de teste).
2. Abra a tela **WhatsApp** da clínica e clique em conectar. **Faça isso pelo endereço da VPS**: o aviso de volta
   (webhook) é montado com o endereço de quem pediu, e precisa apontar para a VPS.
3. Leia o QR code com o celular de teste.

Esperado: estado `conectada` e o número aparecendo. Conferir no banco: `wa_config` da empresa de teste com
`estado = 'conectada'` e `auto_*` todos `false`.

## Fase 4 — Uma mensagem manual

1. Na empresa de teste, gere um aviso manual para o cliente de teste (reforço de vacina ou retorno de consulta).
2. No banco, a mensagem deve estar `na_fila` com `origem = 'manual'`.
3. Dispare **uma** rodada à mão, na VPS (troque pelo segredo do passo 2, sem colar aqui):

```bash
curl -sS -X POST https://ezraerp.zeregistra.com.br/api/public/hooks/whatsapp-despachar \
  -H "Authorization: Bearer SEU_SEGREDO_DA_VPS"
```

Esperado: JSON parecido com `{"enfileiradas":0,"enviadas":1,"repetir":0,"falhas":0,"semRegistro":0}`.
No celular chega o texto com o rodapé "Para não receber mais avisos, responda SAIR."
Em alguns segundos a situação vira `enviada`, depois `entregue` e `lida` (avisos do Evolution).

## Fase 5 — Testes de negação (o sistema tem que recusar)

| Teste                                                        | Esperado                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Rodada sem o cabeçalho `Authorization`                       | `401`                                                                                    |
| Rodada com segredo errado                                    | `401`                                                                                    |
| `POST .../api/public/whatsapp/eventos` sem `?t=`             | `401`, nada gravado                                                                      |
| Responder **SAIR** no celular de teste e gerar novo aviso    | a mensagem nova fica `cancelada` ("O cliente não pode mais receber esta mensagem")       |
| Parar o Evolution e disparar uma rodada com um aviso na fila | falha repetível: `repetir = 1`, próxima tentativa em 2 minutos; nunca marca como enviada |
| Desconectar o número                                         | `estado = 'desconectada'` e todos os `auto_*` voltam a `false`                           |

## Fase 6 — Desfazer

1. Desconectar o número na tela e, se quiser, excluir a instância no Evolution.
2. Remover do `app.env` as variáveis do teste (principalmente `LOVABLE_CRON_SECRET` da VPS) e reiniciar o serviço.
3. Conferir de novo `wa_config` (nenhuma `conectada`) e que nenhuma mensagem de empresa real foi tocada.

## Aceite

- Uma mensagem manual enviada, entregue e lida, com o rodapé de SAIR.
- SAIR respeitado; sem autorização, tudo recusado.
- Nenhuma empresa real tocada; nenhum agendador criado.

Fica **fora** deste teste: envio automático, agendamento da rodada (e quem a chama, Lovable ou VPS, sem duplicar),
volume, e uso com clientes reais. Cada um é uma decisão e um teste próprios.
