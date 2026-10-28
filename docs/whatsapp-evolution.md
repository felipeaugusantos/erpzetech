# WhatsApp automático (Evolution API autohospedado)

O lava rápido pode enviar os avisos (veículo pronto, plano vencendo) pelo próprio sistema. A Ze Tech mantém **um servidor
[Evolution API](https://github.com/EvolutionAPI/evolution-api)** e cada loja conecta o seu número lendo um QR code, em
**Lava rápido › WhatsApp automático**. Uma instância por empresa (`zt-<16 primeiros dígitos do id da empresa>`).

> **Aviso importante.** O Evolution usa o protocolo do WhatsApp Web, que **não é oficial**. Isso viola os termos do WhatsApp e o
> número pode ser restringido ou banido, e atualizações do WhatsApp podem quebrar o envio sem aviso. Por isso:
> use um **número só da loja** (nunca o principal), envie só avisos de serviço que o cliente espera, mantenha o ritmo baixo
> (o sistema já espera entre mensagens e só envia das 8h às 20h) e comece por uma loja piloto. A saída é a API oficial (Meta):
> o sistema foi montado com um adaptador (`src/lib/whatsapp-evolution.ts`) para trocar o provedor depois.

## Como funciona

1. A recepção clica em **Enviar pelo sistema** (ou o envio automático enfileira sozinho) → linha em `wa_mensagens` (uma por ocasião).
2. A rotina `POST /api/public/hooks/whatsapp-despachar` (a cada minuto) reserva o que está na hora, monta o texto
   (modelo da loja + “responda SAIR”) e chama o Evolution. Até 2 mensagens por loja por rodada, com pausa e “digitando…” entre elas.
   Falha de rede tenta de novo em 2, 10 e 30 minutos; erro do número (ex.: não existe no WhatsApp) fica como falha.
3. O Evolution avisa o sistema em `POST /api/public/whatsapp/eventos?t=<senha>`: conexão caiu/voltou, entregue/lida e respostas.
   Resposta **SAIR/PARAR/STOP…** descadastra o cliente (`clientes.aceita_mensagens = false`) e cancela o que estava na fila.
4. Mensagem enviada registra o contato do lava rápido, então o cliente sai da lista de Avisos.

## Servidor Evolution (exemplo com Docker)

Em uma VPS com HTTPS (Caddy/Nginx/Traefik na frente). Confira os nomes das variáveis na documentação da **versão** que for usar
(<https://doc.evolution-api.com>): eles mudam entre as versões 2.x.

```yaml
# docker-compose.yml
services:
  evolution:
    image: atendai/evolution-api:v2.3.0 # fixe a versão; atualize com teste
    restart: always
    ports: ["127.0.0.1:8080:8080"]
    environment:
      SERVER_URL: https://whatsapp.suaempresa.com.br
      AUTHENTICATION_API_KEY: "<chave longa e aleatória>" # vira EVOLUTION_API_KEY no sistema
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:<senha>@postgres:5432/evolution
      DATABASE_SAVE_DATA_INSTANCE: "true"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis:6379/0
    depends_on: [postgres, redis]
    volumes: [evolution_instances:/evolution/instances]
  postgres:
    image: postgres:16
    restart: always
    environment: { POSTGRES_USER: evolution, POSTGRES_PASSWORD: "<senha>", POSTGRES_DB: evolution }
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    restart: always
volumes: { evolution_instances: {}, pgdata: {} }
```

Segurança do servidor: só HTTPS público; a porta 8080 não fica exposta direto; a chave de API nunca vai ao navegador (o sistema
fala com o Evolution só pelo servidor); faça backup do volume (a sessão do WhatsApp mora nele).

## Variáveis de ambiente do sistema

| Variável                  | Para quê                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `EVOLUTION_API_URL`       | endereço do servidor (ex.: `https://whatsapp.suaempresa.com.br`)                                            |
| `EVOLUTION_API_KEY`       | o mesmo valor de `AUTHENTICATION_API_KEY`                                                                   |
| `WHATSAPP_WEBHOOK_SECRET` | segredo longo (16+ caracteres) que assina os avisos do Evolution; a senha de cada instância é derivada dele |
| `WHATSAPP_APP_URL`        | opcional: endereço público do sistema, se for diferente do que o navegador abre                             |
| `LOVABLE_CRON_SECRET`     | já usado pelas rotinas agendadas (cabeçalho `Authorization: Bearer …`)                                      |

## Rotina de envio

Agende uma chamada **a cada minuto**:

```bash
curl -X POST https://<app>/api/public/hooks/whatsapp-despachar -H "Authorization: Bearer $LOVABLE_CRON_SECRET"
```

Resposta: `{"enfileiradas":0,"enviadas":1,"repetir":0,"falhas":0}`. Sem a rotina rodando, nada é enviado e a fila só cresce.

## Conferir antes de usar com clientes

O adaptador foi escrito de forma tolerante, mas **os formatos do Evolution não foram testados contra um servidor real**.
Com uma instância de teste e o seu número, confira:

- [ ] Conectar gera o QR code e, depois de lido, a tela mostra “Conectado” e o número.
- [ ] **Enviar pelo sistema** de um aviso para o seu número chega, com o rodapé de SAIR.
- [ ] A mensagem passa para Entregue/Lida na lista.
- [ ] Responder **SAIR** do celular descadastra o cliente e a tela deixa de oferecer o envio.
- [ ] Derrubar a conexão pelo celular (Aparelhos conectados) volta a tela para “Desconectado” e desliga o automático.
- [ ] Mensagem para número que não tem WhatsApp fica como **Falhou**, sem repetir.

Se algum item falhar, o ajuste é em `src/lib/whatsapp-evolution.ts` (endereços e formatos), com teste em `tests/whatsapp.test.ts`.
