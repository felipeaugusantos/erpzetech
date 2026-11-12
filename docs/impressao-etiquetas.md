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

## Fase 3 (feita): modelos próprios por empresa

- Tela **Modelos de etiqueta** (Administração, só administrador e gestor): cria, edita, duplica e exclui modelos. Cada modelo tem nome, tipo (térmica ou folha A4), largura e altura, e para folha colunas, linhas, margens e espaços (a grade precisa caber na A4). Até 30 modelos por empresa; nome único.
- Campos: descrição, validade e lote, preço e código de barras. Cada um liga ou desliga, muda de posição (sobe e desce) e, menos o código de barras, tem tamanho de letra pequeno, médio ou grande. Há prévia com dados de exemplo.
- Os modelos aparecem no diálogo de impressão, em "Modelos da empresa", e valem nos três formatos (driver, ZPL e TSPL). Modelo excluído: quem o tinha escolhido volta ao padrão.
- Nos formatos de impressora, se o conteúdo não cabe, o gerador encolhe as letras em até dois passos; se ainda não couber, o diálogo avisa antes de imprimir (tirar campo, desligar preço ou usar etiqueta maior).
- Banco: migração `drizzle/migrations/0088_etiqueta_modelos.sql` (tabela sem acesso direto, só por `etiqueta_modelos_listar`, `etiqueta_modelo_salvar` e `etiqueta_modelo_excluir`; leitura para a empresa, gravação só da administração; trava do salão e do contador). O banco confere formato, medidas e tamanho; o app valida em detalhe (`src/lib/etiqueta-modelo.ts`). Teste: `supabase/ci/etiqueta-modelos.sql`. A tabela entrou no catálogo do backup por cliente.
- **A migração 0088 precisa ser aplicada** para a tela funcionar; sem ela a lista de modelos da empresa fica vazia e a tela de edição mostra o aviso.
- Limite: a prévia é o desenho do driver; as impressoras ZPL/TSPL usam as fontes delas. Ficou fora o posicionamento livre (arrastar) e o logotipo.

## Fase 7 (feita em parte): balança e granel

Etiqueta de pesagem para produto vendido por kg, e o caixa que lê essa etiqueta.

- **Código de balança** (`src/lib/balanca.ts`): EAN-13 que começa com `2`, seguido do código interno do produto (6 dígitos), do **peso em gramas** (5 dígitos, de 1 g a 99,999 kg) e do dígito verificador. O código guarda o peso, não o valor: o caixa calcula pelo preço do kg do cadastro, então etiqueta antiga não fica com valor errado quando o preço muda. Só vale para produto vendido por kg (`unidade_venda`, ou `unidade` se não houver) cujo código interno tem só números, de 1 a 6 dígitos.
- **Etiqueta**: novo campo **"Peso e preço do kg"** (`0,850 kg × R$ 39,90/kg`) nos três formatos, e o modelo pronto **Térmica 60 × 40 mm — pesável**. Os modelos próprios passam a aceitar até 5 campos (migração `0089_etiqueta_modelos_peso.sql`, com teste em `supabase/ci/etiqueta-modelos.sql`).
- **Impressão**: no botão de etiqueta de **Produtos**, produto por kg pede o **peso de cada etiqueta** (em kg, ex.: 0,850) e a validade (opcional); o valor é peso × preço do kg em centavos inteiros (mesma conta da pesagem do restaurante) e o diálogo sugere o modelo pesável. Produto sem preço por kg, ou com código interno que não cabe, é recusado com a explicação.
- **Caixa** (`frente-caixa`): quando o texto lido não é código de barras nem código interno de nenhum produto, o sistema tenta ler como etiqueta de balança e lança o produto por kg com o peso lido. Etiquetas lidas duas vezes somam o peso na mesma linha. O que já funcionava (códigos de barras e códigos internos exatos, busca por nome) não muda.
- **Peso digitado**: não há leitura direta da balança. O peso é digitado na hora de imprimir (a balança que "digita como teclado" cai no mesmo campo).
- **Limites**: o PDV antigo (`pdv.tsx`) e os pedidos não leem a etiqueta de balança; só a frente de caixa. Etiqueta de balança de outro fabricante (com valor no código, ou código de outro tamanho) não é lida: o formato é o descrito acima. Dois produtos cujos códigos internos viram o mesmo número de 6 dígitos (`123` e `000123`) deixam a leitura ambígua e ela é recusada. Granel de outras formas (abrir o saco, custo por kg) segue na tela de Granel, sem mudança.

## Fase 8 (feita): etiqueta do pet shop — ficha de identificação do animal

Ficha para gaiola, coleira ou pertences, com o mínimo de dados à vista.

- **Onde imprimir**: botão **Ficha do animal** dentro da ordem de serviço do pet (`/pet-os`) e botão de etiqueta em cada animal em **Pets e tutores** (`/pets`).
- **O que sai**: número da OS (quando vem de uma), **nome do animal** em destaque, espécie · raça · porte, tutor, serviços da ordem (sem repetição, só serviços, nunca produtos), retirada prevista (hora de Brasília) e **ALERGIA** em destaque. Campo sem dado não ocupa espaço.
- **Privacidade**: o tutor sai só com o primeiro nome e a inicial do sobrenome (`Maria S.`); o **telefone fica desligado** e só aparece se a pessoa ligar a opção no diálogo (a ficha fica à vista de quem passa). Observações e histórico clínico nunca saem. A alergia sai por ser aviso de segurança para quem manuseia o animal.
- **Modelos prontos**: térmica 60 × 40 mm, térmica 100 × 50 mm (com serviços) e folha A4 2 × 7 (99,1 × 38,1 mm). No diálogo, a ficha do animal só mostra esses modelos (e os modelos de produto não aparecem nela); a escolha fica lembrada à parte da etiqueta de produto. Os modelos próprios da empresa continuam só de produto: o editor e o banco não aceitam campos de pet.
- **Formatos**: HTML (driver), ZPL e TSPL, com o mesmo aviso de "não cabe" e o encolhimento de letras. O HTML foi medido no Chromium com os dados mais cheios (nome longo, raça longa, alergia de duas linhas, quatro serviços): sem estouro em nenhum dos três modelos.
- **Sem código de barras**: a ficha não leva código de barras ou QR, porque nada no sistema lê. Se for útil (conferir a retirada pela OS), vira uma fase própria.
- **Não testado** em impressora real nem com o diálogo aberto em navegador (o teste de renderização do projeto não cobre diálogos); a lógica e os três formatos têm testes.

## Fase 9 (feita em parte): leitura da balança pela porta serial

Na etiqueta de pesagem, o botão da balança ao lado do campo de peso lê o peso do cabo, em vez de digitar.

- **Como funciona**: usa a Web Serial do navegador (`src/lib/balanca-serial-porta.ts`). Só no **Chrome e no Edge para computador**, em página segura (https ou localhost); Firefox e Safari não têm. A pessoa escolhe a porta num clique (o navegador pede autorização); se houver uma única porta já autorizada nesta máquina, ela é usada direto. "Escolher outra porta" troca.
- **Peso parado**: o peso só vale depois de N leituras iguais seguidas (padrão 3, de 2 a 10). Enquanto oscila aparece "Variando"; o botão **Usar este peso** só liga quando para. O peso preenche o campo em kg (`0,850`), que continua editável e passa pela mesma validação do digitado (1 g a 30 kg).
- **Formato configurável**, porque cada fabricante manda de um jeito: velocidade (1200 a 115200, padrão 9600; 8 bits e 1 de parada fixos), paridade, **número com vírgula ou ponto** (`1,250`) ou **só dígitos com casas decimais implícitas** (`001250`), unidade (kg ou g) e se a balança envia sozinha ou precisa ser **pedida com ENQ** (0x05, a cada 400 ms). Os quadros terminam em CR, LF, STX ou ETX. A configuração fica no navegador do computador.
- **Tela de teste**: o diálogo mostra o que a balança manda, com os caracteres de controle visíveis (`<STX>001250<ETX>`), o peso achado e se está parado. É assim que se ajusta o formato na instalação.
- **Cuidados**: peso zero, negativo (tara) ou acima de 30 kg é ignorado; cabo solto ou balança desligada avisa uma vez e solta a porta; fechar o diálogo ou sair da tela solta a porta.
- **Não foi testado com balança nem com porta serial real.** Os testes usam uma porta de mentira (fluxos de bytes) e cobrem os quadros, o formato, a estabilidade, o ENQ, a escolha da porta e as falhas; um teste achou e eu corrigi um impasse ao fechar depois de cabo solto. **Não se afirma compatibilidade com marca ou modelo** (Toledo, Filizola, Urano etc.): não conferi os protocolos de cada um. Balança que mande o peso de outro jeito (por exemplo com bytes de status misturados nos dígitos) pode não ser lida até o formato ser ampliado, com um exemplo real do que ela manda.
- Ficou fora: leitura contínua no caixa, aceitar o formato com valor no código de barras e conversor serial por rede (balança em IP).

## Fases seguintes (a decidir)

10. Etiqueta de hotelaria pet (a tela de hotelaria atual é de hospedagem geral; precisa definir o que identifica o animal hospedado).
11. Ajustar o leitor da balança a partir de exemplos reais do que cada modelo envia.
