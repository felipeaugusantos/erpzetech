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

## Fases seguintes (a decidir)

3. Modelos próprios por empresa (tamanho e campos), guardados como configuração.
4. Envio automático à impressora (QZ Tray ou agente local), sem baixar arquivo.
