# Roadmap

- [x] Painel Ze Tech: quantidade de notas emitidas por cliente (`/ze-tech-notas` + RPC `saas_notas_por_cliente`)
- [x] Painel fiscal por loja: entradas, saídas, saldo e impostos por período (`/painel-fiscal` + RPC `painel_fiscal_loja`)
- [x] Módulo Assistência técnica: ordens de serviço com peças e mão de obra (`/assistencia`)
- [x] Módulo Locação de equipamentos: equipamentos e contratos (`/locacao-equipamentos`, `/locacoes`)
- [x] Menus novos no AppShell (Assistência técnica, Locação, Painel fiscal, Notas emitidas)

## Rodada 2
- [x] Tela de clientes da Ze Tech com histórico de cobranças, filiais e situação (`/ze-tech-clientes`)
- [x] Impostos da nota calculados pela filial emitente (interna/interestadual pela UF)
- [x] Contas a pagar no painel Ze Tech (`/ze-tech-contas-pagar`, tabela `saas_contas_pagar`)
- [x] Botões de baixar a nota em PDF e XML (`src/lib/nfe-arquivos.ts`)
- [x] Painel Ze Tech de assistência técnica (`/ze-tech-assistencia` + RPC `saas_assistencia_por_cliente`)
- [x] Cadastro de técnicos (`/tecnicos`, tabela `tecnicos`, `os_ordens.tecnico_id`)
- [x] Assistência técnica por loja (`/assistencia-lojas` + RPC `assistencia_por_filial`)
- [x] Tempo real das lojas no painel Ze Tech (`/ze-tech-tempo-real` + RPC `saas_tempo_real_por_cliente`)
