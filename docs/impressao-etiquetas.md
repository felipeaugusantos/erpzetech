# Impressão de etiquetas (Zebra, Argox e laser)

## Fase 1 (feita): driver do sistema, sem programa extra

- `src/lib/etiqueta.ts`: modelos de etiqueta (térmica 40×25, 50×30, 60×40, 100×50 e folhas A4 3×10, 2×7, 3×7) e `htmlEtiquetas`, que gera a página de impressão. É só HTML: o mesmo caminho do `abrirImpressao` das demais telas.
- Térmica (Zebra, Argox ou qualquer outra com driver): uma etiqueta por página, com `@page` no tamanho do rolo. O papel do driver precisa estar com o mesmo tamanho, escala 100% e sem margens.
- Folha A4 (laser/jato): grade com as medidas do modelo e opção de **pular posições** já usadas da primeira folha. As medidas seguem o padrão das folhas comerciais; confira com a folha real antes de imprimir um lote.
- `src/lib/ean13.ts`: EAN-13 próprio (sem biblioteca), validado pelo dígito. Código que não for EAN-13 válido sai em Code 128 (`code128.ts`).
- Tela: botão de etiqueta em Produtos (`EtiquetaProdutoDialog`), até 500 vias por vez; lembra o último modelo no navegador. Usa o código de barras do produto e, sem ele, o código interno.
- Limite desta fase: o código de barras sai como imagem vetorial (SVG), não como o gerador nativo da impressora.

## Fase 2 (feita em parte): vários itens, lote e validade

- O diálogo de impressão aceita vários itens, cada um com a sua quantidade (0 a 500; zero tira o item da impressão).
- `etiquetaDoProduto` monta a etiqueta a partir do cadastro (descrição resumida, código de barras ou interno, preço, unidade de venda) e `dataEtiqueta` formata a validade em dia/mês/ano.
- Pontos de entrada: **Produtos** (um produto), **Lotes** (um lote, com lote e validade na etiqueta, quantidade inicial igual ao saldo) e **Compras** (botão "Etiquetas do recebido", uma linha por item já recebido, quantidade igual à recebida na unidade de estoque).
- Ficou para depois: balança/granel (preço por peso e peso na etiqueta) e pet shop (identificação do animal e hotelaria). Dependem de definir quais dados entram na etiqueta; não foram inventados.

## Fase 4 (feita em parte): comandos diretos da impressora

- `src/lib/etiqueta-raw.ts` gera **ZPL** (Zebra; Argox em modo PPLZ) e **TSPL** (Argox e TSC novas) a partir dos mesmos dados e opções da etiqueta. Só etiqueta térmica; a folha A4 continua pelo driver.
- O código de barras sai pelo gerador da própria impressora (`^BE`/`^BC` no ZPL, `BARCODE "EAN13"`/`"128"` no TSPL), com o módulo escolhido para caber na etiqueta. Quantidade de vias por `^PQ` / `PRINT`.
- Resolução 203 ou 300 dpi, escolhida na tela. Texto em UTF-8 no ZPL (`^CI28`) e Windows-1252 no TSPL (`CODEPAGE 1252`); caracteres de comando são removidos do texto.
- Entrega: o diálogo baixa `etiquetas.zpl` ou `etiquetas.prn`. Com a impressora compartilhada no Windows, `copy /b etiquetas.zpl \\localhost\NOME` manda o arquivo direto. Fica a escolha de "Como imprimir" lembrada no navegador.
- **Não foi testado em impressora real.** Os testes conferem a estrutura dos comandos e que o código cabe na etiqueta; posições de texto, fontes (a fonte 0 do ZPL e as fontes 3 e 4 do TSPL) e o espaço entre etiquetas (`GAP 2 mm`) precisam de uma conferência com o rolo, e o ajuste é por modelo.
- Ficou fora: PPLA/PPLB (Argox antigas) e EPL (Zebra antigas), por não haver como conferir o formato sem a documentação e a impressora; e o envio automático (QZ Tray ou agente), que exige instalar um programa em cada computador.

## Fase 5 (feita em parte): envio direto pelo QZ Tray

- `src/lib/etiqueta-qz.ts` fala com o QZ Tray (programa instalado e aberto no computador do caixa, qz.io) por WebSocket local e manda os mesmos bytes ZPL/TSPL da fase 4 como comando cru em base64, sem passar pelo driver gráfico. Nada vai a servidor: o navegador conversa direto com o programa local.
- No diálogo, em ZPL ou TSPL, aparece **Entrega**: "Baixar arquivo" ou "Enviar direto (QZ Tray)". O botão "Buscar" lista as impressoras do computador; a escolhida fica lembrada no navegador.
- A biblioteca (`qz-tray` 2.3.0, licença **LGPL-2.1**) só é carregada quando alguém usa o envio direto. Está no `package.json`, `package-lock.json` e `bun.lock`. Vale o aval de quem decide sobre licenças antes de publicar.
- **Sem assinatura:** o envio vai sem certificado, então o QZ Tray trata o site como não confiável e pede autorização. Para o caixa não ver o aviso a cada impressão é preciso um certificado do QZ Tray assinando as requisições (`qz.security.setCertificatePromise` e `setSignaturePromise`), com a chave privada fora do navegador. Isso não foi feito.
- **Não foi testado com o QZ Tray nem com impressora reais.** Os testes usam um cliente falso e conferem a conexão, o envio em base64 dos bytes certos e as mensagens de erro.

## Fase 6 (feita em parte): assinatura das requisições do QZ Tray

Sem assinatura o QZ Tray pede autorização a cada uso. Com ela, o sistema se identifica por um certificado e o aviso some nos computadores que confiam nesse certificado.

- Servidor: `src/lib/etiqueta-qz.functions.ts` entrega o certificado (público) e assina requisições com a chave privada (RSA-SHA512). As duas ficam só em variáveis de ambiente do servidor, **nunca no navegador**: `QZ_CERTIFICADO` e `QZ_CHAVE_PRIVADA` (PEM; pode vir com `\n` escrito). Sem elas, tudo segue como na fase 5 (sem assinatura).
- Só usuário autenticado (e nunca contador) assina, e o servidor **só assina o que o sistema pede**: listar impressoras e imprimir comando cru (`type: raw`, `format: command`, `flavor: base64` ou `plain`), com a mensagem de até 2 MB e a data dentro de 15 minutos do relógio do servidor. Arquivo, imagem, PDF, USB e outras chamadas são recusados (`src/lib/etiqueta-qz-assinatura.ts`), para a chave não virar um "assine qualquer coisa".
- Navegador: `configurarAssinaturaQz` liga a assinatura (SHA512) antes de conectar, uma vez por página, e só se o servidor devolver o certificado.

### Como ativar

1. Gere o par de chaves num computador seguro (a chave privada não vai para o repositório):

```bash
openssl req -x509 -newkey rsa:2048 -sha512 -nodes -days 3650 -subj "/CN=ERP Ze Tech" -keyout qz-chave.pem -out qz-certificado.pem
```

2. Cadastre o conteúdo de `qz-certificado.pem` em `QZ_CERTIFICADO` e o de `qz-chave.pem` em `QZ_CHAVE_PRIVADA` nos segredos do servidor.
3. Em cada computador com QZ Tray, o QZ precisa **confiar nesse certificado**. Um certificado próprio (como o acima) não é conhecido pelo QZ: segundo a documentação dele, instala-se o `qz-certificado.pem` no QZ Tray de cada máquina (opção de certificado de autenticação própria, `authcert.override`) ou compra-se um certificado reconhecido pela QZ Industries. **Confira o passo atual na documentação do QZ Tray**, que não foi testada aqui.

### Limites

- Quem chega a usar a conta de um usuário do sistema consegue assinar impressão de etiqueta nas máquinas que confiam no certificado. O risco fica restrito a imprimir comando cru em impressoras, mas é uma razão a mais para não compartilhar login.
- A chave é única do sistema (não por empresa). Se vazar, gere outra e atualize o certificado em cada QZ Tray.
- Não foi testado com o QZ Tray real; os testes conferem as regras de assinatura, a ligação no cliente e que a assinatura RSA-SHA512 confere com a chave pública.

## Fases seguintes (a decidir)

3. Modelos próprios por empresa (tamanho e campos), guardados como configuração.
