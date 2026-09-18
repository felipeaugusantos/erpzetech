/* ERP Ze Tech — service worker mínimo.
   Só existe para o app poder ser instalado no celular e para avisar,
   com uma página simples, quando o aparelho está sem internet.
   Nada de dados da loja é guardado no aparelho. */
const OFFLINE = "ze-obra-offline-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE).then((c) =>
      c.put(
        "/__offline",
        new Response(
          `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ERP Ze Tech — sem conexão</title>
<style>body{font-family:system-ui,sans-serif;background:#F0F4F2;color:#003D1A;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#3f5c4c;margin:0 0 16px}
a{background:#008037;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600}</style>
</head><body><div><h1>Sem conexão</h1><p>O ERP Ze Tech precisa de internet para mostrar os dados da loja.</p><a href="/pdv">Tentar novamente</a></div></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(async () => {
      const cache = await caches.open(OFFLINE);
      return (await cache.match("/__offline")) ?? new Response("Sem conexão", { status: 503 });
    }),
  );
});
