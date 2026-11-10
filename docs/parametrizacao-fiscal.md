# Parametrização fiscal por NCM (base global + sobrescrita da empresa)

**Status: plano em discussão. Nenhum código foi alterado.**

Objetivo: ao cadastrar um produto, o sistema **sugere** a tributação (CST/CSOSN, CFOP, alíquotas, PIS/COFINS, IBS/CBS) a partir do NCM,
da operação e do regime da empresa, no estilo de uma base de parametrização fiscal, mas **sem API externa**.

Decisões do produto:

- A base é **global e mantida pela equipe Ze Tech**; a **empresa pode sobrescrever** para si.
- A primeira versão cobre o **regime normal**, por **NCM e operação**. UF e Simples Nacional entram nas fases seguintes, sem refazer o modelo.
- É **sugestão**: nunca altera produto, nota ou imposto sozinha, e a validação final é do contador.

## Princípios

- **Quem não usar a base continua como hoje.** Sem regra cadastrada, a resolução cai no padrão atual da empresa (`impostos.tsx`).
- **Nunca preenche em silêncio.** O cadastro do produto mostra a sugestão com a origem (regra global vX, sobrescrita da empresa) e só grava quando a pessoa confirma.
- **Nota emitida não muda.** Cada item da nota guarda qual regra e qual versão foram aplicadas; mudar a base depois não reclassifica nota antiga.
- **Recálculo em massa é ação explícita**, com a lista do que será afetado. Nunca automático.
- **Sem acesso direto às tabelas.** Tudo por funções, como no bulário e no menu personalizado.
- **Regra tem vigência e versão.** Corrigir uma regra cria uma nova e encerra a anterior; a antiga continua consultável.
- **A UF já existe no modelo**, mesmo sem uso na primeira versão (coluna nula = vale para todas).

## Ordem de precedência (quem vence)

1. Valor digitado no item da nota.
2. Exceção gravada no produto.
3. Sobrescrita da empresa (a regra mais específica vence).
4. Regra global (a mais específica vence).
5. Padrão atual da empresa (`impostos.tsx`).

Os níveis 1, 2 e 5 já existem hoje. A novidade são os níveis 3 e 4.

### Especificidade

Entre regras do mesmo nível, vence a mais específica:

1. NCM de 8 dígitos, depois 6, 4 e 2 (prefixo).
2. Com CEST casando antes de sem CEST.
3. Com operação e regime casando antes de "qualquer".
4. (Fase seguinte) com UF de destino antes de sem UF.

Só vale regra **vigente na data da operação**. Empate real entre duas regras (mesma especificidade) **não é desempatado em silêncio**: a função devolve a lista e a tela pede a escolha.

## Modelo de dados (rascunho)

Migração em `supabase/migrations` (não depende das tabelas de internação), com o próximo timestamp.

### Base global (sem tenant)

- `fiscal_perfis`: `id`, `nome`, `descricao`, e os campos de tributação: `cst_icms`, `csosn`, `cfop`, `aliq_icms`, `reducao_base_icms`, `mva_st`,
  `cst_pis`, `aliq_pis`, `cst_cofins`, `aliq_cofins`, `cst_ibs_cbs`, `cclasstrib`, `origem` (quando aplicável).
- `fiscal_regras`: `id`, `perfil_id`, `ncm_prefixo` (2 a 8 dígitos), `cest`, `operacao`, `regime`, `uf_destino` (nulo = todas), `vigencia_inicio`,
  `vigencia_fim`, `versao`, `ativa`, `observacao`, `fonte` (de onde veio a regra).
- Sem acesso direto: nem leitura nem escrita pelo app. Carga só pela equipe, com service_role.

### Por empresa

- `fiscal_empresa_regras`: mesmo formato de `fiscal_regras`, com `empresa_id`, mais o perfil próprio da empresa. Tabela com RLS e política `salao_restrito`.
- `fiscal_empresa_ocultas`: regras globais que a empresa decidiu ignorar (`empresa_id`, `regra_id`, motivo).

### Aplicado na nota

- Colunas no item da nota: `regra_origem` (global, empresa, produto, manual, padrão), `regra_id` e `regra_versao`. Fica a prova do que foi usado.

## Funções (todas por função, sem acesso direto)

- `fiscal_sugerir(p_ncm, p_cest, p_operacao, p_data)`: para qualquer pessoa autenticada da empresa com acesso a produtos. Descobre a empresa pela sessão,
  aplica a precedência e devolve o perfil sugerido com a **origem**, ou a lista de candidatas quando houver empate.
- `fiscal_empresa_regra_salvar(...)` e `fiscal_empresa_regra_remover(...)`: só administrador ou gestor.
- `fiscal_empresa_ocultar(p_regra_id, p_motivo)` e `fiscal_empresa_reexibir(...)`: só administrador ou gestor; o motivo é obrigatório.
- `fiscal_recalcular_produtos(p_filtro, p_confirmar)`: só administrador ou gestor. Sem `p_confirmar` devolve só a **prévia** do que mudaria.
- Funções da equipe (gravam com service_role, só operador Ze Tech): `fiscal_base_importar` (com prévia), `fiscal_base_publicar`, `fiscal_base_encerrar_regra`.
- Toda função chamável por `authenticated` entra na lista `sem_trava` do `smoke.sql`.

## Lógica no app

- `src/lib/fiscal-regras.ts`: lógica **pura** (precedência, especificidade, vigência, empate), para ser testada sem banco. Mesmo espelho das funções SQL.
- Cadastro do produto (`produtos.tsx`): ao informar o NCM, chama `fiscal_sugerir`; campos preenchidos e editáveis, com selo de origem;
  se vier lista de candidatas, a pessoa escolhe. O que a pessoa digitar vira a exceção do produto.
- Emissão (`nfe-fiscal.functions.ts`): usa a mesma resolução e grava `regra_origem`, `regra_id` e `regra_versao` no item.
- Tela da equipe `/ze-tech-fiscal` (operador): importar planilha com prévia, publicar, encerrar regra, ver histórico de versões.
- Tela da empresa: aba em Impostos para sobrescrever e ocultar regras (administrador e gestor).

## Casos de teste (fase 1)

Precedência e especificidade (testes de unidade em `tests/`):

- NCM de 8 dígitos vence o de 6, que vence o de 4 e o de 2.
- CEST casando vence regra sem CEST.
- Sobrescrita da empresa vence a global de mesma especificidade; a global mais específica **não** vence a sobrescrita menos específica
  (o nível da empresa vem primeiro), decisão a confirmar na revisão.
- Regra fora da vigência é ignorada; regra vigente na data da operação vale.
- Regra global ocultada pela empresa é ignorada; a empresa vê a seguinte.
- Empate real devolve candidatas, nunca escolhe sozinha.
- Sem regra nenhuma, cai no padrão da empresa.
- Exceção do produto vence regra; valor digitado no item vence tudo.

Banco (`supabase/ci/fiscal-regras.sql`):

- Papéis: só administrador e gestor gravam sobrescritas; operador Ze Tech grava a base global; os demais só consultam a sugestão.
- Isolamento entre empresas: uma empresa nunca vê sobrescrita de outra.
- Acesso direto às tabelas recusado.
- Vigência e versão: publicar nova versão encerra a anterior sem apagá-la.
- Prévia do recálculo não altera nada; confirmar altera só o que a prévia listou.

## Plano em PRs pequenos

1. **PR 1 (feito):** lógica pura `src/lib/fiscal-regras.ts` + `tests/fiscal-regras.test.ts`. Não muda o app: nada a usa ainda.
   Decisões implementadas: a precedência vale **campo a campo** (item, produto, regra, padrão); a regra é escolhida **como um todo**
   e qualquer regra da empresa que case vence a global, mesmo menos específica; empate devolve as candidatas e **não** aplica o padrão;
   NCM sem 8 dígitos não consulta regra nem aplica o padrão; regra inválida nunca casa (`validarRegra` serve para a prévia da importação).
2. **PR 2:** migração (tabelas e funções de sugestão) + teste de banco. Ninguém usa ainda.
3. **PR 3:** tela da equipe para carga com prévia e versionamento; carga inicial pequena (50 a 100 NCMs).
4. **PR 4:** sugestão no cadastro do produto.
5. **PR 5:** sobrescritas e ocultação pela empresa.
6. **PR 6:** gravação da regra aplicada na nota e, depois, recálculo em massa.
7. **Depois:** UF de destino, Simples Nacional/MEI (CSOSN, IBS/CBS em 04/01/2027), ST por UF, NFC-e.

## Pontos em aberto

- **Carga inicial:** de onde vêm os NCMs e as regras de partida (planilha do contador, tabela pública, NCMs mais usados pelos clientes). Sem base inicial a função nasce vazia.
- **Quem na equipe valida cada regra** antes de publicar, e como registrar a fonte (`fonte`, `observacao`).
- **Precedência da empresa:** confirmar que qualquer sobrescrita da empresa vence a global, mesmo menos específica.
- **Reforma tributária:** o perfil já carrega CST e cClassTrib de IBS/CBS, mas os CSTs ainda não calculados (ver `docs/reforma-tributaria.md`) continuam recusados na emissão.
- **Produtos já cadastrados:** nenhum é alterado; a sugestão só aparece ao editar ou pelo recálculo em massa explícito.
- **Aviso fiscal:** texto da tela dizendo que a sugestão não substitui a validação do contador.
