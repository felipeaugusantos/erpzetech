# Evolution API na VPS (WhatsApp do EZRA)

Guia para subir o servidor **Evolution API v2** (WhatsApp não oficial, via Baileys) na mesma VPS do EZRA, em Docker, sem
tocar nos outros sistemas. Os arquivos ficam em `docs/evolution-vps/`.

**Estado:** o arquivo `docker-compose.yml` foi validado com `docker compose config` e baseado no compose oficial do
projeto. **Não foi executado numa VPS.** Eu (o assistente) não tenho acesso à VPS: você roda os comandos.

## Antes de começar: decisões e riscos seus

- **WhatsApp não oficial.** O Evolution/Baileys não é a API oficial da Meta. O número pode ser **banido** por envio
  automático. Use um **chip de teste dedicado** e só depois decida sobre número de produção.
- **Privacidade.** A pasta de sessões (`evolution_instances`) guarda as credenciais do WhatsApp conectado: é segredo.
  O Evolution grava mensagens no próprio Postgres; este guia desliga contatos, chats, etiquetas e histórico.
- **Custo/manutenção.** Roda na VPS que você já paga, mas é mais um serviço para atualizar e monitorar.
- **Memória.** O compose limita a API a 1,5 GB, o Redis a 256 MB e o Postgres a 512 MB, para não competir com o `zeregistra`.

## 1. Conferir a VPS (somente leitura)

```bash
docker ps --format '{{.Names}}\t{{.Ports}}'
ss -tlnp | grep -E ':(8085)\b' || echo "porta 8085 livre"
free -h
```

Se a 8085 estiver ocupada, troque `127.0.0.1:8085:8080` no compose e `SERVER_URL` no `.env` (mesma porta nos dois).

## 2. Copiar os arquivos

Como root:

```bash
mkdir -p /opt/ezra-evolution && cd /opt/ezra-evolution
cp /home/ezra/app/docs/evolution-vps/docker-compose.yml .
cp /home/ezra/app/docs/evolution-vps/.env.example .env
chmod 600 .env
```

(Se o `app` ainda não tem esses arquivos, rode antes `su - ezra -c "cd ~/app && git pull origin main"`.)

## 3. Gerar as senhas (sem mostrá-las na tela)

```bash
cd /opt/ezra-evolution
SENHA_DB=$(openssl rand -hex 24); CHAVE=$(openssl rand -hex 24)
sed -i "s/TROQUE_SENHA_DB/$SENHA_DB/g; s/TROQUE_CHAVE_API/$CHAVE/" .env
unset SENHA_DB CHAVE
grep -c TROQUE .env
```

O último comando deve mostrar `0`. **Não use a chave de exemplo da documentação do Evolution**: ela é pública.

## 4. Subir

```bash
cd /opt/ezra-evolution
docker compose up -d
docker compose ps
```

Esperado: `api`, `evolution-redis` e `evolution-postgres` em `running` (os dois últimos `healthy`). Se algo falhar:

```bash
docker compose logs --tail 50 api
```

## 5. Conferir

```bash
ss -tlnp | grep 8085
```

Deve mostrar `127.0.0.1:8085` (e **não** `0.0.0.0`): a API não fica exposta na internet.

```bash
curl -sS http://127.0.0.1:8085/ | head -c 300; echo
curl -sS http://127.0.0.1:8085/instance/fetchInstances -H "apikey: $(grep '^AUTHENTICATION_API_KEY=' /opt/ezra-evolution/.env | cut -d= -f2)"; echo
```

O primeiro mostra o JSON de boas-vindas com a versão. O segundo deve devolver `[]` (nenhuma instância). Sem a chave certa,
o Evolution responde `401`.

## 6. Ligar ao EZRA (só no app da VPS)

Sem mostrar a chave, acrescente ao `app.env` (como root):

```bash
echo "EVOLUTION_API_URL=http://127.0.0.1:8085" >> /home/ezra/app.env
echo "EVOLUTION_API_KEY=$(grep '^AUTHENTICATION_API_KEY=' /opt/ezra-evolution/.env | cut -d= -f2)" >> /home/ezra/app.env
```

As demais variáveis (`WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_APP_URL`, `LOVABLE_CRON_SECRET` da VPS) e o teste
seguem o **roteiro** em `docs/whatsapp-roteiro-teste.md`. Só reinicie o EZRA (`systemctl restart ezra`) quando for
executar a Fase 2 do roteiro. **Não coloque variáveis do Evolution no Lovable.**

O Evolution avisa o EZRA (conexão, entrega, SAIR) chamando `https://ezraerp.zeregistra.com.br/api/public/whatsapp/eventos`,
então esse endereço precisa estar no ar (já está).

## 7. Travar a versão

O compose usa `:latest` para o primeiro teste. Depois que funcionar, veja a versão e fixe a imagem para as atualizações
não mudarem o comportamento sem você saber:

```bash
curl -sS http://127.0.0.1:8085/ | grep -o '"version":"[^"]*"'
```

Troque `evoapicloud/evolution-api:latest` pelo número da versão mostrado e rode `docker compose up -d`. Teste o EZRA
depois de cada atualização: o adaptador (`src/lib/whatsapp-evolution.ts`) foi escrito para a família 2.x e tolera
variações, mas isso só se confirma no teste.

## 8. Backup, parar e remover

- **Backup:** `evolution_postgres` e `evolution_instances` (volumes Docker). Perder `evolution_instances` obriga a ler o
  QR code de novo; não perde as mensagens do EZRA (ficam no banco do EZRA).
- **Parar:** `cd /opt/ezra-evolution && docker compose stop`.
- **Remover tudo (apaga sessões e banco do Evolution):** `docker compose down -v`. Só use se tiver certeza.

## O que isto não faz

Não cria agendador, não liga envio automático, não registra número e não abre a API para a internet. A rotina de envio e o
envio a clientes reais continuam sendo decisões e testes à parte.
