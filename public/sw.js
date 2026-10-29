/* EZRA ERP — service worker.
   Guarda as páginas e os arquivos do sistema já abertos, para a frente de caixa, o salão,
   o delivery e a conferência abrirem mesmo sem internet. Os dados da loja não passam por aqui
   (ficam no próprio navegador e são enviados ao banco quando a conexão volta). */
const VERSAO = "zt-offline-v3";
const TELAS = ["/frente-caixa", "/salao", "/delivery", "/conferencia-offline"];

const paginaSemConexao = () =>
  new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EZRA ERP — sem conexão</title>
<style>body{font-family:system-ui,sans-serif;background:#F0F4F2;color:#003D1A;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#3f5c4c;margin:0 0 16px}
a{display:inline-block;margin:4px;background:#008037;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600}</style>
</head><body><div><h1>Sem conexão</h1><p>Esta tela ainda não foi aberta com internet neste aparelho. Estas funcionam sem internet:</p>
<a href="/frente-caixa">Frente de caixa</a><a href="/salao">Salão</a><a href="/delivery">Delivery</a><a href="/conferencia-offline">Conferência</a></div></body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSAO)
      .then((c) => Promise.allSettled(TELAS.map((t) => c.add(t))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function guardavel(url) {
  if (url.origin === self.location.origin) {
    // chamadas ao servidor e atualização ao vivo do editor não são guardadas
    return !url.pathname.startsWith("/_serverFn") && !url.pathname.startsWith("/api/");
  }
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!guardavel(url)) return;

  const navegacao = req.mode === "navigate";
  const chave = navegacao ? url.origin + url.pathname : req;

  // arquivos com nome versionado não mudam: usa o guardado primeiro
  if (!navegacao && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (r) =>
          r ??
          fetch(req).then((resp) => {
            if (resp.ok) {
              const copia = resp.clone();
              void caches.open(VERSAO).then((c) => c.put(req, copia));
            }
            return resp;
          }),
      ),
    );
    return;
  }

  // demais: busca na rede e guarda; sem internet, entrega a cópia
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok && (resp.type === "basic" || resp.type === "cors")) {
          const copia = resp.clone();
          void caches.open(VERSAO).then((c) => c.put(chave, copia));
        }
        return resp;
      })
      .catch(async () => {
        const r = await caches.match(chave);
        if (r) return r;
        return navegacao ? paginaSemConexao() : new Response("", { status: 504 });
      }),
  );
});
