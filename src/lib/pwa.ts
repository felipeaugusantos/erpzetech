export function contextoSemServiceWorker(
  hostname: string,
  producao: boolean,
  iframe: boolean,
  desativado: boolean,
) {
  const host = hostname.toLowerCase();
  if (!producao || iframe || desativado) return true;
  if (
    ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"].some(
      (d) => host === d || host.endsWith(`.${d}`),
    )
  )
    return true;
  return ["lovable.app", "gpt-eng.com", "gptengineer.run"].some(
    (d) =>
      host.endsWith(`.${d}`) &&
      (/^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/.test(host.split(".")[0] ?? "") ||
        /^project--.+-dev$/.test(host.split(".")[0] ?? "")),
  );
}

export async function prepararOffline() {
  if (!("serviceWorker" in navigator)) return;
  if (
    contextoSemServiceWorker(
      window.location.hostname,
      import.meta.env.PROD,
      window.self !== window.top,
      new URLSearchParams(window.location.search).get("sw") === "off",
    )
  ) {
    const registros = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registros
        .filter((r) =>
          [r.active, r.waiting, r.installing].some(
            (w) => w && new URL(w.scriptURL).pathname === "/sw.js",
          ),
        )
        .map((r) => r.unregister()),
    );
    // Apenas os caches do antigo worker deste aplicativo; nunca os de notificações.
    const cachesLocais = await caches.keys();
    await Promise.all(
      cachesLocais.filter((k) => /^zt-offline-v\d+$/.test(k)).map((k) => caches.delete(k)),
    );
    return;
  }
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
