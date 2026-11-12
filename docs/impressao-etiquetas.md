# Impressão de etiquetas (Zebra, Argox e laser)

## Fase 1 (feita): driver do sistema, sem programa extra

- `src/lib/etiqueta.ts`: modelos de etiqueta (térmica 40×25, 50×30, 60×40, 100×50 e folhas A4 3×10, 2×7, 3×7) e `htmlEtiquetas`, que gera a página de impressão. É só HTML: o mesmo caminho do `abrirImpressao` das demais telas.
- Térmica (Zebra, Argox ou qualquer outra com driver): uma etiqueta por página, com `@page` no tamanho do rolo. O papel do driver precisa estar com o mesmo tamanho, escala 100% e sem margens.
- Folha A4 (laser/jato): grade com as medidas do modelo e opção de **pular posições** já usadas da primeira folha. As medidas seguem o padrão das folhas comerciais; confira com a folha real antes de imprimir um lote.
- `src/lib/ean13.ts`: EAN-13 próprio (sem biblioteca), validado pelo dígito. Código que não for EAN-13 válido sai em Code 128 (`code128.ts`).
- Tela: botão de etiqueta em Produtos (`EtiquetaProdutoDialog`), até 500 vias por vez; lembra o último modelo no navegador. Usa o código de barras do produto e, sem ele, o código interno.
- Limite desta fase: o código de barras sai como imagem vetorial (SVG), não como o gerador nativo da impressora.

## Fases seguintes (a decidir)

2. Mais origens: etiqueta de validade/lote, balança/granel, pet shop (animal, hotelaria), impressão em lote a partir de compras e estoque.
3. Modelos próprios por empresa (tamanho e campos), guardados como configuração.
4. Impressão crua: ZPL (Zebra), TSPL e PPLA (Argox), pelo QZ Tray ou agente local. Depende de saber os modelos de impressora dos clientes e se aceitam instalar um programa.
