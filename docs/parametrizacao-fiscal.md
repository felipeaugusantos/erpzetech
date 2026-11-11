# Parametrização fiscal por NCM (base global + sobrescrita da empresa)

**Status: implementado (PR 1 a 8 e ferramentas da carga inicial). Falta a primeira carga de dados na base.** Sem regra publicada, tudo se comporta
como antes. Guia da carga: `docs/carga-fiscal-inicial.md`.

Objetivo: ao cadastrar ou revisar um produto, o sistema **sugere** a tributação (CST/CSOSN, CFOP, alíquota de ICMS, origem) a partir do NCM, da
operação, do regime e da UF da empresa, no estilo de uma base de parametrização fiscal, mas **sem API externa**.

Decisões do produto:

- A base é **global e mantida pela equipe Ze Tech**; a **empresa pode sobrescrever ou ocultar** regras só para si.
- Cobre regime normal, Simples Nacional e MEI, por **NCM, CEST, operação e UF**. A regra de `simples` vale também para empresa **MEI** (mesmo CSOSN); a de `mei` só para MEI e vence a de `simples` quando as duas existem. A consulta usa a UF da empresa como destino (venda dentro do estado).
- É **sugestão**: nunca altera produto, nota ou imposto sozinha, e a validação final é do contador.
- **A emissão da nota não foi alterada.** A nota lê CFOP, CST/CSOSN, alíquota e origem do **produto**, e as funções do banco calculam os valores; a base
  chega à nota pelo produto (tela Fiscal e cadastro de produto), com a pessoa revisando e salvando.

## Princípios

- **Quem não usar a base continua como hoje.** Sem regra cadastrada, nada muda.
- **Nunca preenche em silêncio.** A sugestão mostra a origem (regra global vX ou sobrescrita da empresa) e só vira dado do produto quando a pessoa salva.
- **Só aplica o que a emissão sabe formatar:** CST 00, 40, 41, 50, 51, 60 e CSOSN 101, 102, 103, 300, 400, 500, 900; IBS/CBS só nas combinações calculadas.
- **Regime e código combinam:** Simples e MEI usam CSOSN; regime normal e Simples com excesso de sublimite usam CST (a emissão recusa a mistura).
- **Sem acesso direto às tabelas.** Tudo por funções, como no bulário e no menu personalizado.
- **Regra tem vigência e versão.** Corrigir uma regra cria uma versão nova e encerra a anterior no dia anterior; a antiga continua consultável. Nada é apagado.
- **Mudança em massa é ação explícita:** consultar, ver o resumo, aplicar em rascunho e Salvar. Nunca automática.

## Ordem de precedência (quem vence)

A lógica pura (`src/lib/fiscal-regras.ts`) implementa a ordem completa, campo a campo:

1. Valor digitado no item da nota.
2. Exceção gravada no produto.
3. Sobrescrita da empresa (a regra mais específica vence).
4. Regra global (a mais específica vence).
5. Padrão atual da empresa (`impostos.tsx`).

No app, a base é aplicada **no produto** (nível 2), e é o produto que a nota lê. Qualquer regra da empresa que case vence a global, mesmo menos específica.

### Especificidade

Entre regras do mesmo nível vence a mais específica, nesta ordem de comparação:

1. NCM com mais dígitos (8, depois 6, 4 e 2).
2. Com CEST casando antes de sem CEST.
3. Com operação e regime casando antes de "qualquer" (regime exato vale mais do que `simples` usado no lugar de `mei`).
4. Com UF de destino antes de sem UF.

Só vale regra **vigente na data da operação**. Empate real (mesma especificidade) **não é desempatado em silêncio**: a função devolve a lista e a tela pede a escolha.
Uma regra de UF num NCM mais curto perde para uma regra geral de NCM mais longo; para evitar, cadastre a regra da UF com o mesmo NCM.

## Modelo de dados

Migrações em `supabase/migrations` (versões `20270110` a `20270117`, depois das da adequação fiscal da NF-e). Nenhuma tabela é acessível direto pelo app.

- `fiscal_perfis`: conjunto nomeado de valores (`cst_icms`, `csosn`, `cfop`, `aliq_icms`, `reducao_base_icms`, `mva_st`, `cst_pis`, `aliq_pis`, `cst_cofins`,
  `aliq_cofins`, `cst_ibs_cbs`, `cclasstrib`, `origem`). `tenant_id` nulo = perfil global; preenchido = perfil da empresa. Um perfil não muda de valores depois de criado.
- `fiscal_regras` (global): `perfil_id`, `ncm_prefixo` (2 a 8 dígitos), `cest`, `operacao`, `regime`, `uf_destino`, `vigencia_inicio`, `vigencia_fim`, `versao`, `ativa`, `observacao`, `fonte`, `criado_por`.
- `fiscal_empresa_regras`: o mesmo formato, por empresa (`tenant_id`), com RLS e a política `salao_restrito`.
- `fiscal_empresa_ocultas`: regras globais que a empresa ocultou, com motivo obrigatório.
- **A nota não guarda o id da regra aplicada** (desenho inicial descartado): como a base chega à nota pelo produto, o histórico fica no produto, e as mudanças nele já são auditadas pelo gatilho de auditoria.

## Funções

Todas com a trava do salão (`exige_nao_salao`) onde são chamáveis por `authenticated`.

- **Consulta (qualquer pessoa da empresa, exceto o perfil do salão):** `fiscal_sugerir` (um NCM) e `fiscal_sugerir_lote` (até 300 NCMs, só leitura).
- **Empresa (administrador e gestor):** `fiscal_empresa_perfis`, `fiscal_empresa_minhas`, `fiscal_empresa_globais`, `fiscal_empresa_regra_salvar`, `fiscal_empresa_regra_encerrar`,
  `fiscal_empresa_ocultar`, `fiscal_empresa_reexibir`.
- **Equipe Ze Tech (só `service_role`, chamadas por função de servidor depois de conferir o operador):** `fiscal_base_publicar` (prévia ou publicação, tudo ou nada), `fiscal_base_listar`, `fiscal_base_encerrar`.

## Lógica no app

- `src/lib/fiscal-regras.ts`: lógica pura (precedência, especificidade, vigência, empate), espelhada pelas funções SQL.
- `src/lib/fiscal-importacao.ts`: leitura e validação da planilha de carga (NCM, CEST, operação, regime, UF, datas, perfil, valores).
- `src/lib/ncm.ts` e `src/lib/ncm-tabela.ts`: Tabela NCM oficial vigente (gerada por `scripts/gerar-tabela-ncm.py`); recusa NCM inexistente.
- `src/lib/fiscal-sugestao.ts` e `src/components/app/SugestaoFiscal.tsx`: sugestão no cadastro de produto.
- `src/lib/fiscal-lote.ts`, `src/lib/fiscal-lote-dados.ts` e `src/components/app/SugestaoBaseFiscal.tsx`: painel da tela Fiscal (`/fiscal`).
- `src/lib/fiscal-empresa.ts`, `src/lib/fiscal-empresa-dados.ts`, `src/components/app/RegraFiscalDialog.tsx` e `src/routes/_authenticated/fiscal-regras.tsx`: sobrescrita e ocultação pela empresa.
- `src/lib/fiscal-base.functions.ts` e `src/routes/_authenticated/ze-tech-fiscal.tsx`: carga pela equipe (prévia, publicação, encerrar).

## Testes

- Banco (`supabase/ci/`, ligados em `run.sh`): `fiscal-regras.sql`, `fiscal-base-carga.sql`, `fiscal-empresa.sql` e `fiscal-lote.sql` (papéis, isolamento entre empresas, vigência e versões,
  tudo ou nada, UF, acesso direto recusado, só leitura), além do `smoke.sql` (trava do salão em toda tabela e função).
- Lógica pura (`tests/*.test.ts`) e telas montadas (`tests/*.vitest.tsx`). Nenhuma tela foi aberta num navegador durante o desenvolvimento: faça o teste visual (abaixo).

## Plano em PRs pequenos

1. **PR 1 (feito):** lógica pura `src/lib/fiscal-regras.ts` + `tests/fiscal-regras.test.ts`. Não muda o app: nada a usa ainda.
   Decisões implementadas: a precedência vale **campo a campo** (item, produto, regra, padrão); a regra é escolhida **como um todo**
   e qualquer regra da empresa que case vence a global, mesmo menos específica; empate devolve as candidatas e **não** aplica o padrão;
   NCM sem 8 dígitos não consulta regra nem aplica o padrão; regra inválida nunca casa (`validarRegra` serve para a prévia da importação).
2. **PR 2 (feito):** migração `supabase/migrations/20270110000000_fiscal_regras.sql` + teste `supabase/ci/fiscal-regras.sql` (ligado no `run.sh`). Ninguém usa ainda.
   - Tabelas (sem acesso direto, com `salao_restrito`): `fiscal_perfis` (`tenant_id` nulo = global), `fiscal_regras`, `fiscal_empresa_regras`, `fiscal_empresa_ocultas`.
     Gatilhos: regra global só usa perfil global; sobrescrita da empresa usa perfil global ou da própria empresa; o dono de um perfil não muda.
   - Só a função `fiscal_sugerir(p_ncm, p_cest, p_operacao, p_data, p_uf_destino, p_regime)` está liberada, para qualquer pessoa da empresa exceto o perfil do salão.
     Ela espelha `src/lib/fiscal-regras.ts` e devolve `status`, `regra`, `candidatas` (no empate) e `perfil` (camelCase, sem nulos). A mistura com item, produto
     e padrão da empresa continua no app (PR 4). O regime vem da empresa (`simples` e `mei`; o resto é `normal`, como `crtDoRegime`) ou de `p_regime`.
   - As tabelas só recebem dados por `service_role` por enquanto: as funções de carga (PR 3) e de sobrescrita/ocultação (PR 5) ainda não existem.
3. **PR 3 (feito):** tela da equipe `/ze-tech-fiscal` (menu Ze Tech → Base fiscal (NCM)) para carga por planilha CSV com prévia, publicação e encerramento. **Sem carga inicial**: a base nasce vazia e a planilha-modelo traz só o cabeçalho; as regras entram quando o contador as validar.
   - Migração `supabase/migrations/20270111000000_fiscal_base_carga.sql`: `fiscal_base_publicar` (prévia ou publicação), `fiscal_base_listar` e `fiscal_base_encerrar`,
     todas só de `service_role`; a tela chama por função de servidor (`src/lib/fiscal-base.functions.ts`) depois de conferir que a pessoa é da equipe. Teste de banco `supabase/ci/fiscal-base-carga.sql`.
   - Leitura e validação da planilha no navegador (`src/lib/fiscal-importacao.ts`, com `tests/fiscal-importacao.test.ts`); o banco confere tudo de novo.
   - Regras da carga: **tudo ou nada** (com qualquer erro nada é gravado); a prévia roda o mesmo caminho de código da publicação e desfaz, então nunca diverge; reenviar a mesma planilha não muda nada;
     perfil existente só é reaproveitado se os valores forem idênticos (para mudar a tributação, outro nome de perfil e início posterior); nova versão de uma chave
     (NCM + CEST + operação + regime + UF) encerra a anterior no dia anterior ao início da nova; encerrar só antecipa o fim, nunca estende; uma carga por vez (trava no banco).
   - NCM na planilha só com 2, 4, 6 ou 8 dígitos (quantidade ímpar quase sempre é zero à esquerda perdido pela planilha); CEST de 6 dígitos e CSTs curtos são completados com zeros.
4. **PR 4 (feito):** sugestão no cadastro do produto (`src/components/app/SugestaoFiscal.tsx`, lógica em `src/lib/fiscal-sugestao.ts`).
   - Ao informar os 8 dígitos do NCM, o cadastro chama `fiscal_sugerir` e mostra o selo da origem (regra global ou sobrescrita da empresa), o perfil, a versão e os valores. Nada é aplicado sozinho.
   - **Hoje só a tributação IBS/CBS tem campo no cadastro**, então o botão "Usar sugestão (IBS/CBS)" é a única aplicação; CFOP, CST do ICMS, PIS/COFINS e alíquotas aparecem só para consulta.
     Uma combinação IBS/CBS que a emissão recusaria (`motivoNaoSuportada`) nunca é aplicada e a tela mostra o motivo; tributação integral (000 / 000001) vira o padrão do cadastro (em branco).
   - Empate lista as regras para a pessoa escolher ("Usar esta"); sem regra, NCM incompleto ou falha da consulta só avisam e o cadastro segue normal.
   - A chave da consulta inclui a empresa (as sobrescritas são dela e o cache do navegador é persistido).
   - Migração `supabase/migrations/20270112000000_fiscal_sugerir_nome.sql`: `fiscal_sugerir` passa a devolver `ncmPrefixo` e `perfilNome` na regra escolhida. A tela lê também a resposta antiga.
   - **A emissão ainda não usa a base**: continua com item, produto e padrão da empresa. Decisão para o PR 6: levar CFOP, CEST e origem ao cadastro como exceção do produto (a emissão já lê essas colunas de `produtos`).
5. **PR 5 (feito):** sobrescritas e ocultação pela empresa, em `/fiscal-regras` (menu Administração → Regras fiscais por NCM; só administrador e gestor).
   - Migração `supabase/migrations/20270113000000_fiscal_empresa_funcoes.sql`, todas as funções com a trava do salão e `exige_papel(administrador, gestor)`:
     `fiscal_empresa_perfis`, `fiscal_empresa_minhas`, `fiscal_empresa_globais` (leitura da base com a marca de ocultas), `fiscal_empresa_regra_salvar`, `fiscal_empresa_regra_encerrar`,
     `fiscal_empresa_ocultar` (motivo obrigatório) e `fiscal_empresa_reexibir`. Teste de banco `supabase/ci/fiscal-empresa.sql`.
   - A empresa só vê e altera o que é dela (regras, ocultações e perfis próprios); a base global é só leitura. Perfil de outra empresa nunca vale. Limites: 2000 regras e 200 perfis por empresa.
   - Salvar usa as mesmas regras de versão da carga global: mesma chave (NCM + CEST + operação + regime + UF) com versão vigente gera **nova versão** (a anterior termina no dia anterior); repetir o mesmo conteúdo não muda nada.
     A regra pode usar um perfil existente (da base ou da empresa) ou criar um perfil próprio (nome já existente só vale com os mesmos valores).
   - Encerrar só antecipa o fim e só vale para regra da própria empresa. Ocultar vale só para a empresa e some da sugestão dela; "Voltar a usar" desfaz.
   - Depois de qualquer mudança a sugestão do cadastro de produtos é recarregada (mesma chave por empresa). A tela valida o formulário no navegador com a mesma leitura da planilha de carga (`validarCriteriosFiscais`).
   - Continua valendo: **a emissão ainda não usa a base** (PR 6).
6. **PR 6 (feito, com o desenho mudado):** a base chega à nota **pelo produto**, na tela Fiscal (`/fiscal`), e a emissão não foi tocada.
   - **Por que mudou:** a nota é gerada em funções SQL (`gerar_nfe_agrupada`, `nfe_calcular_impostos`) que leem CFOP, CST/CSOSN, alíquota e origem **do produto** e calculam os valores de imposto; a transmissão só formata
     esses valores já calculados. Trocar CST ou CFOP na transmissão geraria nota inconsistente. Por isso a regra não é aplicada direto na emissão, e a nota **não** guarda o id da regra: o produto carrega o resultado
     e as mudanças nele já são auditadas pelo gatilho de auditoria dos produtos.
   - **O que existe:** painel "Sugestão da base fiscal" na tela Fiscal (`src/components/app/SugestaoBaseFiscal.tsx`, lógica em `src/lib/fiscal-lote.ts`) e a função `fiscal_sugerir_lote` (migração
     `supabase/migrations/20270114000000_fiscal_sugerir_lote.sql`; teste `supabase/ci/fiscal-lote.sql`). Consulta os NCMs (e CEST) dos produtos da lista, até 300 por chamada, pela mesma precedência de `fiscal_sugerir`.
   - **Nada é gravado pela consulta.** "Aplicar na lista" (todos) ou "Usar a sugestão" (um produto) só criam **edições em rascunho**, o mesmo caminho do "Aplicar padrão da loja"; quem grava é o botão Salvar que já existia.
     Dois modos: "só preencher o que falta" (padrão) e "também trocar o que já está preenchido e é diferente".
   - **O que a base aplica no produto:** CFOP, CST do ICMS (regime normal) ou CSOSN (Simples e MEI), alíquota de ICMS e origem. Só entram valores no formato certo **e que a emissão sabe formatar** (`icmsDoItem`: CST 00, 40, 41, 50, 51, 60; CSOSN 101, 102, 103, 300, 400, 500, 900);
     CST 10, 20, 30, 70, 90 e CSOSN 201, 202… viram aviso e não são aplicados. Regra que só traz o código do outro regime também vira aviso.
   - **O que a base define mas não é aplicado aqui:** PIS, COFINS, redução da base e MVA, que a nota calcula pela configuração de Impostos da empresa (não por produto), e IBS/CBS, que se aplica no cadastro do produto (PR 4).
   - **Limites desta versão:** a consulta usa a operação "venda", a data de hoje e nenhuma UF de destino (regras com UF não casam). Recálculo automático quando uma regra muda continua fora: é sempre uma consulta e uma aplicação explícitas.
7. **PR 7 (feito): Tabela NCM oficial como referência.** `scripts/gerar-tabela-ncm.py <Tabela_NCM_Vigente.xlsx>` gera `src/lib/ncm-tabela.ts` com os 10.516 NCMs de 8 dígitos vigentes (tabela de 10/11/2026, Resolução Gecex nº 926/2026), e `src/lib/ncm.ts` consulta (`ncmNaTabela`, aceita 2, 4, 6 ou 8 dígitos).
   - **Onde vale:** a leitura da planilha de carga e o formulário de regra da empresa recusam NCM que não consta na tabela (`validarCriteriosFiscais`); o servidor da carga confere de novo antes de chamar o banco; o cadastro de produto **avisa** (não impede salvar) quando o NCM de 8 dígitos não consta.
   - **Existir na tabela não diz nada sobre a tributação.** Só protege contra dígito trocado ou código inventado.
   - **Manutenção:** a tabela muda por resolução da Gecex. Baixe a planilha nova e rode o script; ele avisa se a tabela tiver mais de 180 dias. A tabela vai num pacote separado (cerca de 21 KB gzip), carregado só quando há NCM completo para conferir.
   - O banco **não** tem a tabela: ele só confere o formato; a conferência de existência é do aplicativo.
8. **Carga inicial (guia, sem código novo no app):** `docs/carga-fiscal-inicial.md` reúne o processo por segmento, os dois prompts (gerar e auditar) e as ferramentas: `docs/sql/ncms-usados-por-ramo.sql`
   (consulta de leitura: NCMs usados por segmento e regime, com o CST/CSOSN e o CFOP mais comuns e a concordância entre empresas; só NCMs de 2 ou mais empresas) e `scripts/ncm-descricoes.py`
   (lista de NCMs com a descrição completa da Tabela NCM, juntando a cadeia hierárquica).
9. **PR 8 (feito): a consulta usa a UF da empresa.** Migração `supabase/migrations/20270115000000_fiscal_sugerir_uf.sql`: `fiscal_sugerir`, sem UF informada, usa a UF da própria empresa como destino da venda
   (venda dentro do estado); a UF informada continua valendo; UF vazia ou que não é sigla de 2 letras é ignorada (só regras sem UF casam, como antes). O retorno ganha `ufDestino` e `fiscal_sugerir_lote` ganha `uf`.
   O cadastro de produto e a tela Fiscal mostram qual UF foi considerada e avisam quando a empresa não tem UF. A consulta `docs/sql/ncms-usados-por-ramo.sql` separa por UF, e o guia da carga manda uma linha por UF para ST.
   Não mudou: a ordem de desempate (NCM, CEST, operação e regime, UF por último) e o CFOP interestadual, que continua não coberto.
10. **Merge com a principal:** a branch recebeu a principal (adequação fiscal da NF-e). As migrações desta entrega foram **renumeradas** (`20270110` a `20270115`; a `20270116` corrige a busca por nome de perfil com dígito) porque as versões
    `20270102` a `20270106` já existiam na principal com outros nomes. Todas são reaplicáveis (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`). A tela Fiscal passou a escolher
    CSOSN ou CST pelo mesmo critério da emissão (`crtDoRegime`): Simples e MEI usam CSOSN; normal e Simples com excesso de sublimite usam CST.

11. **MEI usa as regras de Simples:** migração `supabase/migrations/20270117000000_fiscal_sugerir_mei.sql`. A consulta tratava `mei` como regime à parte, então uma regra de `simples` não chegava às empresas MEI
    (a maioria dos clientes). Agora, para MEI, valem as regras de `mei`, as de `simples` e as sem regime; a de `mei` vence a de `simples`, e a de `simples` vence a sem regime. A pontuação de regime e de operação
    foi multiplicada por 2 (exato 2, `simples` no lugar de `mei` 1, sem regime 0), o que mantém a ordem de desempate das demais empresas. A mesma regra está em `fiscal-regras.ts`.

## Fora do escopo desta entrega

- **IBS/CBS para Simples e MEI** (passa a valer em 04/01/2027): a base carrega esses campos, mas a classificação por produto continua manual até a NT definir o grupo para eles.
- **Venda interestadual** (CFOP 6xxx), **devolução** e outras operações: a consulta usa "venda" e a UF da empresa como destino.
- **NFC-e** e a **frente de caixa**: usam as mesmas colunas do produto, então herdam o que for aplicado, mas não foram tratadas à parte.
- **Aplicação direta na emissão** (a nota resolver a regra sozinha): descartada nesta entrega pelo risco de gerar nota inconsistente com os valores já calculados no banco.
- PIS, COFINS, redução de base e MVA **não são aplicados por produto** (a nota calcula pela configuração de Impostos da empresa); aparecem só para consulta.

## Pontos em aberto e decisões do negócio

- **Primeira carga:** ninguém recebe sugestão até a equipe publicar regras. Siga `docs/carga-fiscal-inicial.md` (consulta de uso, lista com descrição, prompts, contador).
- **Quem valida cada regra** antes de publicar e como registrar a fonte (`fonte`, `observacao`): defina o responsável.
- **Dados dos clientes** usados para montar a base que as outras empresas vão ver: conferir o contrato.
- **Manutenção da Tabela NCM:** a Gecex muda a tabela por resolução; defina quem roda `scripts/gerar-tabela-ncm.py` e quando (o aviso de 180 dias só aparece quando o script roda).
- **UF das empresas:** empresa sem UF válida (sigla de 2 letras) só recebe regras sem UF; a tela avisa. Para empresa com mais de um CNPJ vale a UF do primeiro.
- **Tipos gerados:** `src/integrations/supabase/types.ts` ainda não conhece as funções novas (as chamadas são tipadas localmente); quando o Lovable regenerar, os `as unknown as` podem sair.

## Teste visual antes de usar

1. `/ze-tech-fiscal` (equipe): baixar o modelo, importar 1 linha de teste, ver a prévia, publicar, encerrar. Conferir que NCM inexistente é recusado.
2. Cadastro de produto: digitar o NCM da linha de teste; ver a sugestão, a UF considerada e "Usar sugestão (IBS/CBS)".
3. `/fiscal`: "Consultar a base", ver o resumo, "Aplicar na lista" (rascunho) e conferir que só o Salvar grava.
4. `/fiscal-regras` (administrador ou gestor): criar uma regra própria, ocultar e voltar a usar uma regra da base.
5. Encerrar a regra de teste e conferir que a sugestão volta ao que era.
