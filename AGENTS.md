<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Imported purchase notes

- Ze Tech team management uses authenticated server functions and the existing operator registry; only the pinned owner's stable user ID can grant or revoke team access, and that owner cannot be removed, preventing operator privilege escalation or owner rebinding.
- Help Ze Tech calls run only in authenticated server functions; derive company identity from the active profile and RLS reads, and retain the same request ID on retry to prevent duplicate tickets.
- Username login remains tenant-scoped; the general login accepts the stable tenant UUID as an alternative company code, preserving password verification and avoiding global username discovery when no personalized link exists.
- Optional module availability is resolved centrally by moduloLiberadoEmpresa; manual selections apply only without a 14-digit CNPJ, and clinical database gates mirror this rule without changing user roles.
- Explicit company module releases are stored in empresa_modulos_liberados with tenant-scoped reads and service-only writes; availability resolvers and clinical database gates honor them without altering fiscal activities, business segment, or user permissions.
- The dedicated module selection screen uses the same availability resolver as the company form and menu; saves update only the current company's manual selections through its existing RLS client.
- Subscriber administrator password resets run through an authenticated server function, authorize Ze Tech operators first, and derive the target from the saved subscriber linkage with matching tenant and administrator role; this prevents arbitrary-account resets.
- Show imported NF-e details through a read-only dialog querying the saved purchase and its items with the existing RLS client; the original XML is not stored, so never present reconstructed data as the original fiscal document.
- Parse combined DACTE PDFs per document, accepting spaced headings and isolating 44-digit keys from adjacent number columns, then deduplicate by CT-e key to avoid mixing freight or charging repeated copies.
- Bulário veterinário: base global `bulario_medicamentos` (MAPA/SIPEAGRO, CC-BY) sem tenant e sem acesso direto; empresas consultam só por `bulario_buscar` (clínica liberada + administrador/gestor/veterinário) e a carga é da equipe EZRA em `/ze-tech-bulario` (service_role). É referência de consulta: nunca preenche receita nem estoque sozinho.
- Internação (pet_internacoes e derivadas) nasceu em drizzle/migrations (0074 a 0078) e a CI aplica essa pasta DEPOIS de supabase/migrations: migração nova que dependa dessas tabelas vai em drizzle/migrations com o próximo número (0079, 0080…), senão o run.sh falha com "relation does not exist". Função nova chamável por authenticated entra na lista sem_trava do smoke.sql; tabela com RLS precisa da política salao_restrito.
- Sinais vitais da internação: catálogo por empresa que nasce vazio (sem faixas nem alertas), registros imutáveis com correção e anulação como novo registro, leitura só do veterinário e do auxiliar, tudo por função (sem acesso direto às tabelas).
- Passagem de turno da internação: escrita por veterinário ou auxiliar, imutável, com pendências; o próximo profissional dá "ciente" (o autor não dá ciente da própria passagem) e ciente NUNCA resolve pendência nem executa dose: pendência só fecha por "resolvida" ou "descartada" explícitas, com autor, horário e motivo (descartar exige motivo); as doses só aparecem para consulta; leitura só do veterinário e do auxiliar.
- Portal do tutor (/portal, fora do AppShell): conta própria do tutor vinculada ao cadastro (clientes) por convite gerado pela recepção; no banco fica só o hash do código (7 dias, uso único, até 10 erros por hora). Toda leitura é função que descobre o tutor pela sessão e exige vínculo ATIVO ao cadastro do animal (animal alheio responde "não encontrado"); sem acesso direto às tabelas portal_*. O veterinário libera exames fechados e receitas emitidas; a liberação vale só para o cadastro para o qual foi feita (animal que muda de tutor exige nova liberação). Consultas do portal TÊM que usar chavePortal(user.id, …) (prefixo "clinica-" + id do usuário; o __root limpa as de outro usuário ao trocar de sessão), senão o cache do navegador guardaria dado clínico em texto simples. Código do convite vai no fragmento do link (#c=), nunca em ?consulta. Não enviar convite pelo sistema nem interpretar resultado (sem "alto/baixo").

## Trabalho sem internet

- Salão e Delivery mostram a fila local também online; reenvios preservam a chave idempotente e os pagamentos, e a sincronização concilia a fila atual para não apagar operações concorrentes.
- Telas que funcionam sem internet (frente de caixa, salão, delivery, conferência) guardam as operações no navegador e as enviam por uma rotina idempotente do banco ao reconectar; operação recusada pelo banco fica guardada com o erro, nunca é descartada sozinha — porque o dinheiro já foi recebido no balcão.
- O cache de consultas é persistido no navegador e o `onlineManager` começa pelo `navigator.onLine`; mutações usam `networkMode: "always"` — para as telas reabrirem sem conexão sem apagar os dados nem travar botões.
- Hospedagem fora do Lovable: `npm run build:node` gera o servidor Node (`.output/server/index.mjs`); guia em docs/hospedagem-vps.md. Login com Google, IA (`LOVABLE_API_KEY`) e a rotina do WhatsApp (`LOVABLE_CRON_SECRET`) dependem do Lovable e exigem decisão própria fora dele.
- WhatsApp por empresa: só empresas listadas em `WHATSAPP_EMPRESAS_LIBERADAS` (ids, vazia = ninguém) conectam o número (conectar e atualizar) e entram na rodada de envio; lista vazia faz a rodada nem tocar no banco. Desconectar é sempre permitido. Regras em `src/lib/whatsapp-liberacao.ts`.
- Contrato clínica × pet shop: a liberação `clinica` libera também o pet shop (padrão, ninguém existente muda); o marcador `sem_petshop` em `empresa_modulos_liberados` (só a equipe grava) desfaz isso: o pet shop só vale com `petshop` explícito, a área Pet shop mostra só Pets e tutores e Contatos (`itemPetVisivel`) e as demais telas de pet shop ficam bloqueadas. O marcador não é módulo: `ehEmpresaSoClinica` o ignora. Guia em docs/contrato-clinica-pet.md.
- Side menu: AppShell filters groups by permission/module first, then montarAreas() regroups them into rail areas (Início…Ajustes + vertical modules); add new screens to the groups, never to the areas directly, so permission filtering stays in one place.
