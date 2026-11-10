# Carga fiscal inicial (base global de regras por NCM)

Como montar a primeira carga da base fiscal (`/ze-tech-fiscal`) **sem inventar dados**. O plano geral está em `docs/parametrizacao-fiscal.md`.

## Princípios

- **Nenhuma IA é fonte oficial.** Tudo o que sair de IA é rascunho: quem valida é o contador, com a legislação na mão.
- **Rodadas pequenas, uma por segmento** (ramo de atividade: construção, pet shop, clínica, lava-rápido, roupas e calçados, autopeças, agro,
  elétrica e hidráulica, distribuidora, papelaria, restaurante, hotelaria, outro varejo). 30 a 80 NCMs por rodada.
- **Na dúvida, fica de fora.** NCM de tratamento misto (depende da descrição ou da composição) e ST que depende da UF não entram nesta
  carga: a consulta ainda não considera a UF de destino. A empresa pode sobrescrever depois.
- Esta carga define só o que o sistema aplica de fato: **CST/CSOSN, CFOP e CEST**. PIS, COFINS, IBS/CBS, alíquota e origem ficam vazios
  (a nota calcula PIS e COFINS pela configuração de Impostos da empresa, e a origem é do produto, não do NCM).
- Valores de ICMS aceitos (os que a emissão sabe formatar): CST **00, 40, 41, 50, 51, 60**; CSOSN **101, 102, 103, 300, 400, 500, 900**.

## Passo a passo

1. **Escolher o segmento e os NCMs** com a consulta de uso (abaixo). Comece pelo segmento com mais empresas.
2. **Gerar a lista com descrição oficial** (abaixo), 30 a 80 NCMs.
3. **Rodar o Prompt 1** (gerar) numa IA, colando a lista.
4. **Rodar o Prompt 2** (auditar) em **outra** IA, sem dizer de onde veio o CSV.
5. **Entregar ao contador** o CSV, a tabela "Revisão" e as "Dúvidas". Só as linhas que ele aprovar seguem.
6. **Importar** em `/ze-tech-fiscal`: baixe o modelo, cole as linhas aprovadas (NCM e CST como texto, para a planilha não tirar o zero à esquerda), informe a
   **fonte** ("Contador X, segmento Y, AAAA-MM") e veja a **prévia**. A tela recusa NCM que não consta na Tabela NCM vigente. Publique só com zero erro.
7. **Conferir** no cadastro de um produto de teste (a sugestão aparece ao digitar o NCM) e na tela Fiscal ("Consultar a base").
8. Repetir para o próximo segmento.

## 1. Consulta de uso por segmento

`docs/sql/ncms-usados-por-ramo.sql`: roda no editor SQL do Supabase, **só leitura**. Mostra, por segmento e regime, os NCMs mais usados nos
produtos ativos e nas **notas autorizadas pela Sefaz**, com o CST/CSOSN e o CFOP mais comuns e a **concordância** entre as empresas.
Só saem NCMs usados por pelo menos 2 empresas (mude `minimo_empresas` no começo do arquivo). Nada identifica empresa, produto ou cliente.

- Concordância alta (acima de 90%) em várias empresas: bom candidato.
- Concordância baixa: os clientes tributam o mesmo NCM de jeitos diferentes; o contador decide ou o NCM fica de fora.
- **Antes de usar dados dos clientes para montar uma base que outras empresas vão ver, confira o contrato.**

Exporte o resultado de um segmento como CSV e use na próxima etapa.

## 2. Lista de NCMs com descrição completa

A Tabela NCM oficial é hierárquica: "Outros" só faz sentido com o que vem acima. O script junta a cadeia inteira. Baixe a planilha
`Tabela_NCM_Vigente_AAAAMMDD.xlsx` (Siscomex) e rode:

```bash
python3 scripts/ncm-descricoes.py Tabela_NCM_Vigente.xlsx --ncms uso-petshop.csv --max 60
```

- `--ncms arquivo.csv`: a primeira coluna é o NCM (as outras são mantidas na linha, útil para a contagem de empresas). NCM que não consta na tabela é avisado.
- Alternativas: `--capitulo 23` ou `--posicao 2309`.
- `--csv` gera `ncm;"descrição"`. Saída padrão: `23091000 — Preparações do tipo utilizado na alimentação de animais > Alimentos para cães ou gatos, acondicionados para venda a retalho`.

Para atualizar a tabela de NCMs usada pelo sistema na validação: `python3 scripts/gerar-tabela-ncm.py Tabela_NCM_Vigente.xlsx`
(a Gecex muda a tabela por resolução; o script avisa se ela tiver mais de 180 dias).

## 3. Prompt 1 (gerar o rascunho)

Preencha as três linhas de ENTRADA e cole tudo.

```text
Você é um analista tributário brasileiro. Preciso de um RASCUNHO de regras fiscais por NCM para um ERP, que será revisado por um contador. Prefira omitir uma linha a arriscar um palpite. Se você não tem acesso à internet, diga isso no início e marque tudo como confiança "baixa".

ENTRADA
- Segmento desta rodada: [SEGMENTO]
- Regimes: normal e simples
- Início da vigência: [AAAA-MM-DD]
- Use SOMENTE os NCMs desta lista (não sugira outros). Formato: NCM — descrição do produto:
  [COLE AQUI, UM POR LINHA]

ESCOPO DESTA CARGA (somente isto)
Preencha apenas: ncm, cest, operacao, regime, vigencia_inicio, perfil, cst_icms, csosn, cfop, observacao. Deixe VAZIOS: uf_destino, vigencia_fim, aliq_icms, reducao_base_icms, mva_st, cst_pis, aliq_pis, cst_cofins, aliq_cofins, cst_ibs_cbs, cclasstrib, origem.

REGRAS
1. Nunca invente. Cada linha precisa de base verificável (TIPI/Tabela NCM, Convênio ICMS 142/2018 para CEST e ST, legislação citada). Confirme que o NCM existe e combina com a descrição.
2. Se o tratamento do NCM depende da descrição, da composição ou do uso do produto, NÃO gere linha: liste em "Dúvidas" as variações existentes (e o CEST de cada uma, se houver).
3. Se a substituição tributária (ST) do NCM depende de protocolo ou convênio de cada UF, NÃO gere linha: liste em "Dúvidas" com as UFs que você conhece. Gere linha de ST (cst_icms 60 ou csosn 500, cfop 5405) só quando a ST for uniforme para o Brasil inteiro, e diga isso na observação.
4. Se o CEST separa tratamentos diferentes do mesmo NCM, gere uma linha por CEST (7 dígitos). Sem CEST: vazio.
5. operacao = "venda". Uma linha por NCM e por regime ("normal" ou "simples").
6. Regime normal: cst_icms APENAS 00, 40, 41, 50, 51 ou 60, e csosn vazio. Regime simples: csosn APENAS 101, 102, 103, 300, 400, 500 ou 900, e cst_icms vazio. Se o produto exigir outro código, omita e explique em "Dúvidas".
7. cfop: 5102 (venda tributada ou isenta) ou 5405 (substituído por ST). Assuma venda interna e escreva "operação interna" na observação.
8. perfil: nome curto e padronizado ("Revenda tributada", "Substituição tributária", "Isento"). Linhas com o mesmo perfil precisam ter exatamente os mesmos valores nas colunas de tributação.
9. observacao: até 150 caracteres com a fonte e a confiança.

FORMATO DO CSV (separador ponto e vírgula, primeira linha exatamente assim):
ncm;cest;operacao;regime;uf_destino;vigencia_inicio;vigencia_fim;perfil;cst_icms;csosn;cfop;aliq_icms;reducao_base_icms;mva_st;cst_pis;aliq_pis;cst_cofins;aliq_cofins;cst_ibs_cbs;cclasstrib;origem;observacao
NCM só com dígitos (8 sempre que possível). Datas AAAA-MM-DD.

SAÍDA, nesta ordem:
1) Um único bloco de código com o CSV, sem comentários e sem linhas em branco.
2) Tabela "Revisão": NCM | regime | confiança | fonte | o que o contador deve conferir.
3) "Dúvidas e NCMs omitidos" com o motivo de cada um (separe os omitidos por ST dependente de UF).
4) O que você não conseguiu verificar.
```

## 4. Prompt 2 (auditar, em outra IA)

```text
Você é um auditor tributário brasileiro. Vou colar um CSV de regras fiscais por NCM gerado por outra IA. Não confie em nada: confira linha por linha e NÃO reescreva as linhas. Se não tiver acesso à internet, avise e rebaixe a confiança de tudo.

Para cada linha, verifique:
1. O NCM existe e a descrição combina com a observação.
2. O tratamento (tributado, ST, isento, monofásico) está correto para o regime. Confira CEST e a base legal citada.
3. Regime normal só com cst_icms em 00, 40, 41, 50, 51, 60 (csosn vazio). Regime simples só com csosn em 101, 102, 103, 300, 400, 500, 900 (cst_icms vazio).
4. cfop é 5102 ou 5405 e combina com o tratamento (ST com 5405).
5. Formato: ncm com 2, 4, 6 ou 8 dígitos; cest com 7 dígitos ou vazio; datas AAAA-MM-DD; percentuais com vírgula; uf_destino, aliq_icms e origem vazios.
6. Linhas com o mesmo "perfil" têm exatamente os mesmos valores nas colunas de tributação.
7. Sem contradição entre linhas do mesmo NCM.

Responda com:
A) Uma tabela por linha do CSV: NCM | regime | veredito (OK / DÚVIDA / ERRO) | motivo | fonte que você usou.
B) Um novo CSV, no mesmo formato, SÓ com as linhas OK.
C) O que você não conseguiu verificar.

CSV:
[COLE AQUI]
```

## Limites conhecidos

- A consulta da base não considera **UF de destino**: regras com `uf_destino` preenchido não casam. Por isso ST por UF fica fora desta carga.
  A melhoria natural é consultar com a UF da própria empresa (venda interna).
- O CFOP é uma coluna única do produto: 5102 vale para venda interna; venda interestadual (6102, 6405) não é coberta.
- A base só **sugere**: nada muda sozinho nos produtos ou nas notas. A empresa sobrescreve ou oculta o que não serve (`/fiscal-regras`).
