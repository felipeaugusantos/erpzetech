# Menu personalizado por empresa

A empresa escolhe como o menu aparece: **esconder** telas, **mover** telas entre áreas, **criar áreas próprias** e **reordenar**.
Decisões do produto: personalização **por empresa** (o administrador define para todos) e níveis A a C (esconder, reordenar,
mover e criar áreas).

## Princípios

- **É só visual.** A personalização entra depois do filtro por permissão e módulo e depois do agrupamento em áreas do trilho
  (`montarAreas`, no `AppShell`). Ela só reorganiza o que a pessoa já pode ver e **nunca libera uma tela**. Esconder uma tela
  não bloqueia a rota.
- **Telas essenciais não saem**: `/configuracoes`, `/usuarios` e `/menu-personalizado` (a tela do editor, que virá no PR 3),
  para a empresa sempre conseguir desfazer.
- **Telas novas aparecem sozinhas.** O que a configuração não cita fica no fim da área, na ordem do sistema.
- **Configuração inválida é ignorada** (formato, versão ou tamanho fora do limite) e o menu volta ao padrão.
- **Área vazia some** do trilho. Uma área própria não pode ter o nome de uma área do sistema.
- Ao mover ou reordenar, as seções internas do sistema (ex.: "Gerencial" nos Relatórios) deixam de aparecer nessas áreas.

## Formato (versão 1)

```json
{
  "versao": 1,
  "ocultos": ["/pet-agenda"],
  "areas": [{ "id": "meu-dia", "nome": "Meu dia a dia" }],
  "ordemAreas": ["meu-dia", "Início"],
  "itens": { "/pets": { "area": "Clínica" }, "/clinica-fila": { "area": "meu-dia" } },
  "ordemItens": { "meu-dia": ["/clinica-fila"] }
}
```

- Área do sistema = o rótulo do trilho (ex.: `Clínica`); área própria = o `id` (`meu-…`).
- Limites: 300 telas escondidas, 10 áreas próprias (nome de 2 a 30 caracteres), 40 áreas na ordem.

Exemplo para uma clínica que quer ver só a área Clínica: mover `/pets` e `/pet-contatos` para `Clínica` e esconder o resto.

## Plano em PRs pequenos

1. **PR 1 (este):** a lógica pura `src/lib/menu-personalizado.ts` e a leitura segura da configuração, com testes. **Não muda o app**: nada a usa ainda.
2. **PR 2 (feito):** a tabela `menu_personalizado` (uma linha por empresa, JSON com limite de tamanho), leitura para as pessoas da empresa
   e gravação só por função para administrador ou gestor. Migração em `drizzle/migrations`, que você aplica.
3. **PR 3:** a tela **Ajustes → Menu** (setas para mover, sem depender de arrastar), "Restaurar o padrão", e o uso no `AppShell`:
   `aplicarMenuPersonalizado(montarAreas(menu), config, criarArea)`.

## Banco (PR 2)

Migração `drizzle/migrations/0082_menu_personalizado.sql` (o usuário aplica):

- Tabela `menu_personalizado` (uma linha por empresa, `config` em JSON até 20 mil caracteres), **sem acesso direto**: nem o app lê ou grava a tabela.
- `menu_personalizado_obter()`: qualquer pessoa da empresa (inclusive o perfil do salão, porque o menu vale para todos). `null` = menu padrão.
- `menu_personalizado_salvar(p_config)`: só administrador ou gestor. O banco confere o objeto, a `versao` 1, as chaves conhecidas, os tipos gerais e o tamanho; o conteúdo fino (caminhos, nomes, limites) é conferido no app por `lerConfigMenu`.
- `menu_personalizado_restaurar()`: só administrador ou gestor; apaga a configuração e volta ao padrão.
- Teste de banco `supabase/ci/menu-personalizado.sql`: papéis, isolamento entre empresas, acesso direto recusado, formato e tamanho, restaurar.

## Pontos que ainda dependem do uso real

- A busca (Ctrl K) continua achando as telas escondidas; confirmar se o cliente quer isso.
- O menu do celular e o do trilho devem usar as mesmas áreas personalizadas.
- Personalização por usuário fica para uma segunda rodada.
