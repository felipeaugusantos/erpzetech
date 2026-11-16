# Termos de Uso e LGPD

- Texto em `src/lib/legal.ts` (`montarTermos`, `montarPrivacidade`), páginas públicas `/termos` e `/privacidade`, links no rodapé da página inicial.
- **Antes de vender:** preencher `DADOS_LEGAIS` (razão social, CNPJ, foro, e-mail do encarregado) e passar o texto pelo jurídico. É um texto-base, não parecer jurídico.
- **Aceite:** a tela `AceiteLegal` (em `_authenticated/route.tsx`) bloqueia o sistema até a pessoa aceitar a `VERSAO_LEGAL`. Vale para todo perfil (salão e contador também). Sem internet ou com erro de leitura o sistema abre normalmente, para nunca travar o caixa; o aceite é pedido na próxima entrada com conexão.
- **Prova:** tabela `aceites_legais` (usuário, empresa, versão, data/hora), só cresce, sem acesso direto; funções `aceite_legal_meu` e `aceite_legal_registrar` (migração 20270122). Fica fora do backup do cliente.
- **Mudou o texto?** Troque `VERSAO_LEGAL` (AAAA-MM-DD): todos aceitam de novo na próxima entrada.
- **Papéis LGPD:** a EZRA é controladora dos dados da conta e da empresa assinante, e operadora dos dados que o cliente lança (tutores, clientes, hóspedes etc.).
- Fica para depois: pedido de exportação/eliminação de dados pelo titular (hoje por e-mail), aceite também no cadastro da página pública, e registro de operadores/subprocessadores contratados (confira a lista na seção 4 da política).
