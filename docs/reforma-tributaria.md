# Reforma Tributária do consumo (IBS, CBS e IS) — plano de adequação

Base: NT 2025.002-RTC v1.52 (setembro/2026) e Informe Técnico 2025.002 v1.70 (tabelas cClassTrib, CST e cCredPres).

## Prazos que valem para o sistema
- **Regime normal (CRT 3):** grupo IBS/CBS obrigatório na NF-e em produção desde 03/08/2026. Em 2026: CBS 0,9% e IBS 0,1% (estadual), municipal 0%.
- **Simples Nacional e MEI:** o grupo só passa a valer em 04/01/2027, com orientação em NT futura. Até lá o sistema **não envia** o grupo para eles.
- 2027–2028: IBS 0,05% estadual + 0,05% municipal; a alíquota da CBS passa a ser a de referência (ainda não publicada).

## Entregue (fase 1)
- `src/lib/ibs-cbs-tabelas.ts` (gerado por `scripts/gerar-tabelas-ibs-cbs.py` a partir das planilhas do Informe Técnico) e `src/lib/ibs-cbs.ts` (alíquotas por ano, exigência por regime, cálculo do item, totais e montagem do grupo `IBSCBS` / `IBSCBSTot`).
- Produto: CST + cClassTrib (migration `20261114000000_ibs_cbs_produto.sql`); em branco vale tributação integral (000 / 000001).
- Emissão da NF-e (`nfe-fiscal.functions.ts`): regime normal informa `IBSCBS` em cada item e `IBSCBSTot` nos totais.
- Combinações calculadas hoje: CST 000, 011, 200 (com redução de alíquota da tabela), 400 e 410. As demais são recusadas com o motivo.

## Próximas fases
1. Tela de simulação (`nfe-simulacao`): feita. Seção "Reforma Tributária: IBS e CBS" com a classificação por item (mesmo seletor do cadastro de produto, só as combinações que a emissão calcula), a conta da emissão (`src/lib/ibs-cbs-simulacao.ts`: base sem ICMS, PIS e COFINS, alíquotas do ano, redução da classificação) e o aviso de que, no Simples e MEI, a NF-e ainda não envia o grupo (estimativa só para planejamento). Nota de serviço não entra (NFS-e segue o município). O pedido (`pedidos.$id`) agora mostra a estimativa (`estimarIbsCbsPedido` e `EstimativaIbsCbs`): só com valores no regime normal, usando a classificação do produto; a base é o valor dos itens (a nota desconta ICMS, PIS e COFINS), e item que a emissão não calcula aparece com o motivo. Falta o orçamento.
2. NFC-e (modelo 65) e NF de devolução (referência em `DFeReferenciado`, VC02-14).
3. Compras: ler o grupo IBS/CBS do XML de entrada e guardar o crédito; conferência com o pedido de compra.
4. DANFE com os campos de IBS/CBS (seção 9 da NT) e relatórios fiscais.
5. CSTs restantes: diferimento (510/515), suspensão (550), alíquota fixa (220/221), redução de base (222), monofasia (620), crédito presumido (cCredPres), ZFM/ALC.
6. Notas de crédito/débito (`finNFe` 5/6) e eventos (apropriação de crédito, perda em estoque etc.).
7. Simples/MEI quando sair a NT.

## Pontos de atenção
- Base de cálculo (UB16): vProd − desconto − PIS − COFINS − ICMS. A SEFAZ ainda não valida a base ("implementação futura, aguardando orientação normativa"); revisar quando sair a orientação.
- `vNFTot` (W60) é opcional por enquanto e não é enviado; entra quando a regra for ativada.
- O emissor (ACBr) precisa estar na versão que aceita o grupo; confirmar em homologação antes de ligar em produção.
- Regime `simples_excesso` agora sai com CRT 2 (e `mei` com CRT 4). A NT 2025.002 v1.40 coloca CRT 1, 2 e 4 no grupo IBS/CBS só em 04/01/2027; até lá o sistema não envia o grupo para eles. Quem em 2027 optar pelo regime regular do IBS/CBS ou ultrapassar o sublimite terá regra própria: acompanhar a NT.
