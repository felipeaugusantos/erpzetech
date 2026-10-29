# Especificação: módulo de manufatura (EZRA ERP)

Status: rascunho para revisão. Nada foi implementado, e nenhuma permissão, plano, preço, RLS existente ou dado foi alterado.
Base: `main` em `f72691e`. Os padrões citados foram conferidos no código (arquivos indicados).

## 1. Objetivo e escopo

Permitir que uma indústria pequena de **móveis e marcenaria** (segmento inicial definido pelo responsável) planeje e registre a produção, com consumo de insumos, entrada do produto acabado no estoque e custo real da ordem, reaproveitando estoque, custo médio e compras que o sistema já tem.

**Dentro do primeiro corte (fases 1 e 2):** lista de materiais (BOM), ordem de produção (OP), baixa de insumos e entrada de produto acabado, apontamento de produzido e refugo, custo padrão e real da OP, necessidade de materiais ligada à sugestão de compra.

**Fora do primeiro corte:** fiscal de industrialização (remessa, IPI, NF-e de produção), trabalho sem internet no chão de fábrica, planejamento de capacidade, BOM de vários níveis na fase 1, preço, plano e comunicação pública do módulo.

### Premissas

1. **Segmento inicial: móveis e marcenaria** (confirmado). Núcleo simples, sem campos de outros segmentos.
2. Predomina a **produção sob medida, por encomenda**: a OP nasce de um pedido ou orçamento aprovado e o móvel pronto **não** entra no estoque, vai para o cliente. Produção para estoque (linha padrão) usa a mesma OP, com entrada no estoque.
3. A fábrica sob medida atual (`/personalizacao`, `/producao`, `/custo-par`, `/movimento-grade`) é de **grade de tamanhos** (roupas e calçados) e não serve a móveis; fica como está e não é migrada (a decisão 3 anterior fica resolvida assim).
4. Decisões de perfil, CNAE, custo, produto, movimentação de estoque, sobras e comercial: seção 9. Só a validação do CNAE pelo contador e o preço e a taxa inicial do módulo seguem em aberto.

### Fluxo típico de marcenaria que o módulo precisa cobrir

Orçamento aprovado → pedido → **OP sob medida** (itens da lista de materiais ajustados ao projeto) → liberação com reserva de chapas e ferragens → etapas (corte, furação e usinagem, montagem, pintura ou acabamento, embalagem) → apontamento de produzido, sobra e refugo → custo real da OP → entrega ao cliente (fora do módulo).

## 2. O que já existe e será reaproveitado

| Necessidade                | Já existe                                                                                   | Onde                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Consumo com perda          | `consumoReal`, `custoDoPrato`                                                               | `src/lib/ficha-tecnica.ts`                                  |
| Receita por produto        | `cardapio_ficha` (qtd, perda %, FK composta com tenant)                                     | `20261011000000_restaurante_ficha_tecnica.sql`              |
| Baixa atômica de insumos   | `restaurante_movimentar_insumos` (`FOR UPDATE`, `permite_negativo`, movimentação com custo) | mesma migration                                             |
| Estoque por depósito       | `estoques` (quantidade, reservado, `custo_medio`), `estoque_movimentacoes`                  | `20260918022844…sql`                                        |
| Entrada com custo médio    | `atualizar_custo_medio(produto, deposito, qtd, custo)`                                      | `20260918120215…sql`                                        |
| Lotes e validade           | `estoque_lotes`, `estoque_lote_lancar`                                                      | `20261111000000_estoque_lote_validade.sql`                  |
| Sugestão de compra         | tela e lib de reposição                                                                     | `sugestao-compra`, `cotacao`                                |
| Orçamento e pedido         | orçamento que vira pedido com reserva de estoque                                            | `orcamentos`, `pedidos`                                     |
| Venda e estoque fracionado | unidades m, m², m³ e kg no cadastro de produto                                              | `src/lib/modulos-produto.ts` (`venda_fracionada`), `granel` |
| Liberação de módulo        | `moduloLiberadoEmpresa`, `empresa_modulos_liberados`, `useModulosCnae`                      | `src/lib/cnae-regras.ts`, `src/lib/cnae.ts`                 |
| Padrão de módulo no banco  | prefixo `lr_`, função `lava_rapido_liberado()`                                              | `20261117000000_lava_rapido.sql`                            |

## 3. Modelo de dados (prefixo `mf_`)

Todas as tabelas: `tenant_id` com FK para `tenants`, FKs compostas `(id, tenant_id)` como nas demais, RLS por `current_tenant_id()`.

- **`mf_boms`**: `produto_id` (acabado), `versao`, `rendimento` (quantidade produzida por receita), `situacao` (`rascunho`, `ativa`, `obsoleta`). Única `ativa` por produto; `(tenant_id, produto_id, versao)` único.
- **`mf_bom_itens`**: `bom_id`, `insumo_id` (produto), `quantidade` (por receita, na unidade de estoque: chapa, m², m³, metro linear ou unidade para ferragens), `perda_percentual` (0 a <90, mesma regra da ficha; é onde entra a perda de corte de chapa). Sem ciclo: insumo diferente do acabado.
- **`mf_ordens`**: `numero` (sequencial por empresa), `descricao` (ex.: "Armário de cozinha, Sra. Ana"), `produto_id` (opcional: só quando há produto acabado cadastrado), `bom_id` (opcional: a OP sob medida pode partir de uma lista-modelo e ser ajustada), `quantidade_planejada`, `quantidade_produzida`, `quantidade_refugo`, `situacao` (`planejada`, `liberada`, `em_producao`, `concluida`, `cancelada`), `entrada_estoque` (falso na encomenda: o móvel não entra no estoque; verdadeiro na linha padrão), `deposito_insumos_id`, `deposito_destino_id` (só com `entrada_estoque`), `pedido_id` (opcional), `medidas` e `acabamento` (textos livres), `prazo`, `custo_padrao`, `custo_real`, `mao_de_obra` (valor manual opcional), `criada_por`.
- **`mf_ordem_insumos`**: cópia (snapshot) dos itens da BOM na liberação, **editável antes da liberação** (cada projeto sob medida usa quantidades diferentes; depois de liberada, só o consumo muda): `insumo_id`, `quantidade_planejada`, `quantidade_consumida`, `custo_unitario_padrao`. Mudar a BOM depois não reescreve OP já liberada.
- **`mf_apontamentos`** (fase 2): `ordem_id`, `etapa`, `quantidade_boa`, `refugo`, `minutos`, `usuario_id`, `chave_idempotente` (única por empresa).
- **`mf_etapas`** (fase 2): roteiro por produto (`ordem`, `nome`), para generalizar o que `/producao` faz por pedido.

## 4. Funções do banco (todas `SECURITY DEFINER`, `search_path = public`, `REVOKE` de `PUBLIC`/`anon`)

Cada uma confere `manufatura_liberada()` e o perfil, e usa só o tenant da sessão.

| Função                                                | Faz                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manufatura_liberada()`                               | **no piloto, só liberação explícita** (`empresa_modulos_liberados`); CNAE e escolha sem CNPJ ficam desligados até depois do piloto (seção 6)                                                                                       |
| `mf_bom_salvar(jsonb)` / `mf_bom_ativar(uuid)`        | grava a receita, valida perda e ciclo, ativa uma versão e torna a anterior obsoleta                                                                                                                                                |
| `mf_ordem_criar(jsonb)`                               | cria a OP e calcula o custo padrão com a fórmula de `ficha-tecnica.ts`                                                                                                                                                             |
| `mf_ordem_liberar(uuid)`                              | copia a BOM para `mf_ordem_insumos`, valida disponibilidade e reserva insumos (`estoques.reservado`)                                                                                                                               |
| `mf_ordem_apontar(uuid, boa, refugo, minutos, chave)` | idempotente; consome insumos proporcionalmente (saída com `FOR UPDATE`, custo e `documento = 'OP-n'`) e, quando `entrada_estoque`, dá entrada do acabado com `atualizar_custo_medio`; na encomenda, o custo fica na OP e no pedido |
| `mf_ordem_concluir(uuid)` / `mf_ordem_cancelar(uuid)` | fecha a OP e libera a reserva que sobrou; não desfaz consumo já feito                                                                                                                                                              |
| `mf_necessidade(uuid[])`                              | falta de cada insumo para as OPs, alimentando a sugestão de compra                                                                                                                                                                 |

Regras de consumo (quantidades com 4 casas, como na ficha técnica): respeita `depositos.permite_negativo`; insumo sem saldo recusa com mensagem clara (como `restaurante_movimentar_insumos`); refugo consome insumo e não entra no estoque do acabado; sobras de chapa (retalhos) não são tratadas na fase 1; custo real da OP = insumos consumidos pelo custo médio do momento + mão de obra manual.

Decisão técnica (resolvida): manter `mov_tipo` em `saida` e `entrada`, com `documento = 'OP-n'`; valor novo no enum é difícil de desfazer e muda relatórios de estoque. O prefixo do documento permite filtrar o que veio da produção. Reavaliar na fase 2, se algum relatório precisar distinguir.

## 5. Telas e menu

Grupo "Manufatura" no menu, só quando o módulo está liberado:

- Listas de materiais (`/manufatura-boms`)
- Ordens de produção (`/manufatura-ordens`)
- Apontamento (`/manufatura-apontar`, pensada para celular e tablet)
- Necessidade de materiais (`/manufatura-necessidade`)
- Custo e perdas (relatório, fase 3)

Mesmos componentes e padrões das demais telas (`PageHeader`, `ModuloBloqueado`, fontes e tokens atuais). Esconder o grupo para empresas só clínica ou só alimentação (listas `TELAS_FORA_*` / `GRUPOS_FORA_*`).

## 6. Liberação e perfis

- **Liberação (piloto fechado):** nova entrada `manufatura` em `empresa_modulos_liberados` (ajustar o `CHECK`, como em `20261117000000_lava_rapido.sql`), em `ModuloCnae` e `ROTULO_MODULO`. **Durante o piloto, o módulo só abre por liberação explícita da equipe**, e essa regra vale nos dois lugares: no resolvedor da tela (`moduloLiberadoEmpresa` e `useModulosCnae`, com o ramo `manufatura` tratado só pela liberação explícita, sem cair no CNAE nem em `modulos_sem_cnpj`) e em `manufatura_liberada()` no banco. Assim nenhuma empresa fora do piloto vê o módulo por ter um CNAE parecido. Sem novo ramo de atividade na fase 1, para não mexer no cadastro de produto por módulo.
- **CNAE (decidido, mas só depois do piloto):** a elegibilidade automática por CNAE `3101`, `3102` e `3103` (fabricação de móveis) fica **adiada para depois do piloto**, quando o módulo deixar de ser fechado. Quando entrar, usa prefixos longos para não pegar outras atividades (mesmo cuidado de `cnae-regras.ts`) e sem sobrepor os de reparo que já liberam assistência (`3314`, `3319`). Os de artefatos de madeira (`16xx`) e de instalação de armários embutidos só entram depois da **validação do contador ou da tabela oficial** (pendente, não verificada). Até lá, a liberação explícita cobre as empresas do piloto.
- **Perfis (decidido):** `administrador` e `gestor` mantêm lista de materiais e OP. **Perfil novo `producao`** para o encarregado da oficina: aponta produção e vê as OPs, sem ver custo e sem mexer em saldo de estoque. Não usar o `estoquista`, que pode ajustar estoque e fazer inventário. As funções do banco gravam o estoque por conta própria, então o perfil não precisa de permissão direta nas tabelas. Migration pequena com `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'producao'` (padrão de `profissional` e `veterinario`), mais o gate de menu e os testes.
- **Sem trava por plano**, como hoje. Preço, plano e taxa inicial do módulo não estão definidos e não entram aqui (ver o piloto fechado na seção 9).

## 7. Segurança e CI (regras que o `supabase/ci/smoke.sql` já impõe)

- Toda tabela com RLS precisa de política restritiva do salão (`eh_salao_restrito`) ou entrar na lista `liberadas`.
- Toda função `SECURITY DEFINER` chamável precisa de `exige_nao_salao` ou entrar na lista `sem_trava`, com comentário.
- Testes novos no `smoke.sql`: isolamento entre empresas; recusa por perfil e por módulo não liberado; snapshot da BOM imutável; apontamento idempotente (mesma chave não consome duas vezes); estoque não fica negativo sem permissão; concorrência com `FOR UPDATE`; custo igual ao calculado em TypeScript.
- Lógica de conta em `src/lib/manufatura.ts` (generalizando `consumoReal` e `custoDoPrato` para `custoDaReceita`), com testes em `tests/`, para o Node rodar sem a tela.

## 8. Fases

1. **Fase 1, núcleo:** perfil `producao`, lista de materiais (modelo), OP sob medida ou de linha padrão ligada a pedido, itens editáveis até a liberação, reserva de chapas e ferragens, apontamento simples, baixa de insumos, custo da OP, menu e liberação do módulo.
2. **Fase 2:** etapas de marcenaria (corte, furação e usinagem, montagem, pintura ou acabamento, embalagem) como roteiro-padrão editável, apontamento por etapa com minutos, custo de mão de obra por hora (cadastro de custo por funcionário ou etapa), custo da OP no relatório "Lucro e margem" pelo `pedido_id`, necessidade de materiais ligada a compras, BOM com semiacabado (detecção de ciclo).
3. **Fase 3:** retalhos e sobras de chapa, plano de corte e aproveitamento, relatórios de rendimento, perda e custo real contra padrão.

## 9. Decisões

**Resolvidas pelo responsável:**

1. **Segmento inicial:** móveis e marcenaria; produção predominante sob encomenda (e também linha padrão); personalização de grade fica à parte.
2. **Perfil de apontamento:** perfil novo `producao` (seção 6).
3. **CNAE:** liberação automática por `3101`, `3102` e `3103` só depois do piloto; no piloto vale só a liberação explícita. Os demais CNAE só entram depois da validação do contador (seção 6).
4. **Custo da OP na fase 1:** insumos mais mão de obra em valor manual. Custo por hora na fase 2, com o apontamento de minutos.
5. **Produto cadastrado para móvel sob medida:** não. A OP tem descrição própria e o custo vai para a OP e o pedido (`pedido_id`, `custo_real`); a integração com "Lucro e margem" entra na fase 2.
6. **Tipo de movimentação de estoque:** manter `saida` e `entrada` com `documento = 'OP-n'` (seção 4).
7. **Sobras de chapa:** fase 3. Na fase 1 a perda de corte cabe no percentual de perda por material.
8. **Comercial:** **piloto fechado com 1 ou 2 marcenarias, sem preço público.** O módulo é liberado só pela equipe (liberação explícita, também no banco: CNAE e escolha sem CNPJ não liberam durante o piloto) e a cobrança é combinada em contrato. Depois do piloto, o responsável decide preço, plano e taxa inicial com dados reais de uso. A página pública só passa a falar do módulo depois dessa decisão.

**Ainda em aberto:**

- Validação do CNAE pelo contador ou pela tabela oficial.
- Preço, plano e taxa inicial do módulo (nenhum valor é assumido).

## 10. Riscos

- **Consumo duplicado** em apontamento repetido: mitigado pela chave idempotente e pelos testes.
- **BOM alterada com OP aberta:** mitigado pelo snapshot.
- **Custo distorcido por perda mal informada:** a perda segue a fórmula já usada na ficha; mostrar custo padrão ao lado do real.
- **Estoque inconsistente sob concorrência:** `FOR UPDATE` e transação única por apontamento, como na baixa do restaurante.
- **Sobreposição com a personalização atual:** é de grade de tamanhos; manter separada.
- **Projeto sob medida muda no meio da obra:** itens editáveis só antes da liberação; depois, ajuste por apontamento e justificativa, nunca reescrevendo a lista.
- **Perda de corte subestimada:** a perda por material precisa ser realista; o relatório da fase 3 compara padrão e real para corrigir.
