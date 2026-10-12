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

## Trabalho sem internet
- Telas que funcionam sem internet (frente de caixa, salão, delivery, conferência) guardam as operações no navegador e as enviam por uma rotina idempotente do banco ao reconectar; operação recusada pelo banco fica guardada com o erro, nunca é descartada sozinha — porque o dinheiro já foi recebido no balcão.
- O cache de consultas é persistido no navegador e o `onlineManager` começa pelo `navigator.onLine`; mutações usam `networkMode: "always"` — para as telas reabrirem sem conexão sem apagar os dados nem travar botões.
