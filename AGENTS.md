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
- Subscriber administrator password resets run through an authenticated server function, authorize Ze Tech operators first, and derive the target from the saved subscriber linkage with matching tenant and administrator role; this prevents arbitrary-account resets.
- Show imported NF-e details through a read-only dialog querying the saved purchase and its items with the existing RLS client; the original XML is not stored, so never present reconstructed data as the original fiscal document.
- Parse combined DACTE PDFs per document, accepting spaced headings and isolating 44-digit keys from adjacent number columns, then deduplicate by CT-e key to avoid mixing freight or charging repeated copies.

## Trabalho sem internet
- Salão e Delivery mostram a fila local também online; reenvios preservam a chave idempotente e os pagamentos, e a sincronização concilia a fila atual para não apagar operações concorrentes.
- Telas que funcionam sem internet (frente de caixa, salão, delivery, conferência) guardam as operações no navegador e as enviam por uma rotina idempotente do banco ao reconectar; operação recusada pelo banco fica guardada com o erro, nunca é descartada sozinha — porque o dinheiro já foi recebido no balcão.
- O cache de consultas é persistido no navegador e o `onlineManager` começa pelo `navigator.onLine`; mutações usam `networkMode: "always"` — para as telas reabrirem sem conexão sem apagar os dados nem travar botões.
