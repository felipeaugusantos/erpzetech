# WhatsApp no app do Lovable com o Evolution na VPS (plano)

**Status: plano. Nada disto foi executado.** Escolha do usuário: o app do Lovable fala com o Evolution da VPS pela
internet. Motivo: todas as peças do WhatsApp gravam no banco com a chave de serviço (`SUPABASE_SERVICE_ROLE_KEY`), que só o
app do Lovable tem. O app da VPS não consegue (erro "Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY").

```
 celular (chip)  <->  WhatsApp
                          |
                   Evolution (VPS, Docker, 127.0.0.1:8085)
                          |  nginx + HTTPS, só rotas permitidas   (evolution.zeregistra.com.br)
        +-----------------+------------------+
        |  Lovable chama o Evolution         |  Evolution avisa o Lovable (webhook)
        v                                    v
   app publicado no Lovable  (tem a chave de serviço; grava wa_config e wa_mensagens)
```

## O que muda de risco

1. **O Evolution deixa de ser só local.** A chave global dele (`apikey`) cria e apaga instâncias e envia mensagem por
   qualquer número conectado. Vazou a chave = quem tem ela controla os WhatsApps conectados.
2. **Vira um recurso de produção para todas as clínicas.** No código, a tela e as funções só dependem das variáveis de
   ambiente. Ao colocá-las no Lovable, qualquer administrador/gestor de qualquer empresa com módulo de clínica poderá
   clicar em "Conectar WhatsApp" e, se ligar o automático, enviar a clientes reais. Não existe hoje uma lista de
   empresas liberadas para o WhatsApp.
3. **Número pode ser banido** (Evolution não é a API oficial da Meta).
4. **Quem chama a rotina de envio** (`/api/public/hooks/whatsapp-despachar`) não está no repositório. Existe o segredo
   `LOVABLE_CRON_SECRET` no Lovable, mas é preciso confirmar lá **se há um agendador** e a frequência. Sem agendador,
   nada é enviado (nem mensagem manual); com agendador, o envio começa assim que houver empresa conectada.
5. **LGPD e consentimento:** avisos a clientes precisam de base legal/consentimento da clínica. O "responda SAIR" já existe.

## Proteções propostas (ordem de execução)

### A. Trava no código: lista de empresas liberadas (implementada, aguarda publicação)

Nova variável `WHATSAPP_EMPRESAS_LIBERADAS` (lista de ids de empresa separada por vírgula). Se estiver vazia, **ninguém**
conecta. `whatsappConectar` recusa empresa fora da lista, e a rodada de envio só considera empresas da lista. Assim, ligar
o Evolution no Lovable não libera o recurso para as outras clínicas. Com testes de unidade (lista vazia, empresa fora,
empresa dentro). Fica em PR próprio, que você aprova antes.

### B. Expor o Evolution com o mínimo necessário (na VPS)

- DNS: registro **A** `evolution` na zona `zeregistra.com.br` (cPanel/HostGator), apontando para `2.25.79.231`.
- Site novo no nginx, **só as rotas que o EZRA usa**, tudo o mais responde 404 (inclui `/manager`, o painel web do Evolution):

```nginx
# /etc/nginx/conf.d/evolution-limit-req.conf
limit_req_zone $binary_remote_addr zone=evolution_api:10m rate=300r/m;
```

```nginx
# /etc/nginx/snippets/evolution-proxy.conf
proxy_pass http://127.0.0.1:8085;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 30s;
```

```nginx
# /etc/nginx/sites-available/evolution
server {
  listen 80;
  server_name evolution.zeregistra.com.br;
  client_max_body_size 5m;
  limit_req zone=evolution_api burst=60 nodelay;

  location = /instance/create                          { include snippets/evolution-proxy.conf; }
  location = /instance/fetchInstances                  { include snippets/evolution-proxy.conf; }
  location ~ ^/instance/(connect|connectionState|logout|delete)/[^/]+$ { include snippets/evolution-proxy.conf; }
  location ~ ^/message/sendText/[^/]+$                 { include snippets/evolution-proxy.conf; }
  location ~ ^/webhook/set/[^/]+$                      { include snippets/evolution-proxy.conf; }
  location / { return 404; }
}
```

- Depois: `nginx -t`, `systemctl reload nginx`, `certbot --nginx -d evolution.zeregistra.com.br`.
- Teste de negação (de fora da VPS): `/manager` → 404; `/instance/fetchInstances` sem `apikey` → 401.
- O Evolution continua escutando só em `127.0.0.1:8085`; o nginx é a única porta de entrada.
- Limite: não dá para restringir por IP, porque o Lovable não tem IP fixo. A defesa é HTTPS + chave longa + rotas
  permitidas + limite de requisições. Se a chave vazar, gere outra (`openssl rand -hex 24`), troque no `.env` do
  Evolution (`docker compose up -d`) e no Secret do Lovable.

### C. Secrets no Lovable (feito por você, na tela Secrets; nunca no chat)

| Secret                        | Valor                                                                 |
| ----------------------------- | --------------------------------------------------------------------- |
| `EVOLUTION_API_URL`           | `https://evolution.zeregistra.com.br`                                 |
| `EVOLUTION_API_KEY`           | a chave do `/opt/ezra-evolution/.env` (`AUTHENTICATION_API_KEY`)      |
| `WHATSAPP_WEBHOOK_SECRET`     | valor novo, 48 caracteres (`openssl rand -hex 24`), **só no Lovable** |
| `WHATSAPP_APP_URL`            | endereço público do app publicado no Lovable                          |
| `WHATSAPP_EMPRESAS_LIBERADAS` | id da **empresa de teste** (depois do PR A)                           |

No Lovable, mudar um Secret só vale no app publicado **depois de publicar**. Remova do `app.env` da VPS as variáveis
`EVOLUTION_*`, `WHATSAPP_*` e o `LOVABLE_CRON_SECRET` de teste, para os dois apps não disputarem o Evolution.

### D. Agendador (só olhar, não ligar)

No Lovable, descubra se existe um agendador chamando a rotina de envio e com que frequência. Anote. Não crie nem altere
agendador antes do teste. Como a lista de empresas (A) começa só com a de teste, a rodada só toca nela.

### E. Teste (roteiro `docs/whatsapp-roteiro-teste.md`, adaptado)

Empresa de teste, chip dedicado, só mensagem manual, nenhum `auto_*`. A Fase 4 muda: sem o segredo do agendador à mão,
quem dispara a rodada é o agendador do Lovable (por isso o passo D). Conferir no banco em cada passo.

## Ordem sugerida

1. **PR A** (trava por empresa) → mesclar → publicar no Lovable.
2. **B** (DNS + nginx + HTTPS do Evolution) e testes de negação.
3. **D** (olhar o agendador).
4. **C** (Secrets no Lovable) → publicar.
5. **E** (teste com o chip).

## Desfazer

Apagar `EVOLUTION_*`/`WHATSAPP_*` dos Secrets e publicar; remover o site `evolution` do nginx
(`rm /etc/nginx/sites-enabled/evolution && systemctl reload nginx`); `docker compose stop` no Evolution.
