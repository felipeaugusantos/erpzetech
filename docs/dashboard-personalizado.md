# Dashboard personalizado por empresa

A administração da empresa (administrador ou gestor) **liga, desliga e reordena** as peças que já existem no dashboard.
Não cria cartões novos, não escreve consultas e não muda o que cada peça calcula. Decisões do produto: só administrador ou
gestor configuram, para a empresa inteira, e a primeira versão é só ligar, desligar e reordenar.

## Princípios

- **Peças prontas.** O catálogo é fixo e vive no código (`PECAS_DASHBOARD_PET`). A configuração só guarda a ordem e o que está desligado.
- **Nunca mostra o que a pessoa não pode ver.** Só entram na lista as peças que o dashboard já considera disponíveis para a pessoa
  (por exemplo, "Reforços de vacina" só existe com a clínica e o perfil certo). A configuração não consegue ligar uma peça indisponível.
- **Peças novas aparecem sozinhas** no fim da lista, na ordem do sistema.
- **Configuração inválida é ignorada** (formato, versão ou tamanho) e o dashboard volta ao padrão; ids que o catálogo não conhece são descartados.
- **Cartões e painéis não se misturam**: subir e descer só troca de lugar com peças da mesma seção (indicadores ou painéis).
- O período de referência continua fixo no topo: os cartões dependem dele.

## Peças (painel `pet`: clínica e pet shop)

Indicadores: Atendimentos hoje, Faturamento no período, Faltas e cancelamentos, Marcados à frente, Clientes sem retorno há 90 dias,
Reforços de vacina (só clínica), A receber em aberto, A pagar em aberto.
Painéis: Atendimentos concluídos por dia, Serviços que mais faturaram, Agenda de hoje.

## Formato (versão 1)

```json
{ "versao": 1, "ordem": ["a-receber", "faturamento"], "ocultos": ["faltas", "agenda-hoje"] }
```

## Banco (migração `drizzle/migrations/0083_dashboard_personalizado.sql`, que o usuário aplica)

- Tabela `dashboard_personalizado` (uma configuração por empresa e por painel, hoje só `pet`, até 5 mil caracteres), **sem acesso direto**.
- `dashboard_personalizado_obter(p_painel)`: qualquer pessoa da empresa (devolve `null` = padrão).
- `dashboard_personalizado_salvar(p_painel, p_config)` e `dashboard_personalizado_restaurar(p_painel)`: só administrador ou gestor.
  O banco confere objeto, versão 1, só as chaves `versao`, `ordem` e `ocultos`, listas de até 40 textos e o tamanho.
- Teste de banco `supabase/ci/dashboard-personalizado.sql`.

## Plano em PRs pequenos

1. **PR A (feito):** lógica pura (`src/lib/dashboard-personalizado.ts`), migração, teste de banco e tipos. **Não muda o app.**
2. **PR B (feito):** botão "Personalizar" no dashboard (só administrador e gestor) com a lista de peças (liga/desliga e setas), "Restaurar o padrão"
   e o uso no `DashboardPet`.

## Tela (PR B)

No dashboard da clínica e do pet shop, **administrador e gestor** veem o botão **Personalizar**. A janela lista as peças em duas seções
(cartões e painéis), cada uma com um interruptor e setas para subir e descer, **Salvar**, **Descartar** e **Restaurar o padrão** (com confirmação).
Quem não é da administração vê o dashboard da empresa, sem o botão. Se tudo for desligado, a tela avisa e, para a administração, indica o botão.

## Fora desta versão

Cartões novos (por exemplo fila do dia), o dashboard de vendas (`Dashboard`, não o da clínica e do pet shop) e configuração por pessoa.
