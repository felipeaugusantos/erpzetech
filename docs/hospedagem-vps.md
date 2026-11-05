# Hospedar o EZRA numa VPS (Ubuntu 24.04)

Guia para rodar o app numa VPS própria (ex.: Hostinger KVM) em vez da hospedagem do Lovable. O banco, o login e o
armazenamento continuam no Supabase; a VPS só serve o site e as funções de servidor.

Este guia foi escrito e o build foi testado só aqui no ambiente de desenvolvimento (o servidor Node sobe e responde `/`,
`/portal/entrar` e `/sw.js`). **Nada foi testado na sua VPS.** Faça primeiro num subdomínio de teste.

## 0. Antes de começar: o que depende do Lovable

Nem tudo muda de lugar sozinho. Confira cada item antes de trocar o endereço principal:

| Item                                           | Onde está no código                                                        | O que acontece fora do Lovable                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login com Google                               | `src/integrations/lovable/index.ts`, `src/routes/auth.tsx`                 | Usa o serviço de login do Lovable. **Não garantido** em outro domínio: teste. Alternativa: ativar o provedor Google direto no Supabase Auth (mudança de código, PR próprio). Login por e-mail e senha não muda. |
| Recursos de IA (DANFE em PDF, frente de caixa) | `LOVABLE_API_KEY` em `danfe-pdf.functions.ts`, `frente-caixa.functions.ts` | Sem a chave, esses recursos falham. A chave é do Lovable; trocar de provedor é decisão e custo seus.                                                                                                            |
| Rotina do WhatsApp (envio a cada minuto)       | `/api/public/hooks/whatsapp-despachar`, segredo `LOVABLE_CRON_SECRET`      | Quem chama a rotina hoje é o agendador do Lovable/Supabase. Na VPS você precisaria de um agendador próprio. **Não ative nada sem confirmar o estado do agendador atual** (risco de envio duplicado a clientes). |
| Domínio e URLs do Auth                         | Supabase → Authentication → URL Configuration                              | Acrescentar o domínio novo (inclusive `/portal`) em Site URL e Redirect URLs.                                                                                                                                   |

## 1. Preparar a VPS (uma vez)

Entre por SSH como root e crie um usuário sem privilégios para rodar o app:

```bash
adduser --disabled-password --gecos "" ezra
```

Instale Node 22, nginx e certbot:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx git
```

Se a VPS já roda outro site, **não substitua** a configuração do nginx: o passo 5 cria um arquivo novo, só para o domínio do EZRA.

## 2. Baixar e compilar

```bash
su - ezra
git clone https://github.com/felipeaugusantos/erpzetech.git app
cd app
npm ci
npm run build:node
```

O resultado fica em `.output/`. Se o build faltar memória, crie um arquivo de troca (swap) de 2 GB.

## 3. Variáveis de ambiente

Crie `/home/ezra/app.env` (fora do repositório, permissão `chmod 600`). Use os valores do painel do Supabase (Project Settings → API); **nunca cole a `service_role` em chat, e-mail ou commit**:

```
HOST=127.0.0.1
PORT=3000
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
# Só se for usar: EVOLUTION_API_URL, EVOLUTION_API_KEY, WHATSAPP_WEBHOOK_SECRET, WHATSAPP_APP_URL,
# COSMOS_TOKEN, LOVABLE_API_KEY, LOVABLE_CRON_SECRET, ERP_ZETECH_API_KEY
```

As variáveis `VITE_*` entram no build (arquivo `.env` do repositório já as traz); as de servidor acima são lidas na hora de rodar.

## 4. Rodar como serviço (systemd)

Como root, crie `/etc/systemd/system/ezra.service`:

```ini
[Unit]
Description=EZRA ERP
After=network.target

[Service]
User=ezra
WorkingDirectory=/home/ezra/app
EnvironmentFile=/home/ezra/app.env
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now ezra
systemctl status ezra
```

## 5. nginx e HTTPS

Aponte o DNS do domínio (registro A) para o IPv4 da VPS. Depois crie `/etc/nginx/sites-available/ezra`
(troque `teste.seudominio.com.br`):

```nginx
server {
  listen 80;
  server_name teste.seudominio.com.br;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25m;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/ezra /etc/nginx/sites-enabled/ezra
nginx -t && systemctl reload nginx
certbot --nginx -d teste.seudominio.com.br
```

## 6. Conferir

- Abra `https://teste.seudominio.com.br/portal/entrar` e a tela de login do app.
- Entre com um usuário de teste e abra uma tela que leia dados.
- No Supabase Auth, confirme que o domínio está em Site URL / Redirect URLs.
- Teste o login do tutor no portal (e-mail e senha).

## 7. Atualizar o app depois

```bash
su - ezra
cd app && git pull origin main && npm ci && npm run build:node
exit
systemctl restart ezra
```

Migrações do banco continuam sendo aplicadas por você no Supabase, antes de publicar o código que depende delas.

## 8. Voltar atrás

Mantenha o Lovable publicado até validar tudo. Para voltar, basta o DNS apontar de novo para ele; a VPS não altera o banco.

## Aparelhos instalados e modo offline

O cofre e a fila offline ficam no navegador de cada aparelho, **por endereço**. Um domínio novo começa vazio:
operações pendentes de um aparelho ficam no endereço antigo. Antes de mudar o endereço principal, sincronize os
aparelhos (fila vazia) e só então troque.
