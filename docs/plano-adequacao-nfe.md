# Plano de adequação fiscal da NF-e — tarefas priorizadas

Origem: análise do código de emissão (`src/lib/nfe-fiscal.functions.ts`, `src/lib/ibs-cbs.ts`, `src/lib/acbr.server.ts`) contra a NT 2025.002-RTC v1.52 e o Informe Técnico 2025.002 v1.70 (versões vistas em buscas do portal da NF-e; o portal estava fora do ar na consulta direta, confirmar na página oficial).
Não foi feito teste em homologação: tudo abaixo é leitura de código. Itens marcados **[contador]** dependem de validação contábil antes de codificar.
Complementa `docs/reforma-tributaria.md` (fases 1 a 7 de IBS/CBS); aqui entram também as lacunas que não são da reforma.

## P0 — Validar o que já existe (antes de qualquer código novo)
1. **Bateria de homologação por cenário.** Emitir e conferir a validação da SEFAZ para: Simples (CRT 1), regime normal (CRT 3), com e sem ICMS ST, operação interna e interestadual, destinatário PJ e PF. Registrar os resultados em `docs/`.
   - Pronto quando: cada cenário autoriza ou tem rejeição explicada e corrigida.
2. **Confirmar a versão do ACBr** aceita pelo grupo `IBSCBS`/`IBSCBSTot` (já é pendência em `reforma-tributaria.md`) e só então liberar em produção.
3. **Decisão com o contador [contador]:** CRT do Simples em excesso de sublimite (hoje `simples_excesso` vai com CRT 3; a regra pede CRT 2), PIS/COFINS por regime e DIFAL. Define o escopo dos itens P1 e P2.

## P1 — Risco de rejeição ou de nota errada hoje
4. **PIS/COFINS por regime e CST.** Hoje só `PISOutr`/`COFINSOutr` (CST 99 por padrão). Montar o grupo certo (`PISAliq`, `PISNT`, `PISSN` etc.) conforme CST e regime. Depende do item 3.
5. **`indPres` correto.** Está fixo em 1 (presencial). Criar o campo na nota/pedido (presencial, internet, telefone, entrega em domicílio…) e enviar o valor real.
6. **Mapeamento de regime / CRT.** Separar Simples, Simples em excesso de sublimite e normal em vez de só 1 ou 3. Depende do item 3.
7. **DIFAL e FCP.** `vFCP`/`vFCPST` e DIFAL não são enviados. Tratar ao menos venda interestadual a consumidor final não contribuinte, com campos no `ICMSTot` e no item (`ICMSUFDest`). Depende do item 3.
8. **Valor aproximado de tributos (`vTotTrib`, Lei 12.741)** por item e no total.

## P2 — Operação fiscal completa (eventos e finalidades)
9. **Inutilização de numeração** (função de servidor + tela, só administrador/gestor, com justificativa mínima de 15 caracteres e registro em auditoria).
10. **Carta de correção (CC-e).** Evento com texto mínimo de 15 caracteres, sequência de eventos, guarda do XML do evento, bloqueio para o que a CC-e não pode corrigir (valores, destinatário, etc.).
11. **Contingência.** Hoje `tpEmis` é sempre 1. Definir a modalidade (EPEC/SVC) que o ACBr suporta e tratar `dhCont`/`xJust` e o reenvio posterior.
12. **Finalidades `finNFe` 2, 3 e 4** (complementar, ajuste, devolução) com `refNFe`. Devolução primeiro, por ser a mais comum. Une-se à fase 2 da reforma (referência em `DFeReferenciado`).
13. **Manifestação do destinatário** na entrada (ciência, confirmação, desconhecimento, operação não realizada), junto à tela `nfe-entrada`.

## P3 — Reforma Tributária (continuação das fases de `reforma-tributaria.md`)
14. **CSTs de IBS/CBS ainda recusados:** diferimento, suspensão, alíquota fixa, redução de base, monofasia, crédito presumido (`cCredPres`), Zona Franca de Manaus e Áreas de Livre Comércio. Priorizar pelos CSTs que os clientes ativos realmente usam.
15. **NFC-e (modelo 65) e DANFE com os campos de IBS/CBS.**
16. **Notas de crédito/débito (`finNFe` 5/6) e eventos da reforma** (apropriação de crédito, perda em estoque).
17. **Entrada:** ler o grupo IBS/CBS do XML recebido e guardar o crédito; conferir com o pedido de compra.
18. **Simples/MEI** quando a NT definir o grupo (vale a partir de 04/01/2027). Acompanhar a publicação.
19. **`vNFTot` (W60)** e a base de cálculo do IBS/CBS (UB16) quando a SEFAZ ativar a validação.

## Andamento
- Itens 9 e 10 (inutilização e CC-e): feitos, falta validar em homologação (formato do ano da inutilização; sequência da CC-e).
- Item 11 (contingência): feita só a SVC-AN/SVC-RS; EPEC e FS-DA não, porque o emissor não os expõe. Conferir a tabela UF → SVC no MOC vigente.
- Item 12 (finalidades): feita a devolução de venda (nota de entrada, `finNFe` 4, `tpNF` 0, `NFref` com a chave da venda, CFOP 1.202/2.202 ou 1.411/2.411, `DFeReferenciado` por item no regime normal). - Devolução de compra: feita (função `compra_devolucao_registrar`, baixa de estoque, abatimento do contas a pagar, NF-e de saída `finNFe` 4 com CFOP 5.202/6.202 ou 5.411/6.411, referenciando a chave da NF-e de entrada). Sem `DFeReferenciado` por item, porque o `nItem` da NF-e de entrada não é guardado. Faltam a nota complementar (2) e a de ajuste (3).

## Rotina contínua
- Acompanhar a página de Notas Técnicas e o Informe Técnico a cada publicação; abrir tarefa por mudança de layout/schema.
- Cada item novo entra com teste (padrão de `tests/`) e, para tabela nova com RLS ou função chamável por `authenticated`, seguir as regras de migração do `AGENTS.md`.
