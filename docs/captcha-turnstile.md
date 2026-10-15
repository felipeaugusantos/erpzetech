# CAPTCHA do formulário de contato (Cloudflare Turnstile)

O formulário público (`/contato`) confere se quem envia é uma pessoa usando o **Cloudflare Turnstile**: gratuito, quase sempre sem
desafio para o visitante (confere em segundo plano) e sem puzzle de imagens.

## Como funciona

1. A tela mostra o Turnstile e só libera o botão "Enviar contato" depois que ele passa.
2. O envio vai ao servidor da aplicação (`enviarContato`, em `src/lib/contato.functions.ts`), que pergunta à Cloudflare se o
   token vale (`src/lib/captcha.ts`). Se não vale, nada é gravado.
3. O servidor chama a função do banco `contato_enviar` com a chave de serviço, informando o IP de quem enviou. **Só o servidor
   consegue chamá-la**: chamada direta à API com a chave pública deixa de funcionar. O banco ainda confere tamanho, e-mail e WhatsApp,
   limita 5 envios por hora por origem e 100 por hora no total, e descarta o campo escondido preenchido.

## Ligar (uma vez, ~10 minutos)

1. Entre em <https://dash.cloudflare.com> › **Turnstile** › **Add widget** (conta gratuita).
2. Nome: "ERP Ze Tech — contato". Domínios: o endereço do sistema (e o de teste do Lovable, se quiser testar nele).
   Modo: **Managed**.
3. A Cloudflare mostra duas chaves:
   - **Site Key** (pública)
   - **Secret Key** (secreta)
4. Cadastre no projeto (Lovable › configurações do projeto › variáveis de ambiente / segredos):
   - `VITE_TURNSTILE_SITE_KEY` = a Site Key (ela vai para o navegador; precisa de novo *deploy* para valer)
   - `TURNSTILE_SECRET_KEY` = a Secret Key (fica só no servidor; **nunca** coloque no código nem em variável `VITE_`)
5. Faça o *deploy* e abra `/contato`: o selo do Turnstile deve aparecer acima do botão.

## Comportamento sem as chaves

- Sem `VITE_TURNSTILE_SITE_KEY`, a tela não mostra o desafio.
- Sem `TURNSTILE_SECRET_KEY`, o servidor não exige o CAPTCHA.
- Ou seja: **enquanto as chaves não forem cadastradas, o formulário funciona como antes** (com o campo escondido, o tempo mínimo e os
  limites por origem e por hora). Cadastre as **duas** juntas: só a chave do site deixa o botão preso; só o segredo recusa todos os envios.

## Se der problema

- "Confirme que você não é um robô": o desafio ainda não carregou ou expirou; recarregar a página resolve.
- "Não foi possível verificar agora": a Cloudflare não respondeu em 5 s. Com o segredo ligado, o envio é bloqueado (não liberamos
  sem conferir). Tente de novo ou use o WhatsApp.
- Para desligar o CAPTCHA em uma emergência, apague `TURNSTILE_SECRET_KEY` e faça novo *deploy*.
